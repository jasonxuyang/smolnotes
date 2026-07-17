/**
 * Small MLC builds are typically ~2k context.
 * Reserve headroom for the completion; budget the prompt in chars.
 */
export const CONTEXT_INPUT_CHARS = 4200;
export const CONTEXT_LIMIT_CHARS = CONTEXT_INPUT_CHARS;
export const CONTEXT_NOTE_CHARS = 3200;

export type ContextUsage = {
  usedChars: number;
  limitChars: number;
  /** 0–100 */
  pct: number;
  /** Chars trimmed from the start of the note window. */
  truncatedChars: number;
};

export function formatContextChars(n: number): string {
  if (n < 1000) return `${n}`;
  return `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k`;
}

function clipEnd(text: string, n: number): { text: string; truncatedChars: number } {
  if (text.length <= n) return { text, truncatedChars: 0 };
  return {
    text: text.slice(text.length - n),
    truncatedChars: text.length - n,
  };
}

/**
 * Pack the trailing note window as a raw completion prompt.
 * Keeps the end of the note (nearest the caret) — no chat wrapper.
 */
export function packNotePrompt(args: {
  noteBeforeCaret: string;
  budgetChars?: number;
}): {
  prompt: string;
  usedChars: number;
  truncatedChars: number;
} {
  const budget = Math.min(
    CONTEXT_NOTE_CHARS,
    args.budgetChars ?? CONTEXT_INPUT_CHARS,
  );
  const { text: prompt, truncatedChars } = clipEnd(
    args.noteBeforeCaret,
    budget,
  );
  return {
    prompt,
    usedChars: prompt.length,
    truncatedChars,
  };
}

export function estimateNoteContextUsage(args: {
  noteBeforeCaret: string;
  budgetChars?: number;
}): ContextUsage {
  const limitChars = args.budgetChars ?? CONTEXT_LIMIT_CHARS;
  const packed = packNotePrompt({
    noteBeforeCaret: args.noteBeforeCaret,
    budgetChars: limitChars,
  });
  const pct = Math.min(
    100,
    Math.round((packed.usedChars / Math.max(1, limitChars)) * 100),
  );
  return {
    usedChars: packed.usedChars,
    limitChars,
    pct,
    truncatedChars: packed.truncatedChars,
  };
}
