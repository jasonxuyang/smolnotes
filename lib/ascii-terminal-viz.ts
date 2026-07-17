import {
  createSeededRandom,
  hashSeed,
  type VisualizationEvent,
} from "@/lib/visualization-events";

type VizOptions = {
  reducedMotion: boolean;
  opacity: number;
};

type FieldMode = {
  name: string;
  speed: number;
  sx: number;
  sy: number;
  gate: number;
  crest: number;
  advX: number;
  advY: number;
  decay: number;
  scan: ScanStyle;
  rampHot: string;
};

type ScanStyle = "column" | "diagonal" | "ring" | "rain";

const RAMP_SOFT = " .:-=+*#%@";
const RAMP_BLOCK = " ·░▒▓█";

const MODES: FieldMode[] = [
  {
    name: "drift",
    speed: 0.42,
    sx: 0.34,
    sy: 0.2,
    gate: 0.4,
    crest: 0.78,
    advX: 0.35,
    advY: 0.08,
    decay: 0.982,
    scan: "column",
    rampHot: RAMP_SOFT,
  },
  {
    name: "chop",
    speed: 0.72,
    sx: 0.52,
    sy: 0.31,
    gate: 0.32,
    crest: 0.62,
    advX: 0.55,
    advY: -0.2,
    decay: 0.975,
    scan: "rain",
    rampHot: RAMP_BLOCK,
  },
  {
    name: "swell",
    speed: 0.28,
    sx: 0.18,
    sy: 0.14,
    gate: 0.48,
    crest: 0.7,
    advX: 0.15,
    advY: 0.22,
    decay: 0.988,
    scan: "ring",
    rampHot: RAMP_SOFT,
  },
  {
    name: "lattice",
    speed: 0.55,
    sx: 0.4,
    sy: 0.4,
    gate: 0.36,
    crest: 0.66,
    advX: 0.1,
    advY: 0.1,
    decay: 0.98,
    scan: "diagonal",
    rampHot: RAMP_BLOCK,
  },
  {
    name: "vortex",
    speed: 0.6,
    sx: 0.26,
    sy: 0.26,
    gate: 0.38,
    crest: 0.72,
    advX: 0.4,
    advY: 0.35,
    decay: 0.979,
    scan: "ring",
    rampHot: RAMP_SOFT,
  },
];

/**
 * ASCII field with traveling waves, event ripples,
 * mode cycles, and heat advection trails.
 */
export class AsciiTerminalViz {
  private cols = 56;
  private rows = 26;
  private heat: Float32Array = new Float32Array(0);
  private scratch: Float32Array = new Float32Array(0);
  private time = 0;
  private options: VizOptions = { reducedMotion: false, opacity: 0.55 };
  private wave = 0;
  private seed = 1;
  private mode = MODES[0]!;
  private modeIndex = 0;
  private scanOriginX = 0;
  private scanOriginY = 0;
  private ringAge = 0;
  private phase: "idle" | "prompt" | "generating" | "complete" = "idle";
  private target: HTMLPreElement | null = null;
  private advAccumX = 0;
  private advAccumY = 0;

  constructor(target: HTMLPreElement) {
    this.target = target;
    this.rebuild(56, 26);
    this.pickMode(1);
  }

  setOptions(options: Partial<VizOptions>): void {
    this.options = { ...this.options, ...options };
    if (this.target) {
      this.target.style.opacity = String(this.options.opacity);
    }
  }

  resize(
    cssWidth: number,
    cssHeight: number,
    cellW = 12,
    cellH = 18,
  ): void {
    const w = Math.max(1, cellW);
    const h = Math.max(1, cellH);
    const cols = Math.max(8, Math.floor(cssWidth / w));
    const rows = Math.max(6, Math.floor(cssHeight / h));
    if (cols !== this.cols || rows !== this.rows) {
      this.rebuild(cols, rows);
    }
  }

  pushEvent(event: VisualizationEvent): void {
    switch (event.type) {
      case "prompt-submit":
        this.seed = hashSeed(event.prompt, event.contextLength);
        this.pickMode(this.seed);
        this.wave = 1;
        this.phase = "prompt";
        this.stampWords(event.prompt);
        this.band(0.75);
        this.ripple(this.cols * 0.3, this.rows * 0.5, 6, 0.85);
        break;
      case "generation-start":
        this.seed = hashSeed(event.requestId, this.seed);
        this.pickMode(this.seed);
        this.phase = "generating";
        this.wave = Math.max(this.wave, 0.55);
        this.scanOriginX = (this.seed % this.cols) + 0.5;
        this.scanOriginY = ((this.seed >>> 8) % this.rows) + 0.5;
        this.ringAge = 0;
        break;
      case "text-delta": {
        this.seed = hashSeed(event.text, event.deltaIndex, event.contextLength);
        this.wave = Math.min(1.35, this.wave + 0.22);
        this.phase = "generating";
        const rand = createSeededRandom(this.seed);
        this.ripple(
          rand() * this.cols,
          rand() * this.rows,
          2 + (event.deltaIndex % 4),
          0.75,
        );
        if (event.deltaIndex > 0 && event.deltaIndex % 7 === 0) {
          this.cycleMode();
        }
        break;
      }
      case "generation-complete":
        this.phase = "complete";
        this.wave = Math.max(this.wave, 0.45);
        this.band(0.5);
        break;
      case "generation-cancelled":
      case "reset":
        this.phase = "idle";
        this.wave = 0;
        this.heat.fill(0.04);
        this.ringAge = 0;
        break;
      default: {
        const _exhaustive: never = event;
        void _exhaustive;
      }
    }
  }

  pulse(seed: string, index: number): void {
    this.seed = hashSeed(seed, index, this.seed);
    this.wave = Math.min(1.35, this.wave + 0.2);
    const rand = createSeededRandom(this.seed);
    this.ripple(rand() * this.cols, rand() * this.rows, 2, 0.6);
  }

  private pickMode(seed: number): void {
    this.modeIndex = seed % MODES.length;
    this.mode = MODES[this.modeIndex]!;
  }

  private cycleMode(): void {
    this.modeIndex = (this.modeIndex + 1) % MODES.length;
    this.mode = MODES[this.modeIndex]!;
    this.scanOriginX = (this.seed % this.cols) + 0.5;
    this.scanOriginY = ((this.seed >>> 4) % this.rows) + 0.5;
    this.ringAge = 0;
  }

  private rebuild(cols: number, rows: number): void {
    this.cols = cols;
    this.rows = rows;
    const n = cols * rows;
    this.heat = new Float32Array(n);
    this.scratch = new Float32Array(n);
    this.heat.fill(0.04);
  }

  private idx(x: number, y: number): number {
    return y * this.cols + x;
  }

  private stampWords(prompt: string): void {
    const rand = createSeededRandom(hashSeed(prompt, "stamp"));
    const words = prompt.trim().split(/\s+/).slice(0, 6);
    for (const word of words) {
      const y = 2 + Math.floor(rand() * Math.max(1, this.rows - 4));
      const x =
        2 + Math.floor(rand() * Math.max(1, this.cols - word.length - 2));
      for (let i = 0; i < word.length && x + i < this.cols; i += 1) {
        this.heat[this.idx(x + i, y)] = 0.9;
      }
    }
  }

  private ripple(cx: number, cy: number, radius: number, amount: number): void {
    const x0 = Math.floor(cx);
    const y0 = Math.floor(cy);
    const r = Math.max(1, Math.floor(radius));
    for (let y = y0 - r; y <= y0 + r; y += 1) {
      for (let x = x0 - r; x <= x0 + r; x += 1) {
        if (x < 0 || y < 0 || x >= this.cols || y >= this.rows) continue;
        const d = Math.hypot(x - x0, y - y0);
        if (d > r) continue;
        const i = this.idx(x, y);
        this.heat[i] = Math.min(
          1.25,
          this.heat[i] + (1 - d / (r + 0.01)) * amount,
        );
      }
    }
  }

  private band(amount: number): void {
    const y =
      Math.floor((this.seed % Math.max(1, this.rows)) * 0.61) % this.rows;
    for (let x = 0; x < this.cols; x += 1) {
      this.heat[this.idx(x, y)] = Math.min(
        1.25,
        this.heat[this.idx(x, y)] + amount,
      );
      if (y + 1 < this.rows) {
        this.heat[this.idx(x, y + 1)] = Math.min(
          1.25,
          this.heat[this.idx(x, y + 1)] + amount * 0.45,
        );
      }
    }
  }

  private advect(dt: number): void {
    if (this.options.reducedMotion) return;
    const m = this.mode;
    const boost = this.phase === "generating" ? 1.35 : 0.7;
    this.advAccumX += m.advX * boost * dt * 14;
    this.advAccumY += m.advY * boost * dt * 10;
    const sx = Math.trunc(this.advAccumX);
    const sy = Math.trunc(this.advAccumY);
    if (sx === 0 && sy === 0) return;
    this.advAccumX -= sx;
    this.advAccumY -= sy;

    this.scratch.set(this.heat);
    for (let y = 0; y < this.rows; y += 1) {
      for (let x = 0; x < this.cols; x += 1) {
        const sxSrc = (x - sx + this.cols * 8) % this.cols;
        const sySrc = (y - sy + this.rows * 8) % this.rows;
        const dest = this.idx(x, y);
        const src = this.idx(sxSrc, sySrc);
        // Blend advected heat so trails smear instead of hard-scroll.
        this.heat[dest] = this.scratch[dest] * 0.35 + this.scratch[src] * 0.65;
      }
    }
  }

  private scanBoost(x: number, y: number, t: number): number {
    if (this.phase !== "generating" || this.options.reducedMotion) return 0;
    const m = this.mode;
    const energy = 0.38 + this.wave * 0.4;

    switch (m.scan) {
      case "column": {
        const scan = Math.floor(t * 4.2) % this.cols;
        if (x === scan || x === (scan + 1) % this.cols) return energy;
        const scan2 = this.cols - 1 - (Math.floor(t * 1.9) % this.cols);
        if (y % 2 === 0 && x === scan2) return energy * 0.7;
        return 0;
      }
      case "diagonal": {
        const band = Math.floor(t * 5) % (this.cols + this.rows);
        if (x + y === band || x + y === (band + 1) % (this.cols + this.rows)) {
          return energy;
        }
        const band2 =
          (this.cols + this.rows - 1 - Math.floor(t * 2.4)) %
          (this.cols + this.rows);
        if (x + Math.floor(y * 0.5) === band2) return energy * 0.65;
        return 0;
      }
      case "ring": {
        const cx = this.scanOriginX;
        const cy = this.scanOriginY;
        const radius = (this.ringAge * 18) % (Math.max(this.cols, this.rows) + 6);
        const d = Math.hypot(x - cx, y - cy);
        if (Math.abs(d - radius) < 1.2) return energy;
        if (Math.abs(d - (radius * 0.55) % 12) < 0.9) return energy * 0.55;
        return 0;
      }
      case "rain": {
        const colSpeed = 3 + ((x * 17 + this.seed) % 5);
        const drop = Math.floor(t * colSpeed + x * 3.1 + (this.seed % 9)) %
          (this.rows + 4);
        if (y === drop || y === drop - 1) return energy * (0.7 + (x % 3) * 0.1);
        if ((x + Math.floor(t * 2)) % 5 === 0 && y === (drop + 3) % this.rows) {
          return energy * 0.45;
        }
        return 0;
      }
      default: {
        const _exhaustive: never = m.scan;
        void _exhaustive;
        return 0;
      }
    }
  }

  update(dt: number): void {
    this.time += dt;
    if (this.phase === "generating") this.ringAge += dt;
    this.wave *= this.options.reducedMotion ? 0.95 : 0.988;
    const motion = this.options.reducedMotion ? 0.22 : 1;
    const t = this.time;
    const m = this.mode;
    const decay = this.options.reducedMotion ? 0.94 : m.decay;

    this.advect(dt);

    for (let y = 0; y < this.rows; y += 1) {
      for (let x = 0; x < this.cols; x += 1) {
        const i = this.idx(x, y);
        this.heat[i] *= decay;

        const nx = x / Math.max(1, this.cols);
        const ny = y / Math.max(1, this.rows);
        let field: number;

        if (m.name === "vortex") {
          const dx = nx - 0.5;
          const dy = ny - 0.5;
          const ang = Math.atan2(dy, dx);
          const rad = Math.hypot(dx, dy);
          field =
            Math.sin(ang * 3 + t * m.speed * 2 - rad * 10) *
            Math.cos(rad * 8 - t * m.speed);
        } else if (m.name === "lattice") {
          field =
            Math.sin(x * m.sx + t * m.speed) *
              Math.sin(y * m.sy - t * m.speed * 0.8) *
              1.1 +
            Math.sin((x + y) * 0.35 - t * 0.4) * 0.35;
        } else {
          const w1 = Math.sin(t * m.speed + x * m.sx + y * m.sy);
          const w2 = Math.cos(t * m.speed * 0.62 + x * 0.14 - y * 0.19);
          const w3 = Math.sin((x - y) * 0.22 - t * m.speed * 1.1);
          const w4 =
            Math.sin(x * 0.08 + t * m.speed * 0.45) *
            Math.cos(y * 0.11 - t * m.speed * 0.35);
          field = (w1 * w2 + w3 * 0.65 + w4 * 0.45) * 0.55;
        }

        const gate =
          (Math.sin(t * (0.55 + m.speed * 0.4) + (x + y) * 0.85) + 1) * 0.5;
        let idle = 0.028;
        if (gate > m.gate) {
          idle = 0.1 + Math.max(0, field) * 0.26 * motion;
        }
        if (gate > m.gate + 0.25) {
          idle = Math.max(idle, 0.24 + Math.max(0, field) * 0.4 * motion);
        }

        let v = Math.max(this.heat[i], idle + this.wave * 0.2);
        v = Math.max(v, this.scanBoost(x, y, t));

        const crest = Math.sin(
          x * (0.35 + m.sx * 0.3) - t * m.speed * 1.6 + y * 0.15,
        );
        if (crest > m.crest) {
          v = Math.max(v, 0.32 + this.wave * 0.22);
        }

        this.heat[i] = Math.min(1.25, v);
      }
    }
  }

  draw(): void {
    const lines: string[] = [];
    const softLast = RAMP_SOFT.length - 1;
    const hot = this.mode.rampHot;
    const hotLast = hot.length - 1;
    const useBlocks = hot === RAMP_BLOCK;

    for (let y = 0; y < this.rows; y += 1) {
      let line = "";
      for (let x = 0; x < this.cols; x += 1) {
        const h = this.heat[this.idx(x, y)];

        if (useBlocks && h > 0.45) {
          const q =
            h < 0.55 ? 1 : h < 0.7 ? 2 : h < 0.88 ? 3 : h < 1.05 ? 4 : hotLast;
          line += hot[q] ?? "█";
          continue;
        }

        const q =
          h < 0.07
            ? 0
            : h < 0.16
              ? 1
              : h < 0.3
                ? 3
                : h < 0.5
                  ? 5
                  : h < 0.72
                    ? 7
                    : softLast;
        line += RAMP_SOFT[q] ?? " ";
      }
      lines.push(line);
    }
    if (this.target) this.target.textContent = lines.join("\n");
  }

  dispose(): void {
    this.target = null;
  }
}
