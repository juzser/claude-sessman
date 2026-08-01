import { beforeEach, describe, expect, it, vi } from "vitest"
import { mount } from "@vue/test-utils"
import ThemeToggle from "./ThemeToggle.vue"

const STORAGE_KEY = "claude-sessman:theme"

function setMatchMedia(prefersDark: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query.includes("dark") ? prefersDark : false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }))
}

describe("ThemeToggle", () => {
  beforeEach(() => {
    window.localStorage.clear()
    document.documentElement.classList.remove("dark")
  })

  it("exposes an accessible toggle control", () => {
    setMatchMedia(true)
    const wrapper = mount(ThemeToggle)
    expect(wrapper.find('[aria-label="Toggle dark mode"]').exists()).toBe(true)
  })

  it("prefers the stored preference over the system preference", () => {
    window.localStorage.setItem(STORAGE_KEY, "light")
    setMatchMedia(true)
    mount(ThemeToggle)
    expect(document.documentElement.classList.contains("dark")).toBe(false)
  })

  it("falls back to prefers-color-scheme when nothing is stored", () => {
    setMatchMedia(true)
    mount(ThemeToggle)
    expect(document.documentElement.classList.contains("dark")).toBe(true)
  })

  it("falls back to dark when matchMedia is unavailable", () => {
    // @ts-expect-error simulating an environment without matchMedia support
    window.matchMedia = undefined
    mount(ThemeToggle)
    expect(document.documentElement.classList.contains("dark")).toBe(true)
  })

  it("toggles the class and persists the new preference on click", async () => {
    setMatchMedia(true)
    const wrapper = mount(ThemeToggle)
    expect(document.documentElement.classList.contains("dark")).toBe(true)

    await wrapper.find('[aria-label="Toggle dark mode"]').trigger("click")

    expect(document.documentElement.classList.contains("dark")).toBe(false)
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("light")
  })

  it("describes the next state via the accessible tooltip copy", async () => {
    setMatchMedia(true)
    const wrapper = mount(ThemeToggle)
    const trigger = wrapper.find('[aria-label="Toggle dark mode"]')
    expect(trigger.attributes("title")).toBe("Switch to light mode")

    await trigger.trigger("click")

    expect(trigger.attributes("title")).toBe("Switch to dark mode")
  })
})
