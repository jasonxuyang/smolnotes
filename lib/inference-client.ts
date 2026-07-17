import type { WorkerRequest, WorkerResponse } from "@/types/inference";

export type InferenceClientHandlers = {
  onMessage: (message: WorkerResponse) => void;
  onWorkerError?: (error: Error) => void;
};

export type GenerateHandlers = {
  onDelta?: (text: string, deltaIndex: number) => void;
  onStart?: () => void;
};

export type GenerateResult = {
  text: string;
  cancelled: boolean;
  requestId: string;
};

type PendingGenerate = {
  requestId: string;
  text: string;
  handlers: GenerateHandlers;
  resolve: (result: GenerateResult) => void;
  reject: (error: Error) => void;
};

/**
 * Thin main-thread bridge to the LLM Web Worker.
 * Supports fire-and-forget lifecycle messages + promise-based generate.
 */
export class InferenceClient {
  private worker: Worker | null = null;
  private handlers: InferenceClientHandlers | null = null;
  private pending: PendingGenerate | null = null;

  start(handlers: InferenceClientHandlers): void {
    if (typeof window === "undefined") {
      return;
    }

    this.stop();
    this.handlers = handlers;

    this.worker = new Worker(new URL("../workers/llm.worker.ts", import.meta.url), {
      type: "module",
    });

    this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      this.route(event.data);
    };

    this.worker.onerror = (event) => {
      const error = new Error(event.message || "Inference worker failed to start.");
      this.pending?.reject(error);
      this.pending = null;
      this.handlers?.onWorkerError?.(error);
      this.handlers?.onMessage({
        type: "error",
        message: error.message,
        fatal: true,
      });
    };
  }

  stop(): void {
    if (this.pending) {
      this.pending.resolve({
        text: this.pending.text,
        cancelled: true,
        requestId: this.pending.requestId,
      });
      this.pending = null;
    }
    if (this.worker) {
      this.worker.terminate();
    }
    this.worker = null;
    this.handlers = null;
  }

  private route(message: WorkerResponse): void {
    const pending = this.pending;

    switch (message.type) {
      case "generation-start":
        if (pending && pending.requestId === message.requestId) {
          pending.handlers.onStart?.();
        }
        this.handlers?.onMessage(message);
        break;
      case "text-delta":
        if (pending && pending.requestId === message.requestId) {
          pending.text += message.text;
          pending.handlers.onDelta?.(message.text, message.deltaIndex);
        }
        this.handlers?.onMessage(message);
        break;
      case "generation-complete":
        if (pending && pending.requestId === message.requestId) {
          this.pending = null;
          pending.resolve({
            text: pending.text,
            cancelled: false,
            requestId: message.requestId,
          });
        }
        this.handlers?.onMessage(message);
        break;
      case "generation-cancelled":
        if (pending && pending.requestId === message.requestId) {
          this.pending = null;
          pending.resolve({
            text: pending.text,
            cancelled: true,
            requestId: message.requestId,
          });
        }
        this.handlers?.onMessage(message);
        break;
      case "error":
        if (pending) {
          this.pending = null;
          pending.reject(new Error(message.message));
        }
        this.handlers?.onMessage(message);
        break;
      default:
        this.handlers?.onMessage(message);
        break;
    }
  }

  private post(message: WorkerRequest): void {
    if (!this.worker) {
      this.handlers?.onMessage({
        type: "error",
        message: "worker dead",
        fatal: true,
      });
      return;
    }
    this.worker.postMessage(message);
  }

  initialize(modelId: string): void {
    this.post({ type: "initialize", modelId });
  }

  /**
   * Start a generation. Preempts any in-flight request immediately so the
   * next call never fails with a silent "busy" on the main thread.
   */
  generate(
    requestId: string,
    prompt: string,
    handlers: GenerateHandlers = {},
  ): Promise<GenerateResult> {
    if (this.pending) {
      const oldId = this.pending.requestId;
      this.clearPending(true);
      this.post({ type: "cancel", requestId: oldId });
    }

    return new Promise<GenerateResult>((resolve, reject) => {
      this.pending = {
        requestId,
        text: "",
        handlers,
        resolve,
        reject,
      };
      this.post({ type: "generate", requestId, prompt });
    });
  }

  /** Cancel and immediately free the client for the next generate. */
  cancel(requestId: string): void {
    if (this.pending?.requestId === requestId) {
      this.clearPending(true);
    }
    this.post({ type: "cancel", requestId });
  }

  private clearPending(cancelled: boolean): void {
    const pending = this.pending;
    if (!pending) return;
    this.pending = null;
    if (cancelled) {
      pending.resolve({
        text: pending.text,
        cancelled: true,
        requestId: pending.requestId,
      });
    }
  }
}

export function createRequestId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `req_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}
