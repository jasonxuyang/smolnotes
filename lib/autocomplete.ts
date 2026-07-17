import { packNotePrompt } from "@/lib/context-pack";
import {
  createRequestId,
  type InferenceClient,
} from "@/lib/inference-client";

export const AUTOCOMPLETE_DEBOUNCE_MS = 150;
/** Any non-empty line content is enough — predict while typing. */
export const MIN_NOTE_CHARS = 1;
/** Short phrase ghost (inspired by SmolPilot’s ~15-token continuations). */
export const MAX_SUGGESTION_WORDS = 5;
export const MAX_SUGGESTION_CHARS = 40;

export type AutocompleteEmit = {
  onSuggestion: (text: string) => void;
  onPhase: (phase: "idle" | "suggesting") => void;
  onError?: (message: string) => void;
};

/** True when caret is at end of a non-empty line (or document end). */
export function caretAtLineEnd(body: string, caret: number): boolean {
  if (caret < 0 || caret > body.length) return false;
  if (caret === body.length) return true;
  return body[caret] === "\n";
}

export function canRequestCompletion(body: string, caret: number): boolean {
  if (!caretAtLineEnd(body, caret)) return false;
  const before = body.slice(0, caret);
  if (before.trim().length < MIN_NOTE_CHARS) return false;
  const lineStart = before.lastIndexOf("\n") + 1;
  if (before.slice(lineStart).length === 0) return false;
  return true;
}

/**
 * True when accepting `candidate` would echo recent note text
 * (Tab-loop that rebuilds the same clause).
 */
export function isRepetitiveSuggestion(
  candidate: string,
  noteBeforeCaret: string,
): boolean {
  const next = candidate.trim().toLowerCase();
  if (!next) return true;

  const hay = noteBeforeCaret.toLowerCase();
  const last = hay.match(/(\S+)$/u)?.[1];
  if (last && last === next) return true;

  const compactNext = next.replace(/\s+/gu, " ");
  const compactHay = hay.replace(/\s+/gu, " ").trimEnd();
  if (
    compactHay.endsWith(compactNext) ||
    compactHay.endsWith(` ${compactNext}`)
  ) {
    return true;
  }

  // Multi-word chunk already present in the recent window.
  if (compactNext.includes(" ") && compactNext.length >= 8) {
    if (compactHay.slice(-120).includes(compactNext)) return true;
  }

  if (next.length >= 3 && !compactNext.includes(" ")) {
    const recent = hay.slice(-96);
    const escaped = next.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`(?:^|[^a-z0-9])${escaped}(?:[^a-z0-9]|$)`, "i");
    if (re.test(recent)) return true;
  }

  return false;
}

export function sanitizeSuggestion(
  raw: string,
  noteBeforeCaret: string,
): string {
  let text = raw.replace(/\r/g, "");
  const nl = text.indexOf("\n");
  if (nl >= 0) text = text.slice(0, nl);

  text = text.replace(/^["'`]+/, "").replace(/["'`]+$/, "");

  // Only strip a long echoed prefix of the note — never a short stem like "fr".
  if (
    noteBeforeCaret.length >= 12 &&
    text.startsWith(noteBeforeCaret.slice(-48))
  ) {
    text = text.slice(noteBeforeCaret.slice(-48).length);
  }

  const lastWord = noteBeforeCaret.match(/(\S+)$/u)?.[1];
  let completingWord = false;
  if (lastWord && text.toLowerCase().startsWith(lastWord.toLowerCase())) {
    const rest = text.slice(lastWord.length);
    completingWord = rest.length > 0 && !/^\s/u.test(rest);
    text = rest;
  }

  const lead = text.match(/^\s*/u)?.[0] ?? "";
  let body = text.slice(lead.length);
  if (!body) return "";

  const sentenceEnd = body.search(/[.!?](?=\s|$)/u);
  if (sentenceEnd >= 0) body = body.slice(0, sentenceEnd + 1);

  const words = body.match(/\S+/gu) ?? [];
  if (words.length === 0) return "";
  if (words.length > MAX_SUGGESTION_WORDS) {
    body = words.slice(0, MAX_SUGGESTION_WORDS).join(" ");
  }

  // Completing the current word stays glued; otherwise ensure a leading space.
  let out = completingWord ? body : ` ${body.trimStart()}`;
  if (out.length > MAX_SUGGESTION_CHARS) {
    const cut = out.slice(0, MAX_SUGGESTION_CHARS);
    const sp = cut.lastIndexOf(" ");
    out = sp > 8 ? cut.slice(0, sp) : cut;
  }
  return out;
}

export function suggestionIsComplete(
  sanitized: string,
  rawAssembled: string,
): boolean {
  if (rawAssembled.includes("\n")) return true;
  if (/[.!?]\s*$/u.test(sanitized)) return true;
  const words = sanitized.trim().match(/\S+/gu) ?? [];
  if (words.length >= MAX_SUGGESTION_WORDS) return true;
  if (sanitized.length >= MAX_SUGGESTION_CHARS) return true;
  if (
    words.length > 0 &&
    (rawAssembled.match(/\S+/gu) ?? []).length > MAX_SUGGESTION_WORDS
  ) {
    return true;
  }
  return false;
}

/** Show ghost if real text, not dismissed; allow refining while it grows. */
export function shouldShowSuggestion(
  candidate: string,
  shown: string,
  dismissed: Set<string>,
  noteBeforeCaret = "",
): boolean {
  if (!candidate.trim()) return false;
  if (isRepetitiveSuggestion(candidate, noteBeforeCaret)) return false;
  if (dismissed.has(candidate)) return false;
  if (!shown) return true;
  return candidate.startsWith(shown) && candidate !== shown;
}

/**
 * Debounced one-shot autocomplete via raw text completion.
 * Never interrupts WebLLM mid-flight (that wedges create()); at most one
 * restart runs after the current request finishes if the prefix moved.
 */
export class AutocompleteController {
  private client: InferenceClient | null = null;
  private emit: AutocompleteEmit;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private prefix: string | null = null;
  private busy = false;
  private restart = false;
  private activeRequestId: string | null = null;
  private shown = "";
  private dismissed = new Set<string>();

  constructor(emit: AutocompleteEmit) {
    this.emit = emit;
  }

  setClient(client: InferenceClient | null): void {
    this.client = client;
  }

  getActiveRequestId(): string | null {
    return this.activeRequestId;
  }

  cancel(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.prefix = null;
    this.restart = false;
    this.shown = "";
    this.dismissed.clear();
    this.emit.onSuggestion("");
    this.emit.onPhase("idle");
  }

  /** Esc: hide ghost; queue one more generate for the current prefix. */
  dismiss(): void {
    if (this.shown) this.dismissed.add(this.shown);
    this.shown = "";
    this.emit.onSuggestion("");
    if (this.prefix && this.client) {
      this.scheduleRun(0);
    }
  }

  /** Tab: clear ghost; caller will schedule the new prefix. */
  accept(): void {
    this.shown = "";
    this.dismissed.clear();
    this.emit.onSuggestion("");
  }

  schedule(body: string, caret: number, delayMs = AUTOCOMPLETE_DEBOUNCE_MS): void {
    if (!canRequestCompletion(body, caret)) {
      this.cancel();
      return;
    }

    const next = body.slice(0, caret);
    if (next !== this.prefix) {
      this.prefix = next;
      this.shown = "";
      this.dismissed.clear();
      this.emit.onSuggestion("");
    } else if (this.busy) {
      return;
    }

    this.scheduleRun(delayMs);
  }

  private scheduleRun(delayMs: number): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    const target = this.prefix;
    if (!target) return;

    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      if (this.prefix !== target) return;
      void this.run();
    }, delayMs);
  }

  private async run(): Promise<void> {
    const prefix = this.prefix;
    const client = this.client;
    if (!prefix || !client) return;

    if (this.busy) {
      this.restart = true;
      return;
    }

    this.busy = true;
    this.restart = false;
    this.emit.onPhase("suggesting");

    const { prompt } = packNotePrompt({ noteBeforeCaret: prefix });
    const requestId = createRequestId();
    this.activeRequestId = requestId;
    let assembled = "";
    let ghostDone = false;

    try {
      const result = await client.generate(requestId, prompt, {
        onDelta: (text) => {
          if (
            this.activeRequestId !== requestId ||
            this.prefix !== prefix ||
            ghostDone
          ) {
            return;
          }
          assembled += text;
          const cleaned = sanitizeSuggestion(assembled, prefix);
          this.offer(cleaned, prefix);
          if (suggestionIsComplete(cleaned, assembled)) {
            ghostDone = true;
          }
        },
      });

      if (this.prefix === prefix) {
        const raw = result.text || assembled;
        if (raw) this.offer(sanitizeSuggestion(raw, prefix), prefix);
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "autocomplete failed";
      if (message !== "busy") this.emit.onError?.(message);
    } finally {
      if (this.activeRequestId === requestId) this.activeRequestId = null;
      this.busy = false;
      this.emit.onPhase("idle");

      const needsRestart =
        this.restart ||
        (Boolean(this.prefix) &&
          this.prefix !== prefix &&
          !this.shown &&
          Boolean(this.client));
      this.restart = false;

      if (needsRestart && this.prefix && this.client) {
        this.scheduleRun(AUTOCOMPLETE_DEBOUNCE_MS);
      }
    }
  }

  private offer(candidate: string, noteBeforeCaret: string): void {
    if (
      !shouldShowSuggestion(
        candidate,
        this.shown,
        this.dismissed,
        noteBeforeCaret,
      )
    ) {
      return;
    }
    this.shown = candidate;
    this.emit.onSuggestion(candidate);
  }
}
