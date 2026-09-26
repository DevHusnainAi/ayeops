import { H2, SiteShell } from "../site";

const STEPS = [
  ["Page", "A health poll sees the outage. The agent speaks first: what broke and what it affects."],
  ["Triage", "It reads health and logs on its own authority. Read-only tools only."],
  ["Propose", "It states the root cause and proposes exactly one fix. The change tool exists only while an incident is open."],
  ["Readback", "The operator's screen shows a one-time code. They say the action, the service and the code together."],
  ["Verify", "The relay, not the model, scores the readback. A wrong, partial or code-only readback executes nothing."],
  ["Execute", "The relay runs exactly the authorized change on the cluster and narrates it."],
  ["Report", "A postmortem is filed with the cause, the action items, and AssemblyAI's own record of the session."],
];

const RULES = [
  ["A code alone never authorizes", "The operator must say the action and the service too, so they show they know what they are approving."],
  ["The model cannot execute", "There is no execute tool. Tools are scoped to the phase, and the model's schema has no way to change anything."],
  ["A restart on a bad deploy is refused", "It would crash-loop again. The relay cites the commit that broke it and proposes the rollback."],
  ["A rollback with nothing to undo is refused", "Nothing was deployed, so it would change nothing. The relay proposes a restart."],
  ["A restart on a backlog is refused", "The queue would refill at once. The relay proposes scaling out."],
  ["Logs and supplied text are data", "A line that claims the operator approved something is flagged and ignored. Approval only ever comes from the operator's voice."],
  ["One code, one execution", "Codes are random, single-use and expire after two minutes. Re-reading a spent or expired code runs nothing, and every new proposal gets a new code."],
];

export default function HowPage() {
  return (
    <SiteShell current="how">
      <p className="mt-14 text-[12px] font-medium tracking-[0.2em] text-accent uppercase">How it works</p>
      <h1 className="mt-3 text-[clamp(2rem,4.5vw,3.2rem)] leading-[1.05] font-bold tracking-tight text-ink text-balance">
        An AI that can fix production, and cannot change a thing until a human reads back a code it never saw.
      </h1>
      <div className="mt-8 flex flex-wrap gap-3">
        <a href="/" className="rounded-md bg-accent px-4 py-2.5 text-[14px] font-semibold text-accent-ink hover:opacity-90">Try it — no signup</a>
        <a href="/proof/" className="rounded-md border border-line px-4 py-2.5 text-[14px] font-medium text-ink hover:border-line-strong hover:bg-panel-2">See the proof</a>
      </div>

      <H2 id="why">Why</H2>
      <p className="mt-4 text-[1rem] leading-relaxed text-muted">
        The worst outages are often made worse by the fix. In January 2017 an engineer at GitLab, working through a
        struggling database, ran a delete on the wrong server and removed about 300 GB of production data
        (<a className="text-accent underline decoration-line underline-offset-4" href="https://about.gitlab.com/blog/postmortem-of-database-outage-of-january-31/">GitLab&rsquo;s own postmortem</a>).
        In August 2012 a deployment error cost Knight Capital about $440 million in roughly 45 minutes, and the SEC found it
        had no adequate safeguards
        (<a className="text-accent underline decoration-line underline-offset-4" href="https://www.sec.gov/newsroom/press-releases/2013-222">SEC</a>).
      </p>
      <p className="mt-4 text-[1rem] leading-relaxed text-muted">
        At 3am the on-call engineer is impaired, alone and unaccountable. An AI that can restart production is an audit
        finding unless someone can show who authorized what. AyeOps does the thinking, and leaves the authority to a human
        with a check the model cannot fake.
      </p>

      <H2 id="how">How it works</H2>
      <p className="mt-4 text-[1rem] leading-relaxed text-muted">
        The same instant, two views. The operator sees the code. The model receives a payload that has no code in it,
        because the relay never sends it one.
      </p>
      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <div className="rounded-lg border border-accent/50 bg-panel p-5">
          <p className="text-[11px] font-semibold tracking-wide text-muted uppercase">The operator&rsquo;s screen</p>
          <p className="mt-3 text-[16px] font-semibold text-ink">Roll back auth-service</p>
          <p className="mt-0.5 text-[12.5px] text-muted">v2.14.1 → v2.14.0 · affects api-gateway, billing-worker</p>
          <div className="mt-4 flex gap-2 font-mono text-[15px] font-semibold tracking-wide text-accent">
            <span className="rounded border border-accent/40 bg-accent/10 px-3 py-1.5">LIMA</span>
            <span className="rounded border border-accent/40 bg-accent/10 px-3 py-1.5">CHARLIE</span>
          </div>
          <p className="mt-4 text-[12.5px] text-muted">
            Says: <span className="font-mono text-ink">&ldquo;Roll back auth-service, Lima Charlie.&rdquo;</span>
          </p>
        </div>
        <div className="rounded-lg border border-line bg-panel p-5">
          <p className="text-[11px] font-semibold tracking-wide text-muted uppercase">What the model received</p>
          <pre className="mt-3 overflow-x-auto font-mono text-[11.5px] leading-relaxed text-muted">{`{
  "status": "awaiting_authorization",
  "plan": "roll auth-service back to its
           previous version",
  "affected": ["api-gateway",
               "billing-worker"],
  "instruction": "Nothing has changed. …ask
    the operator to read back the action,
    the service and the code from their
    screen. You do not know the code.",
  "what_this_undoes": "e4f5061: Skip JWKS…"
}`}</pre>
          <p className="mt-3 text-[12px] text-muted-2">There is no code field. The dashboard shows this payload live, beside the operator&rsquo;s screen.</p>
        </div>
      </div>

      <ol className="mt-8 space-y-3">
        {STEPS.map(([t, d], i) => (
          <li key={t} className="flex gap-4 rounded-lg border border-line bg-panel/60 p-4">
            <span className="font-mono text-[13px] font-semibold text-accent">{String(i + 1).padStart(2, "0")}</span>
            <div>
              <p className="text-[14px] font-semibold text-ink">{t}</p>
              <p className="mt-0.5 text-[13.5px] leading-snug text-muted">{d}</p>
            </div>
          </li>
        ))}
      </ol>

      <H2 id="rules">Rules the relay enforces</H2>
      <p className="mt-4 text-[1rem] leading-relaxed text-muted">
        These are checked in code, not requested in a prompt, and each has a test in the repository.
      </p>
      <dl className="mt-6 divide-y divide-line rounded-lg border border-line bg-panel/60">
        {RULES.map(([t, d]) => (
          <div key={t} className="px-4 py-3.5">
            <dt className="text-[14px] font-semibold text-ink">{t}</dt>
            <dd className="mt-0.5 text-[13.5px] leading-snug text-muted">{d}</dd>
          </div>
        ))}
      </dl>

      <H2 id="measured">Measured</H2>
      <p className="mt-4 text-[1rem] leading-relaxed text-muted">
        On real Docker containers against the real API, including a deliberate mid-incident link cut. Time to recover
        runs from detection to all-green, and latency from the operator&rsquo;s last voiced frame.
      </p>
      <div className="mt-6 overflow-x-auto rounded-lg border border-line">
        <table className="w-full min-w-80 text-left text-[13.5px]">
          <tbody className="divide-y divide-line">
            {[
              ["Bad deploy → all green", "29 s"],
              ["Turn latency", "0.84–1.09 s"],
              ["Recovery from connection loss", "1.8 s, context intact"],
              ["Rollback → all green", "4.1 s"],
            ].map(([k, v]) => (
              <tr key={k}><td className="px-4 py-3 text-muted">{k}</td><td className="px-4 py-3 font-mono font-semibold text-ink">{v}</td></tr>
            ))}
          </tbody>
        </table>
      </div>

      <H2 id="proof">Proof, and a challenge</H2>
      <p className="mt-4 text-[1rem] leading-relaxed text-muted">
        <a className="text-accent underline decoration-line underline-offset-4" href="/proof/">The proof page</a> runs a checker
        over AssemblyAI&rsquo;s own record of every session and reports how many approval codes it found on the
        model&rsquo;s side. The start page has a public scoreboard of every attempt to bypass the gate. It is open:
        plant instructions in a real log, talk it into the wrong fix, read it a wrong code. Any other agent can plug in
        the same way: it asks over HTTP, and a human&rsquo;s voice decides.
      </p>
      <div className="mt-6 flex flex-wrap gap-3">
        <a href="/" className="rounded-md bg-accent px-4 py-2.5 text-[14px] font-semibold text-accent-ink hover:opacity-90">Break it</a>
        <a href="https://github.com/DevHusnainAi/ayeops" className="rounded-md border border-line px-4 py-2.5 text-[14px] font-medium text-ink hover:border-line-strong hover:bg-panel-2">Read the code</a>
      </div>
    </SiteShell>
  );
}
