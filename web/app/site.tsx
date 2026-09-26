import type { ReactNode } from "react";
import { BRAND } from "@/lib/brand";

// Shared chrome for the explainer pages (/how, /proof): the same wordmark and nav as the start page.
export function SiteShell({ children, current }: { children: ReactNode; current: "how" | "proof" }) {
  const link = (href: string, label: string, id?: string) => (
    <a href={href} className={`transition-colors hover:text-ink ${id === current ? "text-ink" : ""}`}>{label}</a>
  );
  return (
    <main className="min-h-dvh bg-board">
      <div className="w-full px-6 py-8 lg:px-10">
        <header className="flex items-center justify-between gap-4">
          <a href="/" className="font-mono text-[15px] font-semibold tracking-[0.02em] uppercase">
            {BRAND}<span className="text-accent">.</span>
          </a>
          <nav aria-label="Site" className="flex items-center gap-4 text-[13px] text-muted">
            {link("/how/", "How it works", "how")}
            {link("/proof/", "Proof", "proof")}
            {link("/history/", "History")}
            <a href="/" className="rounded-md bg-accent px-3 py-1.5 font-semibold text-accent-ink hover:opacity-90">Try it</a>
          </nav>
        </header>
        {children}
        <footer className="mt-20 border-t border-line pt-6 text-[12px] text-muted-2">
          Built on the AssemblyAI Voice Agent API ·{" "}
          <a className="underline decoration-line underline-offset-4 hover:text-ink" href="https://github.com/DevHusnainAi/ayeops">Source on GitHub</a>
        </footer>
      </div>
    </main>
  );
}

export function H2({ id, children }: { id: string; children: ReactNode }) {
  return <h2 id={id} className="mt-16 scroll-mt-8 text-[1.5rem] font-bold tracking-tight text-ink">{children}</h2>;
}
