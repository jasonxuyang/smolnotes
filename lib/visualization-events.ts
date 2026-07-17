export type VisualizationPhase = "idle" | "prompt" | "generating" | "complete";

export type VisualizationEvent =
  | {
      type: "prompt-submit";
      prompt: string;
      contextLength: number;
      at: number;
    }
  | {
      type: "generation-start";
      requestId: string;
      at: number;
    }
  | {
      type: "text-delta";
      requestId: string;
      text: string;
      deltaIndex: number;
      contextLength: number;
      at: number;
    }
  | {
      type: "generation-complete";
      requestId: string;
      at: number;
    }
  | {
      type: "generation-cancelled";
      requestId: string;
      at: number;
    }
  | {
      type: "reset";
      at: number;
    };

/** Deterministic 32-bit hash for reproducible visual variation. */
export function hashSeed(...parts: Array<string | number>): number {
  let h = 2166136261;
  for (const part of parts) {
    const s = String(part);
    for (let i = 0; i < s.length; i += 1) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    h ^= 0x9e3779b9;
  }
  return h >>> 0;
}

/** Mulberry32 PRNG — same seed always yields the same sequence. */
export function createSeededRandom(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}
