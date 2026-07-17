type PixelLoaderProps = {
  label: string;
  progress?: number;
  error?: string | null;
  onRetry?: () => void;
};

/** Terminal boot screen with a 2-bit pixel spinner. */
export function PixelLoader({ label, progress, error, onRetry }: PixelLoaderProps) {
  const pct =
    typeof progress === "number" && Number.isFinite(progress)
      ? Math.max(0, Math.min(100, Math.round(progress * 100)))
      : null;

  return (
    <div className="boot" role="status" aria-live="polite" aria-busy={!error}>
      <div className="boot__spinner" aria-hidden="true">
        <span />
        <span />
        <span />
        <span />
      </div>
      <p className="boot__label">{error ? "error" : label}</p>
      {pct != null && !error ? (
        <div
          className="boot__bar"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
          aria-label="load"
        >
          <div className="boot__bar-fill" style={{ width: `${pct}%` }} />
        </div>
      ) : null}
      {pct != null && !error ? <p className="boot__label">{pct}%</p> : null}
      {error ? (
        <>
          <p className="boot__error">{error}</p>
          {onRetry ? (
            <button type="button" className="btn" onClick={onRetry}>
              retry
            </button>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
