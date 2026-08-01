import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { OllamaSummarizer } from "./ollama-client.js";

/** Starts a synthetic node:http fixture server on 127.0.0.1:0 standing in for Ollama. */
function startFixtureServer(handler: http.RequestListener): Promise<{ server: http.Server; url: string }> {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({ server, url: `http://127.0.0.1:${port}` });
    });
  });
}

describe("OllamaSummarizer", () => {
  let server: http.Server | null = null;

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve) => server!.close(() => resolve()));
      server = null;
    }
  });

  it("parses a well-formed JSON reply from /api/generate", async () => {
    const fixture = await startFixtureServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          response: JSON.stringify({ ask: "fix the failing test", did: "fixed the mock and reran" }),
        }),
      );
    });
    server = fixture.server;

    const summarizer = new OllamaSummarizer({ model: "fixture-model", url: fixture.url });
    const result = await summarizer.summarizeTurn({ prompt: "please fix the test", response: "done, it passes now" });

    expect(result).toEqual({ prompt: "fix the failing test", response: "fixed the mock and reran" });
  });

  it("resolves null on a 500 from Ollama", async () => {
    const fixture = await startFixtureServer((_req, res) => {
      res.writeHead(500);
      res.end("internal error");
    });
    server = fixture.server;

    const summarizer = new OllamaSummarizer({ model: "fixture-model", url: fixture.url });
    const result = await summarizer.summarizeTurn({ prompt: "please fix the test", response: "done" });

    expect(result).toBeNull();
  });

  it("resolves null on a non-JSON HTTP body", async () => {
    const fixture = await startFixtureServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("not json at all");
    });
    server = fixture.server;

    const summarizer = new OllamaSummarizer({ model: "fixture-model", url: fixture.url });
    const result = await summarizer.summarizeTurn({ prompt: "please fix the test", response: "done" });

    expect(result).toBeNull();
  });

  it("strips a fenced ```json block before parsing", async () => {
    const fixture = await startFixtureServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          response: '```json\n{"ask": "add a retry", "did": "added retry with backoff"}\n```',
        }),
      );
    });
    server = fixture.server;

    const summarizer = new OllamaSummarizer({ model: "fixture-model", url: fixture.url });
    const result = await summarizer.summarizeTurn({ prompt: "add retry", response: "added it" });

    expect(result).toEqual({ prompt: "add a retry", response: "added retry with backoff" });
  });

  it("resolves null from summarizeSession when the reply is unparseable prose", async () => {
    const fixture = await startFixtureServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ response: "sure, here is a summary of your session" }));
    });
    server = fixture.server;

    const summarizer = new OllamaSummarizer({ model: "fixture-model", url: fixture.url });
    const result = await summarizer.summarizeSession({ recentPrompts: ["fix the test", "add a retry"] });

    expect(result).toBeNull();
  });

  it("parses a well-formed session summary reply", async () => {
    const fixture = await startFixtureServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ response: JSON.stringify({ desc: "hardening test reliability" }) }));
    });
    server = fixture.server;

    const summarizer = new OllamaSummarizer({ model: "fixture-model", url: fixture.url });
    const result = await summarizer.summarizeSession({ recentPrompts: ["fix the test", "add a retry"] });

    expect(result).toEqual({ description: "hardening test reliability" });
  });

  it("resolves null (never throws) when the server is unreachable", async () => {
    // Nothing listening on this port.
    const summarizer = new OllamaSummarizer({ model: "fixture-model", url: "http://127.0.0.1:1" });
    const result = await summarizer.summarizeTurn({ prompt: "x", response: "y" });

    expect(result).toBeNull();
  });

  it("resolves null once the request times out, rather than hanging forever", async () => {
    const fixture = await startFixtureServer(() => {
      // Accepts the connection but deliberately never calls res.end(),
      // simulating a wedged/overloaded Ollama that never replies.
    });
    server = fixture.server;

    // A short timeoutMs override so this test proves GENERATE_TIMEOUT_MS
    // actually fires without waiting out the real 20s production value.
    const summarizer = new OllamaSummarizer({ model: "fixture-model", url: fixture.url, timeoutMs: 20 });
    const result = await summarizer.summarizeTurn({ prompt: "please fix the test", response: "done" });

    expect(result).toBeNull();
  });
});
