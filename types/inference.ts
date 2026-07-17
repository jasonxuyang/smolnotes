export type ChatRole = "system" | "user" | "assistant";

export type ChatMessage = {
  role: ChatRole;
  content: string;
};

export type ModelState =
  | "idle"
  | "checking-webgpu"
  | "unsupported"
  | "not-loaded"
  | "downloading"
  | "compiling"
  | "ready"
  | "generating"
  | "cancelled"
  | "error";

export type WorkerRequest =
  | {
      type: "initialize";
      modelId: string;
    }
  | {
      type: "generate";
      requestId: string;
      /** Raw note prefix for text-completion (not chat). */
      prompt: string;
    }
  | {
      type: "cancel";
      requestId: string;
    };

export type WorkerResponse =
  | {
      type: "load-progress";
      progress: number;
      text: string;
    }
  | {
      type: "ready";
      modelId: string;
    }
  | {
      type: "generation-start";
      requestId: string;
      startedAt: number;
    }
  | {
      type: "text-delta";
      requestId: string;
      text: string;
      deltaIndex: number;
      timestamp: number;
      latencyMs: number;
    }
  | {
      type: "generation-complete";
      requestId: string;
      outputDeltas: number;
      durationMs: number;
    }
  | {
      type: "generation-cancelled";
      requestId: string;
      outputDeltas: number;
      durationMs: number;
    }
  | {
      type: "error";
      message: string;
      fatal?: boolean;
    };

export type InferenceStats = {
  modelId: string | null;
  modelName: string;
  modelState: ModelState;
  downloadProgress: number;
  downloadText: string;
  webgpuSupported: boolean | null;
  webgpuActive: boolean;
  timeToFirstDeltaMs: number | null;
  generationDurationMs: number | null;
  outputDeltaCount: number;
  deltasPerSecond: number | null;
  contextMessageCount: number;
  errorMessage: string | null;
};

export type UiChatMessage = {
  id: string;
  role: Exclude<ChatRole, "system">;
  content: string;
  pending?: boolean;
};
