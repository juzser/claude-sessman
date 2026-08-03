# Roadmap

Milestone list and the decisions behind each, for future work. Terse by design.

See also: [`CLAUDE.md`](../CLAUDE.md) (repo map), [`docs/ARCHITECTURE.md`](ARCHITECTURE.md) (data flow), [`docs/API.md`](API.md) and [`docs/DATA-CONTRACT.md`](DATA-CONTRACT.md) (what M1/M2/M3 actually shipped).

## M1 (done) — session dashboard
- Live session registry (`~/.claude/sessions/<pid>.json`) parsed, validated, enriched.
- Card grid web dashboard: identicon, name/cwd, git branch, status dot, uptime, live "updated Ns ago".
- Server: Node 22 + TypeScript + Hono + `ws`. Web: Vite + Vue 3 + TypeScript + Tailwind.
- No embedded terminal, no message sending, no transcript rendering.

## M2 (done) — transcript enrichment
- [x] Read transcripts (`~/.claude/projects/<slug>/<sessionId>.jsonl`) incrementally/tail-only — files reach 19 MB, never load whole files. Byte-offset/size/inode tracked per session; rotation/truncation detected and rescanned from 0; stale-while-revalidate cache so a read never blocks on a scan.
- [x] Surface: last user prompt, last assistant gist, model, token/context usage, tool-call counts — wired into `EnrichedSession.transcriptSummary` (`null` until the first scan completes) and into `GET /api/sessions/:sessionId/detail` for the fuller (2000-char) view.
- [x] "Focus terminal tab" action via AppleScript (`POST /api/sessions/:sessionId/focus`), targeting the session's `tty` resolved server-side.
  - **Terminal-only limitation**: the AppleScript targets Apple's own `Terminal.app` and looks up the tab by `tty of t`. Other terminal emulators (iTerm2, etc.) don't expose an equivalent AppleScript surface the same way, so focusing a session running in one of those returns a "could not focus" error rather than actually switching tabs. No plan yet to special-case iTerm2's own scripting dictionary; tracked here for whoever picks it up.
- [x] Session detail drawer in the UI (`web/`): cards show a truncated last-prompt line, model, turn/tool-call counts, and a compact context-token figure (null-safe placeholders until the transcript index completes its first scan); clicking a card opens a drawer that fetches `GET /api/sessions/:sessionId/detail` and shows the full prompt/gist, usage breakdown, per-tool counts, session metadata, and the last-20-turns list (newest first); a "Focus tab" action lives on both the card and the drawer.

**M2 complete** (server + web). The detail drawer's turn list was rendered by its own component (`TranscriptTurnList.vue`) rather than inlined in the drawer, kept deliberately separate from the flow-graph rendering M3 added alongside it. **Superseded by M4**: the drawer and that turn list are both gone, replaced by a per-card `TurnStrip.vue` and a single flow Sheet. `GET /api/sessions/:sessionId/detail` survives them and now has no web consumer (see `docs/API.md`).

## M3 (done) — flow view
- [x] New `GET /api/sessions/:sessionId/flow` endpoint, backed by a single 100-turn ring buffer (`MAX_FLOW_TURNS`) in `transcript-index.ts` — a bigger, separate retention window from the 20-turn slice `/detail` exposes, not a reuse of it. See `docs/DATA-CONTRACT.md` and `docs/API.md`.
- [x] Spec: **one node = one user prompt turn** (not one tool call).
- [x] Each node shows a concise summary of the turn, including the gist of Claude's reply.
- [x] Click to expand a node → reveals the tool calls / files touched inside that turn.
- [x] Rendering via Vue Flow: `web/src/lib/flow-model.ts` (pure, deterministic payload→node/edge mapping) feeds `web/src/components/SessionFlowView.vue` (purely presentational; fetching and the stale-response guard live one level up). **M4 moved that level up from `SessionDetailDrawer.vue` to `SessionFlowSheet.vue`**; `flow-model.ts` and `SessionFlowView.vue` are unchanged by the move.
- [x] Node summaries are **derived deterministically from the transcript** in this phase — no LLM calls.

## M4 (done) — layout restructure + optional local summaries
- [x] Two-column shell: a session grid on the left, an aggregate rail on the right. The rail folds the *same* WS-fed list the grid renders (`useAggregateUsage.ts`) into cross-session token totals, a per-model tally, and the running-subagent list — no second fetch, so the rail cannot disagree with the cards.
- [x] Cards carry a gradient avatar (`lib/identicon.ts`), a status Lozenge, a one-line description, and `TurnStrip.vue`: the three most recent turns read left to right. Expanding a turn opens one shared flow Sheet centred on it.
- [x] The detail drawer and its turn list are removed; `SessionFlowSheet.vue` owns the `/flow` fetch, its retry, and the stale-response guard.
- [x] **The operator's own prompt is never summarized.** Both the strip and the expanded flow node render it verbatim, line breaks intact; only the *reply* slot ever takes an LLM summary, and it is styled identically to a raw gist so a summarized turn is not visually distinguishable from an unsummarized one.
- [x] Adopted the Hans Design System (variant `dashboard`) — see `docs/DESIGN.md`.
- [x] Optional summarizer: a local Ollama path (`qwen2.5:3b` at `127.0.0.1:11434`, the only network destination anywhere in this codebase), with a per-turn on-disk cache so a transcript is summarized once. **Default off** (`SESSMAN_SUMMARIZER=null`) — the code ships, the resource cost does not, and everything above works without it.
- [x] Subagent visibility: `subagent-index.ts` reads the session's `subagents/` directory so the rail can list what is running under each session.

## Phase 2 — tmux relay
- tmux wrapper so sessions can be adopted and driven from the browser.
- `send-keys` to relay a message into a running session.
- `capture-pane` / pty attach for output.
- xterm.js embedded in the web UI.
- Long-term goal: drive everything from the web page.

## Runtime target
- Node 22 (`.nvmrc` pins `22.23.1`). Full setup: [`docs/DEVELOPMENT.md`](DEVELOPMENT.md).
