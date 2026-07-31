import { describe, expect, it } from "vitest";
import { fetchSessionDetail, fetchSessionFlow, focusSession, SESSMAN_CLIENT_HEADER } from "./sessman-api";
import type { FetchLike, FetchResponseLike } from "./sessman-api";

function fakeResponse(status: number, body: unknown = {}): FetchResponseLike {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  };
}

describe("focusSession", () => {
  it("POSTs to the focus endpoint with the X-Sessman-Client header", async () => {
    const calls: Array<{ url: string; init?: { method?: string; headers?: Record<string, string> } }> = [];
    const fetchImpl: FetchLike = (url, init) => {
      calls.push({ url, init });
      return Promise.resolve(fakeResponse(200));
    };

    const outcome = await focusSession("session-1", fetchImpl);

    expect(outcome).toEqual({ ok: true });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("/api/sessions/session-1/focus");
    expect(calls[0].init?.method).toBe("POST");
    expect(calls[0].init?.headers?.[SESSMAN_CLIENT_HEADER]).toBe("1");
  });

  it("URL-encodes the session id", async () => {
    const calls: string[] = [];
    const fetchImpl: FetchLike = (url) => {
      calls.push(url);
      return Promise.resolve(fakeResponse(200));
    };
    await focusSession("weird id/with slash", fetchImpl);
    expect(calls[0]).toBe("/api/sessions/weird%20id%2Fwith%20slash/focus");
  });

  it("maps 404 to a distinct not-found outcome", async () => {
    const fetchImpl: FetchLike = () => Promise.resolve(fakeResponse(404));
    const outcome = await focusSession("s1", fetchImpl);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe("not-found");
  });

  it("maps 422 to a distinct no-tty outcome with human-readable copy", async () => {
    const fetchImpl: FetchLike = () => Promise.resolve(fakeResponse(422));
    const outcome = await focusSession("s1", fetchImpl);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.reason).toBe("no-tty");
      expect(outcome.message.toLowerCase()).toContain("terminal tab");
    }
  });

  it("maps 502 to a distinct focus-failed outcome", async () => {
    const fetchImpl: FetchLike = () => Promise.resolve(fakeResponse(502));
    const outcome = await focusSession("s1", fetchImpl);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe("focus-failed");
  });

  it("maps 403 to a distinct request-rejected outcome", async () => {
    const fetchImpl: FetchLike = () => Promise.resolve(fakeResponse(403));
    const outcome = await focusSession("s1", fetchImpl);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe("request-rejected");
  });

  it("maps an unexpected status to a generic unknown outcome", async () => {
    const fetchImpl: FetchLike = () => Promise.resolve(fakeResponse(500));
    const outcome = await focusSession("s1", fetchImpl);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe("unknown");
  });

  it("maps a thrown fetch error to a network-error outcome", async () => {
    const fetchImpl: FetchLike = () => Promise.reject(new Error("fetch failed"));
    const outcome = await focusSession("s1", fetchImpl);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe("network-error");
  });
});

describe("fetchSessionDetail", () => {
  it("GETs the detail endpoint and returns the parsed session plus transcript detail", async () => {
    const calls: Array<{ url: string; init?: { method?: string; headers?: Record<string, string> } }> = [];
    const body = { session: { sessionId: "s1" }, transcriptDetail: null };
    const fetchImpl: FetchLike = (url, init) => {
      calls.push({ url, init });
      return Promise.resolve(fakeResponse(200, body));
    };

    const outcome = await fetchSessionDetail("s1", fetchImpl);

    expect(calls[0].url).toBe("/api/sessions/s1/detail");
    expect(outcome).toEqual({ ok: true, session: body.session, transcriptDetail: null });
  });

  it("maps 404 to a distinct not-found outcome", async () => {
    const fetchImpl: FetchLike = () => Promise.resolve(fakeResponse(404));
    const outcome = await fetchSessionDetail("s1", fetchImpl);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe("not-found");
  });

  it("maps an unexpected status to a generic unknown outcome", async () => {
    const fetchImpl: FetchLike = () => Promise.resolve(fakeResponse(500));
    const outcome = await fetchSessionDetail("s1", fetchImpl);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe("unknown");
  });

  it("maps a thrown fetch error to a network-error outcome", async () => {
    const fetchImpl: FetchLike = () => Promise.reject(new Error("offline"));
    const outcome = await fetchSessionDetail("s1", fetchImpl);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe("network-error");
  });
});

describe("fetchSessionFlow", () => {
  it("GETs the flow endpoint and returns the parsed session plus transcript flow", async () => {
    const calls: Array<{ url: string; init?: { method?: string; headers?: Record<string, string> } }> = [];
    const body = { session: { sessionId: "s1" }, transcriptFlow: null };
    const fetchImpl: FetchLike = (url, init) => {
      calls.push({ url, init });
      return Promise.resolve(fakeResponse(200, body));
    };

    const outcome = await fetchSessionFlow("s1", fetchImpl);

    expect(calls[0].url).toBe("/api/sessions/s1/flow");
    expect(outcome).toEqual({ ok: true, session: body.session, transcriptFlow: null });
  });

  it("maps 404 to a distinct not-found outcome", async () => {
    const fetchImpl: FetchLike = () => Promise.resolve(fakeResponse(404));
    const outcome = await fetchSessionFlow("s1", fetchImpl);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe("not-found");
  });

  it("maps an unexpected status to a generic unknown outcome", async () => {
    const fetchImpl: FetchLike = () => Promise.resolve(fakeResponse(500));
    const outcome = await fetchSessionFlow("s1", fetchImpl);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe("unknown");
  });

  it("maps a thrown fetch error to a network-error outcome", async () => {
    const fetchImpl: FetchLike = () => Promise.reject(new Error("offline"));
    const outcome = await fetchSessionFlow("s1", fetchImpl);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe("network-error");
  });
});
