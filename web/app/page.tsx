"use client";

import { useState } from "react";
import { BRAND } from "@/lib/brand";
import { useRelay, type CustomScenario } from "@/lib/relay";
import {
  ActivityFeed, ApiPanel, AppHeader, BTN, BTN_QUIET, CodeWords, DemoControls, IncidentBar, LinkToast,
  LiveAgentRequest, LiveClearance, LogTape, Panel, PrecedentCard, ReportDrawer, Speaking, Strips, Waveform,
  WatchingHero,
} from "./components";

function HeroWaveform() {
  const bars = [0.3, 0.7, 0.45, 0.9, 0.55, 0.35, 0.8, 0.5, 0.65, 0.4, 0.85, 0.3, 0.6, 0.75, 0.4, 0.55];
  return (
    <div className="flex h-8 items-center gap-[3px]" aria-hidden>
      {bars.map((h, i) => (
        <span
          key={i}
          className="w-[3px] rounded-full bg-ink/25"
          style={{
            height: `${h * 100}%`,
            animation: `hero-wave 1.6s ease-in-out ${i * 0.07}s infinite`,
          }}
        />
      ))}
    </div>
  );
}

// A static, self-contained mock of the live clearance card -- no session required, so the very first thing a
// visitor sees is the product's actual differentiator, not a promise of it.
function HeroPreview() {
  return (
    <div className="relative w-full max-w-sm">
      <div aria-hidden className="absolute -inset-6 -z-10 rounded-[2rem] bg-accent/10 blur-2xl" />
      <div className="animate-rise relative overflow-hidden rounded-lg border border-accent/50 bg-panel p-5">
        <span aria-hidden className="absolute top-5 right-5 size-2 rounded-full bg-accent" />
        <div className="flex items-center gap-2 text-[11px] font-semibold tracking-wide text-muted uppercase">
          Awaiting voice authorization
        </div>
        <p className="mt-3 text-[16px] font-semibold text-ink">Roll back auth-service</p>
        <p className="mt-0.5 text-[12.5px] text-muted">v2.14.1 → v2.14.0 · affects api-gateway, billing-worker</p>
        <div className="mt-4"><CodeWords words={["LIMA", "CHARLIE"]} /></div>
        <p className="mt-3 text-[12.5px] text-muted">
          Say: <span className="font-mono text-ink">&ldquo;Roll back auth-service, Lima Charlie.&rdquo;</span>
        </p>
        <div aria-hidden className="mt-4 h-1 overflow-hidden rounded-full bg-line">
          <div className="h-full w-2/3 bg-accent" />
        </div>
        <div className="mt-4 flex items-center justify-between border-t border-line pt-3">
          <HeroWaveform />
          <span className="font-mono text-[11px] text-muted-2">0.9s turn latency</span>
        </div>
      </div>
      <style jsx>{`
        @keyframes hero-wave {
          0%, 100% { transform: scaleY(0.4); }
          50% { transform: scaleY(1); }
        }
      `}</style>
    </div>
  );
}

function Welcome({ onStart }: { onStart: (withMic: boolean, autopilot?: boolean, scenario?: CustomScenario) => void }) {
  const [svc, setSvc] = useState("");
  const [errLine, setErrLine] = useState("");
  const [showCustom, setShowCustom] = useState(false);
  const scenario: CustomScenario = svc.trim() ? { service: svc.trim(), ...(errLine.trim() ? { errorLine: errLine.trim() } : {}) } : null;

  return (
    <main className="relative min-h-dvh overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(60rem 40rem at 82% 8%, color-mix(in oklab, var(--color-accent) 10%, transparent), transparent 60%)," +
            "radial-gradient(46rem 30rem at 8% 92%, color-mix(in oklab, var(--color-remediating) 8%, transparent), transparent 55%)",
        }}
      />
      <div className="relative mx-auto flex min-h-dvh max-w-6xl flex-col px-6 py-8 lg:px-10">
        <header className="flex items-center gap-2.5">
          <span className="font-mono text-[15px] font-semibold tracking-[0.02em] uppercase">
            {BRAND}<span className="text-accent">.</span>
          </span>
        </header>

        <div className="grid flex-1 items-center gap-16 py-10 lg:grid-cols-[1.1fr_0.9fr] lg:gap-10">
          <div>
            <div className="mb-6 flex items-center gap-2.5">
              <span aria-hidden className="size-1.5 rounded-full bg-healthy" />
              <p className="font-mono text-[11px] font-medium tracking-[0.24em] text-muted uppercase">Voice incident command</p>
            </div>
            <h1 className="max-w-xl text-[clamp(2.6rem,5.5vw,4.2rem)] leading-[1.02] font-bold tracking-tight text-ink text-balance">
              No AI touches production without a human&rsquo;s informed voice.
            </h1>
            <p className="mt-6 max-w-lg text-[1.08rem] leading-relaxed text-muted">
              {BRAND} pages you when production breaks, finds the cause on its own, and changes nothing until you
              authorize the fix — by reading a code the AI is never shown.
            </p>
            <div className="mt-9 flex flex-wrap items-center gap-3">
              <button type="button" className={`${BTN} px-5 py-2.5 text-[14px]`} onClick={() => onStart(true, undefined, scenario)}>
                Start session
              </button>
              <button type="button" className={`${BTN_QUIET} px-5 py-2.5 text-[14px]`} onClick={() => onStart(false, true, scenario)}>
                Run the demo for me
              </button>
              <button
                type="button"
                className="px-1 py-2.5 text-[14px] text-muted underline decoration-line underline-offset-4 transition-colors hover:text-ink hover:decoration-muted"
                onClick={() => onStart(false, false, scenario)}
              >
                Watch without a microphone
              </button>
            </div>
            <p className="mt-5 max-w-lg text-[13px] text-muted-2">
              Start session uses your microphone — wear headphones so the agent doesn&rsquo;t hear itself. Run the
              demo for me plays both sides of the incident unattended, no mic required.
            </p>

            {/* Bring your own incident — personalize the scenario with a real service name and error line */}
            <div className="mt-8 max-w-lg">
              <button
                type="button"
                onClick={() => setShowCustom((o) => !o)}
                className="flex items-center gap-2 rounded-md border border-line bg-panel px-3 py-2 text-[13px] text-muted transition-colors hover:border-accent/40 hover:text-ink"
              >
                <span aria-hidden className={`text-[10px] transition-transform ${showCustom ? "rotate-90" : ""}`}>▶</span>
                Bring your own incident
              </button>
              {showCustom && (
                <div className="mt-3 space-y-3 rounded-lg border border-line bg-panel/60 p-4">
                  <div>
                    <label htmlFor="byoi-svc" className="mb-1 block text-[11.5px] text-muted">Service name</label>
                    <input
                      id="byoi-svc"
                      type="text"
                      placeholder="e.g. payment-processor"
                      value={svc}
                      onChange={(e) => setSvc(e.target.value)}
                      className="w-full rounded-md border border-line bg-panel-2 px-3 py-1.5 font-mono text-[13px] text-ink placeholder:text-muted-2 focus:border-accent focus:outline-none"
                    />
                  </div>
                  <div>
                    <label htmlFor="byoi-err" className="mb-1 block text-[11.5px] text-muted">Error line from your logs (optional)</label>
                    <input
                      id="byoi-err"
                      type="text"
                      placeholder="e.g. FATAL connection pool exhausted, no healthy upstream"
                      value={errLine}
                      onChange={(e) => setErrLine(e.target.value)}
                      className="w-full rounded-md border border-line bg-panel-2 px-3 py-1.5 font-mono text-[13px] text-ink placeholder:text-muted-2 focus:border-accent focus:outline-none"
                    />
                  </div>
                  <p className="text-[11px] text-muted-2">
                    The agent will triage your service as if it broke. Everything else — voice session, readback,
                    authorization — works exactly the same.
                  </p>
                </div>
              )}
            </div>

            <dl className="mt-14 grid max-w-lg grid-cols-2 gap-6 border-t border-line pt-6 sm:grid-cols-4">
              {[
                ["Blind", "The approval code never enters the model's context"],
                ["Voiced", "A human reads the change back to prove they understood it"],
                ["Refuses", "Declines a fix it already knows won't hold, and says why"],
                ["Logged", "Every authorization ships with a recording and a timeline"],
              ].map(([k, v]) => (
                <div key={k}>
                  <dt className="font-mono text-[13px] font-semibold text-accent">{k}</dt>
                  <dd className="mt-1 text-[12.5px] leading-snug text-muted">{v}</dd>
                </div>
              ))}
            </dl>
          </div>

          <div className="flex justify-center lg:justify-end">
            <HeroPreview />
          </div>
        </div>

        <footer className="border-t border-line py-5 font-mono text-[11px] tracking-[0.14em] text-muted-2 uppercase">
          Built on the AssemblyAI Voice Agent API
        </footer>
      </div>
    </main>
  );
}

export default function Home() {
  const { state: s, start, levels, shipBadDeploy, cutLink, injectPrompt } = useRelay();
  const [reportOpen, setReportOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  if (!s.started) return <Welcome onStart={start} />;

  const liveGate = s.gate && (s.phase === "triage" || s.phase === "mitigation") ? s.gate : null;
  const liveAgentRequest = s.agentRequest?.state === "pending" ? s.agentRequest : null;
  const resting = !liveGate && !liveAgentRequest && (s.phase === "starting" || s.phase === "monitoring");

  return (
    <main className="relative flex min-h-dvh flex-col lg:h-dvh">
      <AppHeader s={s} onOpenReport={() => setReportOpen(true)} onToggleTools={() => setToolsOpen((o) => !o)} toolsOpen={toolsOpen} />
      <DemoControls s={s} open={toolsOpen} onClose={() => setToolsOpen(false)} onFault={shipBadDeploy} onCut={cutLink} onInject={injectPrompt} />
      <IncidentBar s={s} />
      <LinkToast s={s} />

      {resting ? (
        <WatchingHero services={s.services} />
      ) : (
        <div className="grid min-h-0 flex-1 gap-5 overflow-y-auto p-5 lg:grid-cols-12 lg:overflow-visible lg:p-6">
          <div className="flex flex-col gap-5 lg:col-span-4 lg:min-h-0">
            <Panel title="Services">
              <Strips services={s.services} />
            </Panel>
            <Panel title="Logs" className="lg:min-h-0 lg:flex-1">
              <LogTape logs={s.logs} highlight={s.gate?.evidence?.crash_line} />
            </Panel>
          </div>

          <div className="flex flex-col gap-5 lg:col-span-8 lg:min-h-0">
            {s.precedent && <PrecedentCard precedent={s.precedent} />}
            {liveGate && <LiveClearance gate={liveGate} mic={s.mic} />}
            {liveAgentRequest && <LiveAgentRequest req={liveAgentRequest} />}
            <Panel title="Activity" aside={<Speaking s={s} />} className="lg:min-h-0 lg:flex-1">
              <div className="flex h-full flex-col">
                <div className="px-4 pb-1">
                  <Waveform levels={levels} />
                </div>
                <div className="min-h-0 flex-1">
                  <ActivityFeed s={s} />
                </div>
              </div>
            </Panel>
          </div>
        </div>
      )}

      <ApiPanel events={s.events} />
      <ReportDrawer s={s} open={reportOpen} onClose={() => setReportOpen(false)} />
    </main>
  );
}
