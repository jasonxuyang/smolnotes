export type WebGPUSupportResult = {
  supported: boolean;
  reason?: string;
};

export async function checkWebGPUSupport(): Promise<WebGPUSupportResult> {
  if (typeof navigator === "undefined") {
    return { supported: false, reason: "browser only" };
  }

  if (!("gpu" in navigator) || !navigator.gpu) {
    return {
      supported: false,
      reason: "no webgpu — try chrome or edge",
    };
  }

  try {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
      return {
        supported: false,
        reason: "no gpu adapter",
      };
    }
    return { supported: true };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "webgpu failed";
    return { supported: false, reason: message };
  }
}
