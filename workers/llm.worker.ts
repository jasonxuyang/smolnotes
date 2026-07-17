import { CreateMLCEngine, type MLCEngineInterface } from "@mlc-ai/web-llm";
import { GENERATION_DEFAULTS } from "@/lib/generation";
import type { WorkerRequest, WorkerResponse } from "@/types/inference";

let engine: MLCEngineInterface | null = null;
let activeRequestId: string | null = null;
let cancelRequested = false;
let initializing = false;
/** Serialize generate so preempted runs finish before the next starts. */
let generateChain: Promise<void> = Promise.resolve();
/** Skip stale queued runs when the main thread preempts with a newer id. */
let latestQueuedId: string | null = null;

type CompletionChunk = {
  choices: Array<{ text?: string; delta?: { content?: string } }>;
};

function post(message: WorkerResponse): void {
  self.postMessage(message);
}

function humanizeError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const lower = raw.toLowerCase();

  if (lower.includes("out of memory") || lower.includes("oom") || lower.includes("device lost")) {
    return "gpu oom";
  }
  if (lower.includes("network") || lower.includes("fetch") || lower.includes("failed to fetch")) {
    return "download failed";
  }
  if (lower.includes("webgpu")) {
    return `webgpu: ${raw}`;
  }
  return raw || "failed";
}

/** Catch “same clause forever” before it fills the transcript. */
function looksLikeRepetitionLoop(text: string): boolean {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length < 24) return false;

  for (let n = 8; n <= Math.min(48, Math.floor(flat.length / 2)); n += 1) {
    const unit = flat.slice(-n);
    if (flat.slice(0, -n).endsWith(unit)) return true;
  }

  const tail = flat.slice(-Math.min(70, Math.floor(flat.length / 2)));
  if (tail.length >= 12 && flat.slice(0, -tail.length).includes(tail)) {
    return true;
  }

  const sentences = flat.split(/(?<=[.!?])\s+/).filter((s) => s.length > 24);
  if (sentences.length >= 3) {
    const last = sentences[sentences.length - 1]!.toLowerCase();
    const matches = sentences.filter((s) => s.toLowerCase() === last).length;
    if (matches >= 3) return true;
  }

  return false;
}

async function interruptActive(): Promise<void> {
  if (!activeRequestId) return;
  cancelRequested = true;
  try {
    await engine?.interruptGenerate();
  } catch {
    // interruptGenerate can throw if nothing is running; ignore.
  }
}

async function handleInitialize(modelId: string): Promise<void> {
  if (initializing) {
    post({ type: "error", message: "already loading" });
    return;
  }

  initializing = true;
  cancelRequested = false;
  activeRequestId = null;

  try {
    if (engine) {
      await engine.unload();
      engine = null;
    }

    post({
      type: "load-progress",
      progress: 0,
      text: "loading",
    });

    engine = await CreateMLCEngine(modelId, {
      initProgressCallback: (report) => {
        const progress = Math.max(0, Math.min(1, report.progress ?? 0));
        post({
          type: "load-progress",
          progress,
          text: "loading",
        });
      },
    });

    post({ type: "ready", modelId });
  } catch (error) {
    engine = null;
    post({ type: "error", message: humanizeError(error), fatal: true });
  } finally {
    initializing = false;
  }
}

async function handleGenerate(requestId: string, prompt: string): Promise<void> {
  if (latestQueuedId !== requestId) {
    return;
  }

  if (!engine) {
    post({
      type: "error",
      message: "not ready",
    });
    return;
  }

  if (activeRequestId) {
    await interruptActive();
    for (let i = 0; i < 200 && activeRequestId; i += 1) {
      await new Promise((r) => setTimeout(r, 5));
    }
    if (activeRequestId) {
      activeRequestId = null;
    }
  }

  if (latestQueuedId !== requestId) {
    return;
  }

  activeRequestId = requestId;
  cancelRequested = false;
  const startedAt = performance.now();
  let deltaIndex = 0;

  post({
    type: "generation-start",
    requestId,
    startedAt: Date.now(),
  });

  try {
    const stream = await createStreamCancellable(requestId, prompt);

    if (!stream || latestQueuedId !== requestId || cancelRequested) {
      post({
        type: "generation-cancelled",
        requestId,
        outputDeltas: 0,
        durationMs: performance.now() - startedAt,
      });
      return;
    }

    let assembled = "";
    let stoppedForLoop = false;
    for await (const chunk of stream) {
      if (
        cancelRequested ||
        activeRequestId !== requestId ||
        latestQueuedId !== requestId
      ) {
        break;
      }

      // Completions stream uses `text`; keep a chat-delta fallback.
      const text =
        chunk.choices[0]?.text ?? chunk.choices[0]?.delta?.content;
      if (!text) {
        continue;
      }

      assembled += text;
      if (looksLikeRepetitionLoop(assembled)) {
        stoppedForLoop = true;
        try {
          await engine.interruptGenerate();
        } catch {
          // ignore
        }
        break;
      }

      post({
        type: "text-delta",
        requestId,
        text,
        deltaIndex,
        timestamp: Date.now(),
        latencyMs: performance.now() - startedAt,
      });
      deltaIndex += 1;
    }

    const durationMs = performance.now() - startedAt;
    const superseded =
      latestQueuedId !== requestId || (cancelRequested && !stoppedForLoop);

    post(
      superseded
        ? {
            type: "generation-cancelled",
            requestId,
            outputDeltas: deltaIndex,
            durationMs,
          }
        : {
            type: "generation-complete",
            requestId,
            outputDeltas: deltaIndex,
            durationMs,
          },
    );
  } catch (error) {
    if (cancelRequested || latestQueuedId !== requestId) {
      post({
        type: "generation-cancelled",
        requestId,
        outputDeltas: deltaIndex,
        durationMs: performance.now() - startedAt,
      });
    } else {
      post({ type: "error", message: humanizeError(error) });
    }
  } finally {
    if (activeRequestId === requestId) {
      activeRequestId = null;
    }
    cancelRequested = false;
  }
}

/**
 * Await completions.create but bail if this request is superseded,
 * so a hung create cannot block the generate chain forever.
 */
const CREATE_HARD_TIMEOUT_MS = 4_000;

async function createStreamCancellable(
  requestId: string,
  prompt: string,
): Promise<AsyncIterable<CompletionChunk> | null> {
  if (!engine) return null;

  const createPromise: Promise<AsyncIterable<CompletionChunk>> =
    engine.completions.create({
      prompt,
      stream: true,
      stream_options: { include_usage: true },
      ...GENERATION_DEFAULTS,
    });
  const deadline = performance.now() + CREATE_HARD_TIMEOUT_MS;

  while (true) {
    const timedOut = performance.now() >= deadline;
    if (latestQueuedId !== requestId || cancelRequested || timedOut) {
      try {
        await engine.interruptGenerate();
      } catch {
        // ignore
      }
      const settled = await Promise.race([
        createPromise.then((s) => ({ ok: true as const, s })),
        new Promise<{ ok: false }>((resolve) => {
          setTimeout(() => resolve({ ok: false }), 400);
        }),
      ]);
      return settled.ok ? settled.s : null;
    }

    const tick = await Promise.race([
      createPromise.then((s) => ({ done: true as const, s })),
      new Promise<{ done: false }>((resolve) => {
        setTimeout(() => resolve({ done: false }), 40);
      }),
    ]);
    if (tick.done) return tick.s;
  }
}

function enqueueGenerate(requestId: string, prompt: string): void {
  latestQueuedId = requestId;
  if (activeRequestId && activeRequestId !== requestId) {
    cancelRequested = true;
    void interruptActive();
  }

  generateChain = generateChain
    .then(async () => {
      if (latestQueuedId !== requestId) return;
      await handleGenerate(requestId, prompt);
    })
    .catch(() => {
      // Keep the chain alive after unexpected failures.
    });
}

async function handleCancel(requestId: string): Promise<void> {
  if (activeRequestId !== requestId) {
    return;
  }
  await interruptActive();
}

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const message = event.data;

  switch (message.type) {
    case "initialize":
      void handleInitialize(message.modelId);
      break;
    case "generate":
      enqueueGenerate(message.requestId, message.prompt);
      break;
    case "cancel":
      void handleCancel(message.requestId);
      break;
    default: {
      const _exhaustive: never = message;
      post({
        type: "error",
        message: `unknown: ${JSON.stringify(_exhaustive)}`,
      });
    }
  }
};
