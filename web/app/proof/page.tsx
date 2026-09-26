"use client";

import { useEffect, useState } from "react";
import { H2, SiteShell } from "../site";

type Bucket = { sessions: number; authorizations: number; turns_searched: number; occurrences: number };
type Proof = { since_fix: Bucket; before_fix: Bucket; fix_commit: string };

function Card({ title, note, b, good }: { title: string; note: string; b: Bucket | null; good: boolean }) {
  return (
    <div className="rounded-lg border border-line bg-panel p-5">
      <p className="text-[12px] font-medium tracking-wide text-muted uppercase">{title}</p>
      <p className={`mt-3 font-mono text-[40px] leading-none font-semibold ${!b ? "text-muted-2" : b.occurrences === 0 ? "text-healthy" : good ? "text-healthy" : "text-degraded"}`}>
        {b ? b.occurrences : "–"}
      </p>
      <p className="mt-1 text-[13px] text-muted">approval codes found on the model&rsquo;s side</p>
      <p className="mt-4 font-mono text-[12px] text-muted-2">
        {b ? `${b.sessions} sessions · ${b.authorizations} authorizations · ${b.turns_searched} turns searched` : "loading"}
      </p>
      <p className="mt-3 text-[12.5px] leading-snug text-muted">{note}</p>
    </div>
  );
}

export default function ProofPage() {
  const [p, setP] = useState<Proof | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    fetch("/api/proof").then((r) => r.json()).then(setP).catch(() => setFailed(true));
  }, []);

  return (
    <SiteShell current="proof">
      <p className="mt-14 text-[12px] font-medium tracking-[0.2em] text-accent uppercase">Proof</p>
      <h1 className="mt-3 text-[clamp(2rem,4.5vw,3rem)] leading-[1.05] font-bold tracking-tight text-ink text-balance max-w-4xl">
        The claim is that the model never sees the code. This page checks it.
      </h1>
      <p className="mt-5 max-w-3xl text-[1.02rem] leading-relaxed text-muted">
        Every session is recorded by AssemblyAI, a party the operator does not control. A checker reads that record
        and searches everything on the model&rsquo;s side for the approval code the operator read back: system prompts,
        tool schemas, every tool call and result, every reply instruction, every agent turn. It runs on the live server
        each time this page loads. It reports totals only — never audio or transcripts.
      </p>

      {failed && <p className="mt-8 text-[13px] text-down">The proof service could not be reached.</p>}
      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        <Card
          title={`Since the fix (${p?.fix_commit ?? "13664f2"})`}
          note="Every session recorded after the fix. This number is meant to stay at zero."
          b={p?.since_fix ?? null}
          good
        />
        <Card
          title="Before the fix"
          note="The checker&rsquo;s first run found the spent code in the post-incident record handed to the model. It could not be replayed, but the claim only holds with no exceptions, so it was closed and a test now fails on the old behaviour."
          b={p?.before_fix ?? null}
          good={false}
        />
      </div>

      <H2 id="run">Run it yourself</H2>
      <pre className="mt-4 overflow-x-auto rounded-lg border border-line bg-panel p-4 font-mono text-[12.5px] leading-relaxed text-ink">{`git clone https://github.com/DevHusnainAi/ayeops.git && cd ayeops/backend
uv run prove_blind.py --selftest   # the checker fails on a planted leak, passes a clean session
uv run prove_blind.py incidents/   # run it on any recorded sessions`}</pre>
      <p className="mt-4 max-w-3xl text-[13.5px] leading-relaxed text-muted">
        The one place a code may appear is the operator&rsquo;s own readback turn, after the operator said it. The
        operator&rsquo;s speech reaches the model as a transcript, as it must. What the model cannot do is see a code
        before a human speaks it, produce one, or approve on its own: the relay, not the model, checks the readback and
        runs the change.
      </p>

      <H2 id="also">Also checkable</H2>
      <ul className="mt-4 max-w-3xl space-y-2 text-[13.5px] leading-relaxed text-muted">
        <li>
          <a className="text-accent underline decoration-line underline-offset-4" href="/">The Break it scoreboard</a>{" "}
          counts every attempt the relay stopped. Its second number is computed, not claimed: changes executed minus
          changes that passed a voice-verified readback.
        </li>
        <li>
          <a className="text-accent underline decoration-line underline-offset-4" href="https://github.com/DevHusnainAi/ayeops/actions">CI</a>{" "}
          runs the full offline suite, including the test that fails if a code ever reaches the model, on every push.
        </li>
        <li>
          <a className="text-accent underline decoration-line underline-offset-4" href="/history/">History</a>{" "}
          lists every resolved incident with its postmortem, recovery numbers and timeline.
        </li>
      </ul>
    </SiteShell>
  );
}
