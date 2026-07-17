"use client";

import type { NotePhase } from "@/types/notes";

export type SessionStats = {
  offered: number;
  accepted: number;
  dismissed: number;
};

type StatusLineProps = {
  phase: NotePhase;
  stats: SessionStats;
};

export function StatusLine({ phase, stats }: StatusLineProps) {
  return (
    <div
      className="status-line"
      aria-live="polite"
      data-phase={phase}
    >
      <div className="status-line__stats">
        <span>
          <span className="status-line__stat-label">suggestions</span>{" "}
          {stats.offered}
        </span>
        <span className="status-line__sep" aria-hidden="true">
          ·
        </span>
        <span>
          <span className="status-line__stat-label">accepted</span>{" "}
          {stats.accepted}
        </span>
        <span className="status-line__sep" aria-hidden="true">
          ·
        </span>
        <span>
          <span className="status-line__stat-label">dismissed</span>{" "}
          {stats.dismissed}
        </span>
      </div>
    </div>
  );
}
