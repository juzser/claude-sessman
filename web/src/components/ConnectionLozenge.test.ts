import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import ConnectionLozenge from "./ConnectionLozenge.vue";
import type { ConnectionState } from "../lib/ws-client";

function mountWith(state: ConnectionState) {
  return mount(ConnectionLozenge, { props: { state } });
}

describe("ConnectionLozenge", () => {
  it.each([
    ["connecting", "Connecting…"],
    ["open", "Live"],
    ["reconnecting", "Reconnecting…"],
    ["closed", "Disconnected"],
  ] as const)("says %s is %s", (state, copy) => {
    expect(mountWith(state).text()).toBe(copy);
  });

  it.each([
    ["connecting", "bg-info-subtle"],
    ["open", "bg-success-subtle"],
    ["reconnecting", "bg-warning-subtle"],
    ["closed", "bg-neutral-subtle"],
  ] as const)("tones %s with the subtle %s recipe", (state, toneClass) => {
    const classes = mountWith(state).find('[data-slot="lozenge"]').classes();
    expect(classes).toContain(toneClass);
  });

  it("renders in a polite live region so a state change is announced without stealing focus", () => {
    const region = mountWith("open").find('[aria-live="polite"]');
    expect(region.exists()).toBe(true);
    // Atomic: the whole phrase is re-read, not just the changed word.
    expect(region.attributes("aria-atomic")).toBe("true");
  });

  it("keeps the same element across states so screen readers see one region, not four", async () => {
    const wrapper = mountWith("connecting");
    expect(wrapper.text()).toBe("Connecting…");

    await wrapper.setProps({ state: "open" });
    expect(wrapper.text()).toBe("Live");
    expect(wrapper.findAll('[aria-live="polite"]')).toHaveLength(1);
  });
});
