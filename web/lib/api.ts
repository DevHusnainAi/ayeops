// REST reads against the relay -- separate from lib/relay.ts's WebSocket voice session. Same origin in
// production (the relay serves the exported dashboard); NEXT_PUBLIC_RELAY_URL's origin in dev, where the
// dashboard and relay run on different ports.
export function apiOrigin() {
  const relay = process.env.NEXT_PUBLIC_RELAY_URL;
  if (relay) return relay.replace(/^ws/, "http").replace(/\/ws$/, "");
  return typeof window !== "undefined" ? location.origin : "";
}

export type IncidentEntry = {
  service: string;
  action: string;
  root_cause: string;
  mttr_s: number;
  resolved_at: number; // epoch seconds
  session_id: string;
  postmortem: string | null;
  recording: string | null; // relative URL, or null if evidence wasn't fetched yet
  timeline: string | null;
};

export async function fetchIncidents(): Promise<IncidentEntry[]> {
  const res = await fetch(`${apiOrigin()}/api/incidents`);
  if (!res.ok) throw new Error(`GET /api/incidents: ${res.status}`);
  return res.json();
}
