# Roadmap

Milestone list and the decisions behind each, for future work. Terse by design.

## M1 (this PR) — session dashboard
- Live session registry (`~/.claude/sessions/<pid>.json`) parsed, validated, enriched.
- Card grid web dashboard: identicon, name/cwd, git branch, status dot, uptime, live "updated Ns ago".
- Server: Node 22 + TypeScript + Hono + `ws`. Web: Vite + Vue 3 + TypeScript + Tailwind.
- No embedded terminal, no message sending, no transcript rendering.

## M2 — transcript enrichment
- Read transcripts (`~/.claude/projects/<slug>/<sessionId>.jsonl`) incrementally/tail-only — files reach 19 MB, never load whole files.
- Surface: last user prompt, last assistant gist, model, token/context usage, tool-call counts.
- Session detail drawer in the UI.
- "Focus terminal tab" action via AppleScript, targeting the session's `tty`.

## M3 — flow view
- Decided spec: **one node = one user prompt turn** (not one tool call).
- Each node shows a concise summary of the turn, including the gist of Claude's reply.
- Click to expand a node → reveals the tool calls / files touched inside that turn.
- Rendering via Vue Flow.
- Node summaries are **derived deterministically from the transcript** in this phase — no LLM calls.

### TODO (post-M3)
- Replace/augment deterministic node titles with cheap-LLM (Haiku-tier) summaries, cached per turn so a transcript is summarized once.
- Deferred deliberately: transcripts are large, per-turn LLM calls on every render would be costly.

## Phase 2 — tmux relay
- tmux wrapper so sessions can be adopted and driven from the browser.
- `send-keys` to relay a message into a running session.
- `capture-pane` / pty attach for output.
- xterm.js embedded in the web UI.
- Long-term goal: drive everything from the web page.

## Runtime target
- Node 22 (`.nvmrc` pins `22.23.1`).
