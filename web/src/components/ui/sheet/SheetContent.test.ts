import { afterEach, describe, expect, it } from "vitest"
import { mount, type VueWrapper } from "@vue/test-utils"
import { defineComponent, h, nextTick } from "vue"
import Sheet from "./Sheet.vue"
import SheetContent from "./SheetContent.vue"

// jsdom has no ResizeObserver, but reka-ui's dialog focus/size tracking calls
// it as soon as DialogContent mounts open, regardless of tooltip hover state.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
window.ResizeObserver ??= ResizeObserverStub

let wrapper: VueWrapper | undefined

afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
  document.body.innerHTML = ""
})

// reka-ui's Portal defers the real Vue Teleport behind a useMounted() flag
// that only flips true inside onMounted, so the Teleported content lands one
// reactivity flush after mount() returns. A nextTick lets that flush happen.
// The dialog and tooltip content then live in document.body as Teleport
// siblings of the wrapper's own root, outside what wrapper.find() can see,
// so assertions below query document.body directly.
async function mountOpenSheet() {
  wrapper = mount(
    defineComponent({
      setup() {
        return () => h(Sheet, { open: true }, () => h(SheetContent, () => h("p", "Body content")))
      },
    }),
    { attachTo: document.body },
  )
  await nextTick()
}

describe("SheetContent close button", () => {
  it("carries an accessible name via aria-label instead of an sr-only span", async () => {
    await mountOpenSheet()
    const closeButton = document.body.querySelector('[aria-label="Close"]')

    expect(closeButton).not.toBeNull()
    expect(closeButton?.querySelector(".sr-only")).toBeNull()
  })

  it("wraps the close button in a local Tooltip that surfaces the same label", async () => {
    await mountOpenSheet()

    expect(document.body.querySelector('[data-slot="tooltip-trigger"][aria-label="Close"]')).not.toBeNull()
    expect(document.body.querySelector('[data-slot="tooltip-content"]')?.textContent).toContain("Close")
  })
})
