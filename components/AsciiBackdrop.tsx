"use client";

import { useEffect, useRef } from "react";
import { AsciiTerminalViz } from "@/lib/ascii-terminal-viz";
import type { VisualizationEvent } from "@/lib/visualization-events";

type AsciiBackdropProps = {
  events: VisualizationEvent[];
  pulseKey: string;
  reducedMotion: boolean;
};

export function AsciiBackdrop({
  events,
  pulseKey,
  reducedMotion,
}: AsciiBackdropProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const preRef = useRef<HTMLPreElement>(null);
  const vizRef = useRef<AsciiTerminalViz | null>(null);
  const cursorRef = useRef(0);
  const eventsRef = useRef(events);
  const reducedRef = useRef(reducedMotion);

  useEffect(() => {
    eventsRef.current = events;
    if (events.length < cursorRef.current) {
      cursorRef.current = 0;
      vizRef.current?.pushEvent({ type: "reset", at: performance.now() });
    }
  }, [events]);

  useEffect(() => {
    reducedRef.current = reducedMotion;
    vizRef.current?.setOptions({ reducedMotion });
  }, [reducedMotion]);

  useEffect(() => {
    if (!pulseKey || !vizRef.current) return;
    const [seed, index] = pulseKey.split("::");
    vizRef.current.pulse(seed || "pulse", Number(index) || 0);
  }, [pulseKey]);

  useEffect(() => {
    const pre = preRef.current;
    const wrap = wrapRef.current;
    if (!pre || !wrap) return;

    const viz = new AsciiTerminalViz(pre);
    vizRef.current = viz;
    viz.setOptions({ reducedMotion: reducedRef.current, opacity: 0.55 });

    cursorRef.current = 0;
    const queue = eventsRef.current;
    while (cursorRef.current < queue.length) {
      viz.pushEvent(queue[cursorRef.current]);
      cursorRef.current += 1;
    }

    let raf = 0;
    let last = performance.now();
    let disposed = false;

    const measureCell = (): { cellW: number; cellH: number } => {
      const style = getComputedStyle(pre);
      const probe = document.createElement("span");
      probe.textContent = "MMMMMMMMMM";
      probe.style.cssText =
        "position:absolute;visibility:hidden;pointer-events:none;white-space:pre;";
      pre.appendChild(probe);
      const box = probe.getBoundingClientRect();
      probe.remove();
      const lineH = Number.parseFloat(style.lineHeight);
      return {
        cellW: Math.max(1, box.width / 10),
        cellH: Number.isFinite(lineH) && lineH > 0 ? lineH : Math.max(1, box.height),
      };
    };

    const resize = () => {
      const rect = wrap.getBoundingClientRect();
      const style = getComputedStyle(pre);
      const padX =
        Number.parseFloat(style.paddingLeft) +
        Number.parseFloat(style.paddingRight);
      const padY =
        Number.parseFloat(style.paddingTop) +
        Number.parseFloat(style.paddingBottom);
      const { cellW, cellH } = measureCell();
      viz.resize(
        Math.max(0, rect.width - padX),
        Math.max(0, rect.height - padY),
        cellW,
        cellH,
      );
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(wrap);

    const tick = (now: number) => {
      if (disposed) return;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const q = eventsRef.current;
      while (cursorRef.current < q.length) {
        viz.pushEvent(q[cursorRef.current]);
        cursorRef.current += 1;
      }
      viz.update(dt);
      viz.draw();
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      observer.disconnect();
      viz.dispose();
      vizRef.current = null;
    };
  }, []);

  return (
    <div className="ascii-backdrop" ref={wrapRef} aria-hidden="true">
      <pre ref={preRef} className="ascii-backdrop__pre" />
    </div>
  );
}
