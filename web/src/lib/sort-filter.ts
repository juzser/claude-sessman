import type { EnrichedSession } from "./types";

export type SortMode = "recent" | "name" | "project";

function basename(p: string): string {
  const parts = p.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? p;
}

export function displayNameFor(session: EnrichedSession): string {
  return session.name ?? basename(session.cwd);
}

export function filterSessions(sessions: EnrichedSession[], query: string): EnrichedSession[] {
  const q = query.trim().toLowerCase();
  if (q === "") return sessions;

  return sessions.filter((session) => {
    const haystack = [
      displayNameFor(session),
      session.cwd,
      session.git?.branch ?? "",
      session.projectSlug,
    ]
      .join(" ")
      .toLowerCase();
    return haystack.includes(q);
  });
}

export function sortSessions(sessions: EnrichedSession[], mode: SortMode): EnrichedSession[] {
  const copy = [...sessions];
  switch (mode) {
    case "recent":
      return copy.sort((a, b) => a.lastActivityAgoSec - b.lastActivityAgoSec);
    case "name":
      return copy.sort((a, b) => displayNameFor(a).localeCompare(displayNameFor(b)));
    case "project":
      return copy.sort((a, b) => a.projectSlug.localeCompare(b.projectSlug));
    default:
      return copy;
  }
}
