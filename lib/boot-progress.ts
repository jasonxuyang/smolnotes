/**
 * Blend real WebLLM load progress with a slow fake creep so the bar
 * never jumps straight to 100% (common when the model is already cached).
 */
export type BootProgressSnapshot = {
  /** 0–1 value for the UI bar */
  display: number;
  /** True once the engine reported ready and the bar has eased to full */
  revealReady: boolean;
};

export class BootProgressMixer {
  private real = 0;
  private display = 0.02;
  private engineReady = false;
  private startedAt = performance.now();
  private minBootMs: number;

  constructor(minBootMs = 2000) {
    this.minBootMs = minBootMs;
  }

  reset(minBootMs = this.minBootMs): void {
    this.real = 0;
    this.display = 0.02;
    this.engineReady = false;
    this.startedAt = performance.now();
    this.minBootMs = minBootMs;
  }

  setReal(progress: number): void {
    this.real = Math.max(this.real, Math.max(0, Math.min(1, progress)));
  }

  markEngineReady(): void {
    this.engineReady = true;
    this.real = 1;
  }

  /** Call once per animation frame. */
  tick(now = performance.now()): BootProgressSnapshot {
    const elapsed = now - this.startedAt;

    // Time-based fake progress: rises quickly at first, then slows (never hits 1 alone).
    const fake = 1 - Math.exp(-elapsed / 1800);
    const fakeCapped = fake * 0.88;

    // Weighted blend — real moves the floor, fake keeps motion during stalls.
    const blended = this.real * 0.62 + fakeCapped * 0.38;
    const stallCreep = Math.min(0.9, elapsed / 12000);

    let target = Math.max(blended, this.real * 0.85, stallCreep);

    if (!this.engineReady) {
      // Hold below full until the engine is actually ready.
      target = Math.min(target, 0.93);
    } else {
      target = 1;
    }

    // Ease displayed value toward target (slower catch-up when jumping up a lot).
    const gap = target - this.display;
    const rate = this.engineReady ? 0.045 : gap > 0.25 ? 0.028 : 0.055;
    this.display += gap * rate;

    // Tiny forward bias so a frozen bar still ticks a hair.
    if (!this.engineReady && this.display < 0.9) {
      this.display += 0.00035;
    }

    this.display = Math.max(0.02, Math.min(this.engineReady ? 1 : 0.93, this.display));

    if (this.engineReady && this.display > 0.995) {
      this.display = 1;
    }

    const revealReady =
      this.engineReady &&
      this.display >= 0.995 &&
      elapsed >= this.minBootMs;

    return { display: this.display, revealReady };
  }
}
