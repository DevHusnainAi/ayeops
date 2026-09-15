"use client";

// App Router error boundary: catches a render-time crash anywhere under this route and shows a recoverable
// screen instead of a blank page. The voice session itself already survives malformed events (lib/relay.ts's
// reduce() catches those) -- this is the backstop for a bug in the rendering, not the data.
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="grid min-h-dvh place-items-center px-6 text-center">
      <div className="max-w-sm">
        <p className="font-mono text-[11px] font-semibold tracking-[0.14em] text-down uppercase">Something broke</p>
        <p className="mt-3 text-[15px] text-ink">
          The dashboard hit a rendering error. The voice session, if one is running, isn&rsquo;t affected.
        </p>
        {error.message && <p className="mt-2 font-mono text-[12px] text-muted-2">{error.message}</p>}
        <div className="mt-6 flex justify-center gap-3">
          <button type="button" onClick={reset} className="rounded-md bg-accent px-4 py-2 text-[13px] font-semibold text-accent-ink">
            Try again
          </button>
          <button type="button" onClick={() => location.reload()} className="rounded-md border border-line px-4 py-2 text-[13px] text-ink">
            Reload
          </button>
        </div>
      </div>
    </main>
  );
}
