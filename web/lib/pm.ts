// Parse the postmortem markdown into structured sections for designed rendering,
// instead of dumping raw markdown into a <pre>.
export type PmStats = { detected: string; recovered: string; mttr: string };
export type PmChange = { action: string; service: string; change: string; heard: string };
export type PmRecoveryRow = { service: string; errBefore: string; errAfter: string; p99Before: string; p99After: string };
export type PmTimelineRow = { time: string; event: string; detail: string };
export type PmParsed = {
  sessionId: string;
  stats: PmStats | null;
  changes: PmChange[];
  evidence: string;
  recovery: PmRecoveryRow[];
  timeline: PmTimelineRow[];
};

function splitCells(row: string): string[] {
  return row.split("|").map((c) => c.trim()).filter(Boolean);
}

export function parsePostmortem(md: string): PmParsed {
  const lines = md.split("\n");
  const result: PmParsed = { sessionId: "", stats: null, changes: [], evidence: "", recovery: [], timeline: [] };

  let section: "none" | "recovery" | "timeline" = "none";
  let tableHeaderSeen = false;

  for (const raw of lines) {
    const line = raw.trimEnd();

    // H1 — session id
    if (line.startsWith("# ")) {
      result.sessionId = line.slice(2).replace(/^Incident report\s*/, "").trim();
      continue;
    }

    // H2 — section switch
    if (line.startsWith("## ")) {
      const h = line.slice(3).trim().toLowerCase();
      section = h === "recovery" ? "recovery" : h === "timeline" ? "timeline" : "none";
      tableHeaderSeen = false;
      continue;
    }

    // Table separator row — skip
    if (/^\|[\s-]+\|/.test(line)) continue;

    // Table rows
    if (line.startsWith("|")) {
      const cells = splitCells(line);
      // Header row — detect by checking if first cell is a known header
      if (!tableHeaderSeen && (cells[0] === "time" || cells[0] === "service")) {
        tableHeaderSeen = true;
        continue;
      }
      if (section === "recovery" && cells.length >= 3) {
        const [errBefore, errAfter] = (cells[1] ?? "").split("→").map((s) => s.trim());
        const [p99Before, p99After] = (cells[2] ?? "").split("→").map((s) => s.trim());
        result.recovery.push({ service: cells[0], errBefore: errBefore ?? "", errAfter: errAfter ?? "", p99Before: p99Before ?? "", p99After: p99After ?? "" });
      } else if (section === "timeline" && cells.length >= 3) {
        result.timeline.push({ time: cells[0], event: cells[1], detail: cells[2] });
      }
      continue;
    }

    // Bullet points — extract all **key** value pairs from one line
    if (line.trimStart().startsWith("- ")) {
      // Extract all bold segments and their following text
      const parts = line.match(/\*\*(.+?)\*\*\s*/g);
      if (parts) {
        for (const part of parts) {
          const key = part.replace(/\*\*/g, "").trim().replace(/:$/, "").toLowerCase();
          // Get the text after this bold segment up to the next bold segment or end of line
          const afterBold = line.slice(line.indexOf(part) + part.length);
          const nextBoldIdx = afterBold.indexOf("**");
          const val = (nextBoldIdx >= 0 ? afterBold.slice(0, nextBoldIdx) : afterBold).trim().replace(/,$/, "").trim();

          if (key === "detected" || key === "recovered" || key === "time to recover") {
            if (!result.stats) result.stats = { detected: "", recovered: "", mttr: "" };
            if (key === "detected") result.stats.detected = val.replace(/,.*/, "").trim();
            if (key === "recovered") result.stats.recovered = val.replace(/,.*/, "").trim();
            if (key === "time to recover") result.stats.mttr = val.replace(/\s*s$/, "").trim();
          } else if (key === "voice-authorized change") {
            // "rollback auth-service (v2.14.1 to v2.14.0), authorized by the operator reading code "sierra tango" ("Roll back auth-service. Sierra. Tango.")"
            const m = val.match(/^(\w[\w_]+)\s+(\S+)\s+\((.+?)\),?\s*authorized.*?reading code\s+"([^"]+)"\s*\("([^"]+)"\)/i);
            if (m) {
              result.changes.push({ action: m[1], service: m[2], change: m[3], heard: m[5] });
            } else {
              result.changes.push({ action: "", service: "", change: val, heard: "" });
            }
          } else if (key === "evidence") {
            result.evidence = val;
          }
        }
      }
      continue;
    }

    // Empty lines
    if (line.trim() === "") continue;
  }

  return result;
}

// Color-code timeline events
export function eventTone(event: string): "healthy" | "down" | "degraded" | "accent" | "muted" {
  if (/^(resolved|outcome)/.test(event)) return "healthy";
  if (/^(fault|page)/.test(event)) return "down";
  if (/^(gate|change|authorized)/.test(event)) return "accent";
  if (/^(progress|link)/.test(event)) return "degraded";
  return "muted";
}

export function eventLabel(event: string): string {
  const map: Record<string, string> = {
    fault: "Incident detected",
    page: "Operator paged",
    agent: "Agent",
    tool: "Tool call",
    gate: "Authorization",
    change: "Change executed",
    progress: "Progress",
    outcome: "Outcome",
    resolved: "Resolved",
    link: "Link",
    operator: "Operator",
    precedent: "Prior incident",
    "agent-request": "External request",
    refusal: "Refusal",
    flag: "Flag",
  };
  return map[event] ?? event;
}
