import type { EnrichedSession, FlowSummary, TranscriptSummary } from "./types";

/** Required on every non-GET request; enforced by the server's local-origin guard (server/src/app.ts). */
export const SESSMAN_CLIENT_HEADER = "X-Sessman-Client";

/** Minimal shape of the Fetch API response this module relies on — injectable so tests never hit the network. */
export interface FetchResponseLike {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

export type FetchLike = (
  input: string,
  init?: { method?: string; headers?: Record<string, string> },
) => Promise<FetchResponseLike>;

const NETWORK_ERROR_MESSAGE = "Could not reach the sessman server.";

export type FocusFailureReason =
  | "not-found"
  | "no-tty"
  | "focus-failed"
  | "request-rejected"
  | "network-error"
  | "unknown";

export type FocusOutcome = { ok: true } | { ok: false; reason: FocusFailureReason; message: string };

/**
 * POSTs to /api/sessions/:sessionId/focus, mapping the server's distinct
 * error statuses (404/422/502, plus the local-origin guard's 403) to
 * human-readable outcomes instead of a generic failure.
 */
export async function focusSession(
  sessionId: string,
  fetchImpl: FetchLike = fetch as unknown as FetchLike,
): Promise<FocusOutcome> {
  let res: FetchResponseLike;
  try {
    res = await fetchImpl(`/api/sessions/${encodeURIComponent(sessionId)}/focus`, {
      method: "POST",
      headers: { [SESSMAN_CLIENT_HEADER]: "1" },
    });
  } catch {
    return { ok: false, reason: "network-error", message: NETWORK_ERROR_MESSAGE };
  }

  if (res.ok) return { ok: true };

  switch (res.status) {
    case 404:
      return {
        ok: false,
        reason: "not-found",
        message: "This session is no longer known to the server.",
      };
    case 422:
      return {
        ok: false,
        reason: "no-tty",
        message:
          "Could not locate this session's terminal tab. This action only supports Apple Terminal.",
      };
    case 502:
      return {
        ok: false,
        reason: "focus-failed",
        message: "Could not focus that terminal tab. It may have been closed.",
      };
    case 403:
      return {
        ok: false,
        reason: "request-rejected",
        message: "The server rejected this request.",
      };
    default:
      return {
        ok: false,
        reason: "unknown",
        message: `Unexpected server response (${res.status}).`,
      };
  }
}

export type DetailFailureReason = "not-found" | "network-error" | "unknown";

export type DetailOutcome =
  | { ok: true; session: EnrichedSession; transcriptDetail: TranscriptSummary | null }
  | { ok: false; reason: DetailFailureReason; message: string };

interface SessionDetailResponseBody {
  session: EnrichedSession;
  transcriptDetail: TranscriptSummary | null;
}

/** GETs /api/sessions/:sessionId/detail, mapping the 404 (session vanished) case distinctly from other failures. */
export async function fetchSessionDetail(
  sessionId: string,
  fetchImpl: FetchLike = fetch as unknown as FetchLike,
): Promise<DetailOutcome> {
  let res: FetchResponseLike;
  try {
    res = await fetchImpl(`/api/sessions/${encodeURIComponent(sessionId)}/detail`);
  } catch {
    return { ok: false, reason: "network-error", message: NETWORK_ERROR_MESSAGE };
  }

  if (res.ok) {
    const body = (await res.json()) as SessionDetailResponseBody;
    return { ok: true, session: body.session, transcriptDetail: body.transcriptDetail };
  }

  if (res.status === 404) {
    return {
      ok: false,
      reason: "not-found",
      message: "This session is no longer running.",
    };
  }

  return {
    ok: false,
    reason: "unknown",
    message: `Unexpected server response (${res.status}).`,
  };
}

export type FlowFailureReason = "not-found" | "network-error" | "unknown";

export type FlowOutcome =
  | { ok: true; session: EnrichedSession; transcriptFlow: FlowSummary | null }
  | { ok: false; reason: FlowFailureReason; message: string };

interface SessionFlowResponseBody {
  session: EnrichedSession;
  transcriptFlow: FlowSummary | null;
}

/** GETs /api/sessions/:sessionId/flow, mapping the 404 (session vanished) case distinctly from other failures. */
export async function fetchSessionFlow(
  sessionId: string,
  fetchImpl: FetchLike = fetch as unknown as FetchLike,
): Promise<FlowOutcome> {
  let res: FetchResponseLike;
  try {
    res = await fetchImpl(`/api/sessions/${encodeURIComponent(sessionId)}/flow`);
  } catch {
    return { ok: false, reason: "network-error", message: NETWORK_ERROR_MESSAGE };
  }

  if (res.ok) {
    const body = (await res.json()) as SessionFlowResponseBody;
    return { ok: true, session: body.session, transcriptFlow: body.transcriptFlow };
  }

  if (res.status === 404) {
    return {
      ok: false,
      reason: "not-found",
      message: "This session is no longer running.",
    };
  }

  return {
    ok: false,
    reason: "unknown",
    message: `Unexpected server response (${res.status}).`,
  };
}
