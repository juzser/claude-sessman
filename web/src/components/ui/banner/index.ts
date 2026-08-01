export { default as Banner } from "./Banner.vue"

// No "success": success is a Toast channel, never a Banner. See Banner.vue.
export type BannerTone = "danger" | "warning" | "info"
