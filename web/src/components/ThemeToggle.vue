<script setup lang="ts">
import { computed, onMounted, ref } from "vue"
import { Moon, Sun } from "@lucide/vue"
import { Switch } from "@/components/ui/switch"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"

type Theme = "light" | "dark"

const STORAGE_KEY = "claude-sessman:theme"

function readStoredPreference(): Theme | null {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    return stored === "light" || stored === "dark" ? stored : null
  } catch {
    // localStorage unavailable (e.g. disabled/private browsing), so fall
    // through to the system preference.
    return null
  }
}

function readSystemPreference(): Theme {
  if (typeof window.matchMedia === "function") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
  }
  return "dark"
}

// Persistence order per design spec: localStorage preference ->
// prefers-color-scheme -> dark as the last resort.
function resolveInitialTheme(): Theme {
  return readStoredPreference() ?? readSystemPreference()
}

function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle("dark", theme === "dark")
}

const isDark = ref(true)

onMounted(() => {
  const theme = resolveInitialTheme()
  isDark.value = theme === "dark"
  applyTheme(theme)
})

function toggle() {
  const next: Theme = isDark.value ? "light" : "dark"
  isDark.value = !isDark.value
  applyTheme(next)
  try {
    window.localStorage.setItem(STORAGE_KEY, next)
  } catch {
    // Preference just won't persist across reloads in this environment.
  }
}

const tooltipLabel = computed(() => (isDark.value ? "Switch to light mode" : "Switch to dark mode"))
</script>

<template>
  <TooltipProvider>
    <Tooltip>
      <TooltipTrigger as-child>
        <Switch
          :model-value="isDark"
          size="sm"
          aria-label="Toggle dark mode"
          :title="tooltipLabel"
          @update:model-value="toggle"
        >
          <template #thumb>
            <Sun v-if="isDark" class="size-2.5 text-warning" />
            <Moon v-else class="size-2.5 text-fg-subtle" />
          </template>
        </Switch>
      </TooltipTrigger>
      <TooltipContent>{{ tooltipLabel }}</TooltipContent>
    </Tooltip>
  </TooltipProvider>
</template>
