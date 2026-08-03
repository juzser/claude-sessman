import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import SessionCard from "./SessionCard.vue";
import { makeSession, makeSummary, makeTurn } from "../test/factories";
import type { EnrichedSession } from "../lib/types";

const HOME = "/home/synthetic";
const NOW = Date.UTC(2026, 0, 1, 12, 0, 0);

function mountCard(session: EnrichedSession) {
  return mount(SessionCard, { props: { session, home: HOME, now: NOW } });
}

describe("SessionCard", () => {
  it("identifies the session by name and by where it is running", () => {
    const wrapper = mountCard(
      makeSession("a", { name: "demo-app", cwd: `${HOME}/demo-app` }),
    );
    expect(wrapper.text()).toContain("demo-app");
    expect(wrapper.text()).toContain("~/demo-app");
  });

  // Copy and tone both come from the spec's status table. The tones are the
  // ones the operator already reads at a glance every day (busy=amber,
  // idle=emerald); only the wording changed.
  it.each([
    ["busy", true, "Working", "bg-warning-subtle"],
    ["idle", true, "Waiting on you", "bg-success-subtle"],
    ["unknown", true, "Stale", "bg-neutral-subtle"],
    ["busy", false, "Ended", "bg-neutral-subtle"],
  ])("shows %s/alive=%s as %s", (status, alive, copy, toneClass) => {
    const wrapper = mountCard(makeSession("a", { status, alive }));
    const lozenge = wrapper.find('[data-slot="lozenge"]');
    expect(lozenge.text()).toBe(copy);
    expect(lozenge.classes()).toContain(toneClass);
  });

  it("keeps the status colour on the indicator, never on the card ground", () => {
    // An operator constraint, not a stylistic one: a status-tinted card is
    // exactly the "whole block changes colour" treatment he rejected.
    const busy = mountCard(makeSession("a", { status: "busy", alive: true }));
    const idle = mountCard(makeSession("a", { status: "idle", alive: true }));
    const surfaceOf = (w: typeof busy) => w.find("article").classes().sort().join(" ");

    expect(surfaceOf(busy)).toBe(surfaceOf(idle));
    expect(surfaceOf(busy)).toContain("bg-surface-raised");
    expect(surfaceOf(busy)).not.toMatch(/warning|success|danger|amber|emerald/);
  });

  it("prefers the session's own description over the raw prompt", () => {
    const wrapper = mountCard(
      makeSession("a", {
        transcriptSummary: makeSummary({
          sessionSummary: { description: "Refactoring the inbox triage pipeline" },
          lastUserPrompt: { text: "please refactor this", truncated: false },
        }),
      }),
    );
    expect(wrapper.find('[data-slot="description"]').text()).toBe(
      "Refactoring the inbox triage pipeline",
    );
  });

  it("falls back to the last prompt in the same slot, with nothing marking it as a fallback", () => {
    // A summarized description and a raw prompt must be indistinguishable:
    // no "AI", no "summarized", no different styling to read around.
    const summarized = mountCard(
      makeSession("a", {
        transcriptSummary: makeSummary({ sessionSummary: { description: "Some description" } }),
      }),
    );
    const raw = mountCard(
      makeSession("a", {
        transcriptSummary: makeSummary({
          lastUserPrompt: { text: "Some description", truncated: false },
        }),
      }),
    );

    const slot = (w: typeof raw) => w.find('[data-slot="description"]');
    expect(slot(raw).text()).toBe(slot(summarized).text());
    expect(slot(raw).classes()).toEqual(slot(summarized).classes());
    expect(raw.text()).not.toMatch(/\bAI\b|summar/i);
  });

  it("collapses a long prompt to one line", () => {
    const wrapper = mountCard(
      makeSession("a", {
        transcriptSummary: makeSummary({
          lastUserPrompt: { text: `${"word ".repeat(60)}end`, truncated: false },
        }),
      }),
    );
    const text = wrapper.find('[data-slot="description"]').text();
    expect(text.length).toBeLessThanOrEqual(90);
    expect(text.endsWith("…")).toBe(true);
  });

  it("says so plainly when the transcript has not been indexed yet", () => {
    const wrapper = mountCard(makeSession("a", { transcriptSummary: null }));
    expect(wrapper.find('[data-slot="description"]').text()).toBe("No transcript indexed yet");
  });

  it("shows only the three most recent turns", () => {
    const wrapper = mountCard(
      makeSession("a", {
        transcriptSummary: makeSummary({
          recentTurns: [makeTurn(10), makeTurn(11), makeTurn(12), makeTurn(13), makeTurn(14)],
        }),
      }),
    );

    const items = wrapper.findAll('[role="listitem"]');
    expect(items).toHaveLength(3);
    expect(items[0].text()).toContain("Turn 13");
    expect(items[2].text()).toContain("Turn 15");
  });

  it("omits the strip entirely when no turns are indexed", () => {
    const wrapper = mountCard(makeSession("a", { transcriptSummary: makeSummary() }));
    expect(wrapper.find('[role="list"]').exists()).toBe(false);
  });

  it("re-emits an expand with both the session and the turn's transcript index", async () => {
    // The strip carries the transcript-wide index, not the position in the
    // strip; the parent needs the session id too to know which flow to open.
    const wrapper = mountCard(
      makeSession("session-a", {
        transcriptSummary: makeSummary({ recentTurns: [makeTurn(41), makeTurn(42)] }),
      }),
    );

    await wrapper.findAll('button[aria-label^="Expand turn"]')[1].trigger("click");
    expect(wrapper.emitted("expand")).toEqual([["session-a", 42]]);
  });

  it("has no card-wide click target competing with the buttons inside it", () => {
    const wrapper = mountCard(
      makeSession("a", { transcriptSummary: makeSummary({ recentTurns: [makeTurn(1)] }) }),
    );
    for (const button of wrapper.findAll("button")) {
      expect(button.findAll("button")).toHaveLength(0);
    }
  });

  it("dates the card off the clock the parent ticks, not the value the API returned", () => {
    const wrapper = mountCard(
      makeSession("a", { updatedAt: NOW - 90_000, lastActivityAgoSec: 0 }),
    );
    expect(wrapper.text()).toContain("updated 1m ago");
  });

  it("offers the focus action", () => {
    const wrapper = mountCard(makeSession("a"));
    expect(wrapper.findComponent({ name: "FocusButton" }).exists()).toBe(true);
  });
});
