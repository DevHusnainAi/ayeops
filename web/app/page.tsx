"use client";

import { useRef } from "react";
import { BRAND } from "@/lib/brand";
import { useRelay } from "@/lib/relay";
import {
  ApiPanel, BTN, BTN_QUIET, LinkBanner, LogTape, Panel, ReportDialog, Resolution, Slip, Speaking, Strips, TopBar, Transcript, Waveform,
} from "./components";

function Welcome({ onStart }: { onStart: (withMic: boolean) => void }) {
  return (
    <main className="grid min-h-dvh place-items-center px-6">
      <div className="max-w-xl">
        <p className="text-[11px] font-semibold tracking-[0.22em] text-muted uppercase">Voice incident command</p>
        <h1 className="mt-2 font-display text-[clamp(3.5rem,10vw,7rem)] leading-[0.9] font-extrabold uppercase">{BRAND}</h1>
        <p className="mt-5 text-lg leading-relaxed text-ink/85">
          It pages you when production breaks, finds the cause on its own, and changes nothing until you authorize the
          fix with your voice, by reading a code the AI never sees.
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <button type="button" className={`${BTN} px-5 py-2.5 text-base`} onClick={() => onStart(true)}>
            Start session
          </button>
          <button type="button" className={`${BTN_QUIET} px-5 py-2.5 text-base`} onClick={() => onStart(false)}>
            Watch without a microphone
          </button>
        </div>
        <p className="mt-3 text-sm text-muted">Start session uses your microphone. Wear headphones so the agent doesn’t hear itself.</p>
      </div>
    </main>
  );
}

export default function Home() {
  const { state: s, start, levels, shipBadDeploy, cutLink } = useRelay();
  const report = useRef<HTMLDialogElement>(null);
  if (!s.started) return <Welcome onStart={start} />;
  return (
    <main className="flex min-h-dvh flex-col lg:h-dvh">
      <TopBar s={s} onFault={shipBadDeploy} onCut={cutLink} />
      <LinkBanner s={s} />
      <div className="grid flex-1 gap-4 p-4 lg:min-h-0 lg:grid-cols-12">
        <div className="flex flex-col gap-4 lg:order-2 lg:col-span-7 lg:min-h-0">
          <Slip gate={s.gate} progress={s.progress} mic={s.mic} />
          {s.phase === "resolved" && s.ttr !== undefined && <Resolution ttr={s.ttr} onOpen={() => report.current?.showModal()} />}
          <Panel title="Voice" aside={<Speaking s={s} />} className="min-h-72 lg:flex-1">
            <div className="flex h-full flex-col">
              <div className="border-b border-rule px-4 py-2">
                <Waveform levels={levels} />
              </div>
              <div className="min-h-0 flex-1">
                <Transcript lines={s.lines} live={s.live} />
              </div>
            </div>
          </Panel>
        </div>
        <div className="flex flex-col gap-4 lg:order-1 lg:col-span-5 lg:min-h-0">
          <Panel title="Services">
            <Strips services={s.services} />
          </Panel>
          <Panel title="Logs" className="min-h-64 lg:flex-1">
            <LogTape logs={s.logs} />
          </Panel>
        </div>
      </div>
      <ApiPanel events={s.events} />
      <ReportDialog report={s.report} dialog={report} />
    </main>
  );
}
