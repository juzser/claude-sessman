# Roadmap

Milestone list and the decisions behind each, for future work. Terse by design.

## M1 (this PR) — session dashboard
- Live session registry (`~/.claude/sessions/<pid>.json`) parsed, validated, enriched.
- Card grid web dashboard: identicon, name/cwd, git branch, status dot, uptime, live "updated Ns ago".
- Server: Node 22 + TypeScript + Hono + `ws`. Web: Vite + Vue 3 + TypeScript + Tailwind.
- No embedded terminal, no message sending, no transcript rendering.

## M2 — transcript enrichment
- [x] Read transcripts (`~/.claude/projects/<slug>/<sessionId>.jsonl`) incrementally/tail-only — files reach 19 MB, never load whole files. Byte-offset/size/inode tracked per session; rotation/truncation detected and rescanned from 0; stale-while-revalidate cache so a read never blocks on a scan.
- [x] Surface: last user prompt, last assistant gist, model, token/context usage, tool-call counts — wired into `EnrichedSession.transcriptSummary` (`null` until the first scan completes) and into `GET /api/sessions/:sessionId/detail` for the fuller (2000-char) view.
- [x] "Focus terminal tab" action via AppleScript (`POST /api/sessions/:sessionId/focus`), targeting the session's `tty` resolved server-side.
  - **Terminal-only limitation**: the AppleScript targets Apple's own `Terminal.app` and looks up the tab by `tty of t`. Other terminal emulators (iTerm2, etc.) don't expose an equivalent AppleScript surface the same way, so focusing a session running in one of those returns a "could not focus" error rather than actually switching tabs. No plan yet to special-case iTerm2's own scripting dictionary; tracked here for whoever picks it up.
- [x] Session detail drawer in the UI (`web/`): cards show a truncated last-prompt line, model, turn/tool-call counts, and a compact context-token figure (null-safe placeholders until the transcript index completes its first scan); clicking a card opens a drawer that fetches `GET /api/sessions/:sessionId/detail` and shows the full prompt/gist, usage breakdown, per-tool counts, session metadata, and the last-20-turns list (newest first); a "Focus tab" action lives on both the card and the drawer.

**M2 complete** (server + web). M3 consumes the same `recentTurns` last-20-turns buffer already returned by `/detail` — the turn list is deliberately rendered by its own component (`TranscriptTurnList.vue`) rather than inlined in the drawer, so M3 can reuse or replace it with a flow-graph rendering of the same data.

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
