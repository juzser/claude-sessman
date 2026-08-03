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

  it("does not render a spinner when not loading", () => {
    const wrapper = mount(Button, {
      slots: { default: "Save" },
    })

    expect(wrapper.find('svg.animate-spin').exists()).toBe(false)
  })
})
