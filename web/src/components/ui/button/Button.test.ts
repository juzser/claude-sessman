import { describe, expect, it } from "vitest"
import { mount } from "@vue/test-utils"
import { Button } from "."

describe("Button loading state", () => {
  it("disables the control and marks it busy when loading", () => {
    const wrapper = mount(Button, {
      props: { loading: true },
      slots: { default: "Save" },
    })

    expect(wrapper.attributes("disabled")).toBeDefined()
    expect(wrapper.attributes("aria-busy")).toBe("true")
  })

  it("does not set aria-busy or disabled when not loading", () => {
    const wrapper = mount(Button, {
      slots: { default: "Save" },
    })

    expect(wrapper.attributes("disabled")).toBeUndefined()
    expect(wrapper.attributes("aria-busy")).toBeUndefined()
  })

  it("forces disabled when only loading is passed", () => {
    const wrapper = mount(Button, {
      props: { loading: true },
    })

    expect(wrapper.attributes("disabled")).toBeDefined()
  })

  it("hides slot content behind the spinner for an icon-only size while loading", () => {
    const wrapper = mount(Button, {
      props: { loading: true, size: "icon" },
      slots: { default: '<span data-testid="icon-slot">X</span>' },
    })

    expect(wrapper.find('[data-testid="icon-slot"]').exists()).toBe(false)
    expect(wrapper.find('svg.animate-spin').exists()).toBe(true)
  })

  it("keeps the label visible alongside the spinner for a text-bearing size while loading", () => {
    const wrapper = mount(Button, {
      props: { loading: true, size: "default" },
      slots: { default: "Save" },
    })

    expect(wrapper.text()).toContain("Save")
    expect(wrapper.find('svg.animate-spin').exists()).toBe(true)
  })

  it("sizes the spinner to the control tier it sits in", () => {
    // One fixed spinner size reads off-weight against a static icon in the
    // same slot, so each tier gets the size the pack's ICON_SIZE map assigns
    // it: 16px on the 32px tiers, 14px on bare `sm`, 12px on the 24px ones.
    const sizeClassFor = (size: "default" | "sm" | "xs" | "icon" | "icon-sm" | "icon-xs") =>
      mount(Button, { props: { loading: true, size } }).find("svg.animate-spin").classes()

    expect(sizeClassFor("default")).toContain("size-4")
    expect(sizeClassFor("icon")).toContain("size-4")
    expect(sizeClassFor("icon-sm")).toContain("size-4")
    expect(sizeClassFor("sm")).toContain("size-3.5")
    expect(sizeClassFor("xs")).toContain("size-3")
    expect(sizeClassFor("icon-xs")).toContain("size-3")
  })

  it("does not render a spinner when not loading", () => {
    const wrapper = mount(Button, {
      slots: { default: "Save" },
    })

    expect(wrapper.find('svg.animate-spin').exists()).toBe(false)
  })
})
