# OpenCode for VS Code — design draft

Status: approved 2026-11-06. Repo: `sr-web-studio/opencode-vscode`.

Chosen UI direction: `docs/mockups/v2/` (compact, Claude Code style). The first round (`docs/mockups/gemini/`) was rejected because its tool cards were too large.

## Transcript UI rules (approved)

- Every tool call is **one line**: bold tool name + muted target (path, pattern, command) + short result (`+12 −3`, `✓ exit 0`, `✗ failed`). No cards or boxes.
- A thin left connector line chains the steps in a turn. A running step shows a spinner. A step that needs attention (permission/question) gets an amber left border.
- Each tool line can be expanded/collapsed: an edit shows a small inline diff plus "Open diff", a shell shows its last output lines plus "Show terminal", a read shows its range.
- When a turn finishes, all its steps fold under one line, `› N steps completed · 42s`, placed above the final answer.
- Default: everything collapsed. The extension settings can change this:
  - `opencode.transcript.collapseCompletedSteps` (default `true`)
  - `opencode.transcript.expandToolDetails` (default `false`)
  - `opencode.transcript.showReasoning` (`"collapsed" | "expanded" | "hidden"`, default `"collapsed"`)
  - `opencode.transcript.fontSize` (default: inherit VS Code `chat.editor.fontSize`, else 13)
- Comfortable spacing, readable font, theme colors only from `--vscode-*` variables. Markdown answers have proper paragraph and list spacing.
- A slim "Background · 2 workers, 1 shell" row sits above the transcript and expands into a list.

## Round 2 feedback (2026-11-06, after first real use on Windows)

Salim installed the M1 vsix locally on Windows (OpenCode 2.1.4 there, workspace `Downloads`) and used it. Changes:

1. **Worker work must be visible** (moved forward from M4). A `subagent` tool line shows the agent name + description and a status. Clicking it opens the child session as a **read-only editor tab** (WebviewPanel, same transcript components, no prompt box), which updates live. The "Background · N workers, N shells" row above the transcript lists running and finished workers, and each one opens the same tab. In the mobile app this becomes a pushed screen through the `HostBridge` (`openSession(id, {readOnly})`).
2. **Bigger, airier text.** The default `opencode.transcript.fontSize` = `max(VS Code chat font size, 14)`, line-height 1.6, paragraph spacing ≈ 0.75em, and side padding ≥ 16px. Muted text is never smaller than 0.9em.
3. **Icons**: use `@vscode/codicons` (font bundled in the webview) for the chevrons, `+`, paperclip, send, stop, edit and the per-tool icons. No Unicode `⌄`/`›` glyphs.
4. **Display casing**: agent names and tool names are shown capitalized (`Assistant`, `Build`, `Shell`, `Read`). The ids sent to the API stay unchanged.
5. **Pinned models**: a pin icon on hover in the model popover. Pinned models appear in a "Pinned" group at the top. They are stored in the extension's `globalState` (synced), never in OpenCode config.
6. **Tool lines with room and color**:
   - each step row is ~28px high with 4–6px vertical gap
   - a codicon per tool (terminal, file, search, edit, globe, organization for agents, question)
   - the tool name is in the normal foreground color, semibold; the target is muted
   - hovering a row highlights it (`--vscode-list-hoverBackground`)
   - the steps group gets a left connector with dots
7. **Shell lines get color**: a `$` prompt in the terminal ANSI green, the command in the editor monospace font with a subtle `--vscode-textCodeBlock-background` chip, and an exit badge (`✓ 0` in `terminal.ansiGreen`, `✗ 1` in `terminal.ansiRed`). Expanded output is shown in a dark code block with ANSI colors rendered (simple ANSI → span converter).
8. **Prompt box**: at least 2 lines tall, auto-grows to about 12 lines.
9. **Attachments** (OpenCode V2 `files[]` on `session.prompt`, each `{ uri, name?, description? }`):
   - a paperclip button opens the VS Code file picker (`showOpenDialog`, multi-select). It sends `file://` URIs, built with `vscode.Uri.file(...).toString()`, so Windows paths work.
   - paste or drag an image into the prompt box sends it as a `data:<mime>;base64,…` URI (≤ 20 MiB per item)
   - dragging a file from the Explorer adds it as a `file://` URI
   - attachments show as small removable chips above the textarea, with an image thumbnail where applicable
   - if the current model's `capabilities.input` does not include `image`, show a muted warning on image chips
11. **Agent shell commands in the VS Code terminal panel** (moved forward from M3, like Copilot Chat).
    - When a `shell` tool starts, `session.tool.progress` carries `metadata.shellID` (`sh_…`), as confirmed in the fixtures. The extension then opens a VS Code terminal named `OpenCode: <command>` (codicon `terminal`) backed by a `vscode.Pseudoterminal`.
    - The terminal prints `$ <command>` and `cwd`, then streams `shell.output` pages by byte cursor (poll every ~300 ms while running, stop on `shell.exited`/status ≠ running), and ends with a colored `exit N` line. Output is written as-is, so ANSI colors work, and `\n` is converted to `\r\n`.
    - The terminal is input-free (Option A). Ctrl+C or closing the terminal while the command runs asks "Stop this command?" and then calls `shell.remove`. A command that has already exited only closes the tab.
    - Reveal behavior: `opencode.terminal.reveal` = `"onStart"` (default: shown without stealing focus, `preserveFocus: true`) | `"never"` (created in the background) | `"off"` (no terminals). At most `opencode.terminal.maxOpen` (default 5) OpenCode terminals stay open; the oldest finished one is disposed first.
    - Only for the main session of this window and its workers. Workers' terminals are named `OpenCode (<agent>): <command>`.
    - The tool line's "Show terminal" link focuses that terminal. After a reload, running shells (`shell.list`) for this project's sessions are reattached from cursor 0.
    - `shell.output` and `shell.get` are scoped to the session's location.
12. **Scrolling** (Claude Code / ChatGPT behaviour):
    - Auto-scroll to the bottom on new content **only while the user is already at the bottom** (within ~40px). As soon as the user scrolls up, new content does not move the view. Expanding or collapsing a step must not jump the view either; keep the anchor element in place.
    - When not at the bottom, a small round floating button (codicon `arrow-down`) appears bottom-center above the prompt box. If new content arrived meanwhile, it gets a dot or "New" badge. Clicking it smooth-scrolls to the end and re-enables follow mode. Sending a prompt always jumps to the end.
13. **Load only since the last compaction:**
    - Opening a session pages `message.list` newest-first (`order: desc`) and stops at the first **completed compaction** message (`type: "compaction"`, `status: "completed"`), so only the context after it is shown. A hard cap (e.g. 300 messages) applies when there is no compaction.
    - At the top, the compaction shows as one muted line `› Context compacted · <time>`; expanding it shows its `summary` as markdown. Above it is a "Show earlier messages" link, which loads the previous page with the cursor while keeping the scroll position.
    - Live events keep appending as usual. The same rule applies to the worker tabs.
    - **Fixes after 0.2.3 (checked live on `ses_e5120d76…`, an auto compaction at 12:43:47):**
      - **Auto compaction happens inside a turn.** The order is: user prompt, then `compaction` (`reason: "auto"`), then the assistant's answer.
        - Today the chunk stops at the compaction. The prompt is cut off, and the answer shows with no prompt above it.
        - Fix: when the chunk stops at a compaction, also take the older messages back to and including the nearest `user` message, provided no `idle` message lies between them.
        - That turn renders as: the prompt, then the muted "Context compacted" line as a step inside the turn, then the answer.
      - **Live compaction trims the view.**
        - When `session.compaction.ended` arrives while the user is following (at the bottom), drop the turns before the compaction turn. Keep the history state, so "Show earlier messages" loads them again.
        - When the user has scrolled up, don't trim at once; trim at the next jump to the end, or on the next send.
        - The same applies in worker tabs.
    - **Native diffs (moved forward from M2):**
      - **Inline preview:** the inline diff under an expanded edit line looks like VS Code's own diff:
        - the `Index:`/`===`/`---`/`+++` header lines are removed
        - hunk headers become a slim muted `⋯ line 76` separator
        - each row has old/new line-number gutters
        - added rows are on `--vscode-diffEditor-insertedLineBackground`, removed rows on `--vscode-diffEditor-removedLineBackground`, with a `+`/`−` marker and the text in the editor font
        - word-level highlights use `insertedTextBackground`/`removedTextBackground`
      - **"Open diff"** (and clicking the file name with Alt) opens VS Code's real diff editor with `vscode.diff(before, after, "<file> (OpenCode edit)")`:
        - `after` is the file on disk.
        - `before` is a virtual `opencode-diff:` document. It is built by reverse-applying the tool's `metadata.files[].patch` to the current file text; the patches are in jsdiff format, so use jsdiff `applyPatch` on the reversed patch.
        - If the file has changed since and the reverse-apply fails, fall back to a two-sided view of only the patch hunks (old side vs new side) built from the patch itself, titled "<file> (edit, hunks only)".
        - Added files diff against an empty document, and deleted files against an empty "after".
      - **Turn level:** the "N steps completed" line gets a `Changes (3 files)` link that opens a multi-file diff with `vscode.changes` (VS Code ≥1.88), using the same before/after pairs. On mobile it is a list.
      - Pure helpers (patch parsing into rows, reversing, before-text reconstruction) get unit tests built from real patches in the fixtures.
14. **Turn spacing and user prompts:**
    - Leave about 28px of vertical space between turns. A turn is one user prompt plus everything the agent did in answer.
    - The user prompt is a distinct block:
      - 12px left padding and a 2px left accent border (`--vscode-textBlockQuote-border`, falling back to `--vscode-focusBorder`)
      - a subtle background (`--vscode-chat-requestBackground`, falling back to `--vscode-textBlockQuote-background`), 6px radius and 8px vertical padding
    - Attachments sent with the prompt show as small chips under its text.
15. **Revert to a prompt ("go back in time")**, using OpenCode snapshots (`/v2/docs/snapshots`), the same flow as the TUI's `/undo` and "Revert":
    - **Button:** hovering a user prompt shows a `discard` codicon button titled "Revert to here". Keyboard users can reach it with Tab.
    - **Disabled while running:** the button is disabled while the session is running (tooltip "Stop the session first"), because the server rejects rollback during a run.
    - **Confirm:** clicking asks for confirmation in a VS Code modal: "Revert to before this prompt? Messages after it are hidden, and files changed by later steps are restored. Shell side effects (git, databases, other files) are not undone."
    - **Stage:** after confirmation, call `session.revert.stage({ sessionID, messageID: <user message id>, files: true })`.
      - The server then sends `session.revert.staged`, and `Session.Info.revert` holds the boundary and the restored `files`.
      - The transcript hides that prompt and everything after it. In their place it shows one muted bar: "Reverted · N files restored · Redo".
      - The reverted prompt text, and its attachments where possible, go back into the prompt box for editing. Unlike other state updates, this one may focus the prompt box, because it follows a click.
    - **Redo:** clicking "Redo" calls `session.revert.clear`, restores the view and empties the prompt box only if its text is still unchanged.
    - **Send:** sending a new prompt while a revert is staged makes the rollback permanent. Check live whether the server commits automatically on prompt or whether the client must call `session.revert.commit` first. If it is the client, commit then prompt.
    - **On load:** opening a session that already has `revert` set shows the same bar.
    - **No snapshots:** if the folder is not a git repo, or snapshots are off, `files` comes back empty. The bar then says "Conversation reverted · files not restored".
    - **Older servers:** on servers without `revert.stage` (feature-detect, Salim's 2.1.4), hide the button.
    - **Worker tabs:** read-only, so they have no revert button.
16. **Date and time after each turn:**
    - A completed turn ends with one muted line under its final answer: `2:41 PM · 42s`. It shows when the turn finished, and the duration from the user prompt to the last step.
    - Compact format, using the user's locale (`Intl.DateTimeFormat`):
      - today: time only
      - yesterday: `Yesterday 2:41 PM`
      - this year: `Nov 3, 2:41 PM`
      - older: `Nov 3 2025, 2:41 PM`
    - Hovering shows the full date and time.
    - A running turn shows no timestamp yet.
    - The `N steps completed` line keeps its own duration. Put the formatter in a pure module with unit tests (fixed clock and time zone).
17. **Round 2b fixes (after 0.2.0 screenshots):**
    - **Turn separation:**
      - The gap between turns grows to ~40px (`--oc-turn-gap`), and a thin hairline divider sits midway between turns.
      - The user prompt must read as a clearly different speaker. It is a card with:
        - a header row: `account` codicon + **You** (semibold) on the left, and the prompt's compact time on the right (muted, same formatter, full date on hover)
        - a visible 1px border (`--vscode-input-border`, falling back to `--oc-hairline`), a 3px accent left border (`--vscode-textLink-foreground`) and `--vscode-input-background`
        - 10px/14px padding
      - The agent's part starts with ~12px top space after the card.
      - The theme background used in 0.2.0 was nearly invisible in dark themes.
    - **Timestamps everywhere:** every user prompt shows its own time in its header.
      - Every finished agent turn shows `time · duration`.
      - When `outcome` is missing (turns loaded from history without an execution event), fall back to the last step or message time. This way no completed turn is left without a time.
      - A running turn still shows none.
    - **Workers list bug (0.2.0):**
      - **Cause:** one child session can be reused by many `subagent` calls (`input.sessionID` continues an existing worker; the lead's own session does this). The Background row then gets several rows with the same `sessionID`. `{#each … (w.sessionID …)}` throws Svelte's duplicate-key error, so the list never opens.
      - **Fix:** `deriveWorkers` returns **one row per child session**. It shows the latest call's description, a `×N` count when there were several calls, and the status from the child session. Tool-line clicks keep working per call, and all of them open the same tab.
      - Keys must be unique by construction. Add a test with several calls for one session.
      - Rows with no session id yet use the tool id as the key.
    - **Shell preview less plain:**
      - The `$` is not green; it uses the muted foreground.
      - The expanded shell preview looks like a small terminal window:
        - a header bar (`terminal` codicon, the cwd shortened with `~`, the exit badge, duration, and actions `Copy` / `Open in terminal`)
        - then the full `$ command` line, in the editor font, with the command in the normal foreground
        - then the output, with ANSI colors, in the terminal font (`terminal.integrated.fontFamily`, falling back to the editor font) on `--vscode-terminal-background`
        - a footer `Show all N lines` when the output is cut
      - The exit badge keeps green/red, because that carries meaning.
    - **History paging bug (fixed in 0.2.2):** the server rejects `cursor` together with `order` ("Cursor cannot be combined with order"). The first page sends `order: "desc"`, and later pages send only the cursor.
    - **Full shell command:** when a shell line is expanded, the block starts with the full command: `$ <command>`, wrapped, monospace, with a copy button. The output follows. The collapsed line keeps the one-line ellipsis plus the hover title.
18. **Round 2c (after the 0.2.1 screenshots):**
    - **User messages like Claude Code:**
      - The user message is a right-leaning bubble. It has a left margin of at least 15% of the panel width (min 32px), so it is indented from the left while the agent's text uses the full width.
      - Bubble style: `--vscode-input-background` (or `--vscode-chat-requestBackground` when visibly different), a 1px border, 8px radius, 10/14px padding. The heavy accent left border and the "You" header row are removed.
      - The prompt's time moves **outside and above** the bubble, right-aligned, muted and small (`12:33 PM`), visible on hover only, plus always for the first prompt of a day. That way it never looks like the agent's end-of-turn stamp.
      - The agent's end-of-turn stamp stays left-aligned under the answer.
      - The revert button sits on the bubble's top-left edge on hover.
    - **Sticky last prompt:**
      - When the user prompt of the turn currently in view has scrolled above the top, a compact sticky bar sits at the top of the transcript.
      - It shows that prompt in one line (ellipsis, max 2 lines on hover), in the same bubble style but slimmer, with a shadow (`--vscode-widget-shadow`).
      - Clicking it scrolls back to that prompt.
      - It follows the turn under the top edge, so in a long chat it always shows "what was asked for the text I'm reading now". Use an IntersectionObserver on the user bubbles, not scroll math on every frame.
      - It is hidden when that prompt is visible, and never covers the session header.
    - **Todo bar truly floating:**
      - Today it is a flex sibling between the transcript and the prompt box. The scroll area therefore ends above it, and the area above the bar becomes the visible bottom of the panel.
      - Fix: the todo bar is absolutely positioned over the transcript, anchored to the bottom of the transcript area just above the prompt box, with its own background and a shadow. The transcript runs underneath it.
      - The transcript gets bottom padding equal to the bar's measured height (ResizeObserver), so the last line can still scroll into view above it.
      - The jump-to-end button sits above the bar.
    - **Fewer terminals, clearer commands:**
      - Today every shell tool call opens its own terminal, so a working agent floods the terminal list.
      - New default `opencode.terminal.mode = "session"`: one terminal per session, named `OpenCode: <session title>`, or `OpenCode (<agent>): <worker title>` for a worker.
        - Each new command is appended to the same terminal.
        - Only when a command starts while another one in that session is still running does it get a temporary extra terminal (`… #2`). The extra terminal is reused later and closed when `maxOpen` is reached.
      - `"perCommand"` keeps today's behaviour.
      - Each command in the terminal is a clearly separate block:
        - a blank line, then a dim full-width rule with the time on the right: `──────── 12:33:05`
        - the command line: a bold cyan `❯`, then the command in bold default color, wrapped for long commands
        - the cwd (dim, `~` shortened) when it differs from the previous command's
        - one blank line, then the output as-is
        - the end line: `✓ exit 0 · 1.2s` in green or `✗ exit 1 · 0.4s` in red, with `stopped` or `timed out` in yellow
      - The whole block is pure text in `terminal-text.ts`, with tests for the exact bytes.
      - "Show terminal" on a tool line focuses the session terminal. It does not scroll to the block; the Pseudoterminal API has no scroll control, and that is acceptable.
      - After a reload, re-attaching running shells appends to the session terminal the same way.
    - **Sent images stay viewable:**
      - **Cause:** in 0.2.x, `fileChips()` keeps only `name` and `mime`, so sent images lose their pixels. Verified live: stored user messages carry `files: [{ data: <base64>, mime, name, source: { type: "inline" } }]`, and file attachments carry `source.uri`.
      - **Thumbnails:** image attachments on a user message show as real thumbnails, about 64px high with rounded corners, in a row under the text. Build them from `data:<mime>;base64,<data>`; the CSP already allows `data:` images. Only images get thumbnails; other files stay chips.
      - **Preview:** clicking a thumbnail opens a preview:
        - In VS Code, the host writes the image to a temp file under the extension's `globalStorageUri/previews/` and opens it with `vscode.open` in the built-in image viewer, which has zoom. Old previews are cleaned on start.
        - On mobile, it opens a full-screen viewer through the bridge (`openImage`).
      - **File chips:** non-image file chips with a `file://` URI open the file in the editor.
      - **Performance:**
        - Keep the base64 out of the main state. The reducer stores a reference (message id + index), and the webview asks the host for the thumbnail data lazily, when the chip becomes visible.
        - Cap the inline thumbnail size; large images are downscaled in the webview with a canvas once.
        - Big sessions must not post megabytes of state on every emit.
10. **Edit session title**: a pencil icon on hover next to the header title (and F2 / double-click) turns it into an inline input. Enter saves via `session.update({ title })`, and Esc cancels. The session dropdown rows also get a rename action on hover.

### Round 2 follow-ups (0.2.8, Salim, 2026-11-06)

- **Steer stays (Salim corrected himself, 2026-11-06).** `session.prompt` defaults to `delivery: "steer"`: a prompt sent while the agent works joins the running turn at its next step. Salim wants exactly that, so the extension sends no `delivery`. (The OpenCode TUI sends `queue` while a turn is active; we deliberately don't.)
  - Prompts queued by other clients (TUI, browser) show under the transcript with "Queued · sent when the current work is done", plus **Send now** (`session.inbox.update` → `steer`) and **Remove** (`session.inbox.cancel`).
  - The view loads pending items with `session.inbox.list` when a session opens (queued prompts are not in `message.list` until delivered). The reducer handles `session.inbox.cancelled` and `session.inbox.delivery.changed`.
  - A prompt delivered while a turn is open starts its own turn, matching history after a reload.
  - Live-checked on 2.2.5 (`/tmp/opencode/occ-test`): queued prompts wait until the turn ends and run in order; steer delivers at the next step; cancel removes the item.
- **Questions are read in full.** The question form (`QuestionPrompt`) no longer cuts option descriptions with an ellipsis: the title, description, labels and option descriptions wrap, and the form scrolls at 65% of the view height. The expanded `question` tool line shows the questions, options and the chosen answer as text instead of JSON (`askedQuestions()`).

## Voice input (proposed 2026-11-06, decision pending)

Goal: dictate prompts, Bangla first, plus English and mixed Bangla-English. Speech becomes text in the prompt box and is never sent automatically.

Facts checked on 2026-11-06:
- **Webviews have no microphone access** in VS Code: `getUserMedia` fails with "Permissions policy violation: microphone is not allowed". There is only a proposed API for it (microsoft/vscode#323602, backlog). Built-in VS Code speech/dictation works only in VS Code's own inputs, and a public speech-provider API for extensions doesn't exist yet (#310069).
- **Windows voice typing (Win+H) has no Bangla.** Android Gboard voice typing does support Bangla.
- **OpenCode 2.2.5** has `experimental.voice.*` (realtime voice-agent models from OpenAI, xAI and Google; all `available: false` here). Those models are voice agents, not dictation, and general models do poorly on Bangla.
- **Bangla STT benchmark** (Riverborn/BanSpeech, Sept 2026, 1,001 clips, character error rate):
  - streaming: Soniox `stt-rt` 7.4% CER, Sarvam realtime 9.0%
  - batch: Sarvam `saarika:v2.5` 6.9%, Soniox 8.1%
  - OpenAI `gpt-4o-transcribe` 24–29% and Whisper large-v3 ~31% are 4–5× worse
  - prices: Soniox about $0.10 per audio hour, Sarvam about $0.31

Proposal:
- **Engine:** Soniox real-time STT, with `language_hints` from `opencode.voice.languages` (default `["bn", "en"]`). It handles code-switching and has 60+ languages. The text streams live into the prompt box, and the final text replaces partial text. Swapping to a different engine is possible through a small `SpeechEngine` interface (Soniox, Sarvam, OpenAI).
- **Key:** the user's own STT API key is stored in VS Code `SecretStorage`, or in secure storage on mobile. The extension host mints short-lived temporary keys, so the long-lived key never reaches the webview. It is never stored in OpenCode config.
- **Capture in VS Code:** the webview cannot record, so the laptop-side companion extension (`extensionKind: ["ui"]`, also used for OS notifications) does the recording. Possible ways, to be tested in a spike on Salim's laptop:
  - a. Companion opens a tiny `localhost` capture page. Either VS Code's integrated browser, which has mic permission prompts since 2026-05 (#303293), or the default browser. The page streams to Soniox and returns the text to the extension.
  - b. Companion records with a native helper (`ffmpeg -f dshow` on Windows). This adds an extra dependency.
  - c. When #323602 ships, record directly in the webview.
- **Mobile:** Capacitor has native mic access, so it uses the same engine directly. Gboard remains a free fallback.
- **Decision 2026-11-06 (revised):** Soniox is chosen, and voice is **free, bring-your-own-key only**. There is no paid tier, no license server and no hosted key.
  - Voice is off until the user runs `OpenCode: Set Voice API Key` and pastes their own Soniox key. It is stored in `SecretStorage` (secure storage on mobile) and the user pays Soniox directly. With no key, the mic button shows a short hint that links to the command.
  - The extension host mints short-lived Soniox temporary keys from the user's key, so the long-lived key never reaches the webview.
  - During development, Salim's key is in the repo's `.env` as `SONIOX_API_KEY`. Only dev scripts and live tests read it. The `.env` file is git-ignored and excluded from the vsix, and the shipped extension reads its key only from SecretStorage.
- **Shipped in 0.2.7 (Salim, 2026-11-06):** the mic button and the key flow. Recording waits for the companion extension (M4), which Salim chose over a browser capture page.
  - With no key, the mic looks disabled (dimmed) but stays clickable (`aria-disabled`). A click opens a VS Code password input box.
  - The host checks the key by requesting a 60-second Soniox temporary key (`POST /v1/auth/temporary-api-key`). Checked live: a valid key returns 201, a wrong key 401.
  - Only an accepted key is saved, in SecretStorage (`opencode.voice.sonioxKey`). Then the mic turns normal.
  - A rejected key, a timeout or a network error saves nothing. The mic keeps its state, and an error message offers "Try again". A network error is never reported as "invalid key".
  - Commands: `OpenCode: Set Voice API Key (Soniox)`, `Clear Voice API Key`, `Voice Input`.
  - `AppState.voice = { keySet, capture, recording }`, and `HostBridge.voice()`. The key never reaches the webview or the logs.
  - Pure check `core/voice.ts` (`checkSonioxKey`, `keyShapeProblem`) has unit tests. The same code serves mobile with its own `fetch`.
- **UX:** a mic codicon in the prompt box (keyboard `Ctrl+Alt+V`). Click to start and click again or Esc to stop. A small level meter and the active language (`বাংলা + EN`) are shown while recording. Partial text is grey, and nothing is auto-sent.

### Follow-ups 0.3.5 (2026-11-06)
- The silent recording (peak 0) turned out to be a microphone muted on Salim's PC; our side was fine. The temporary "Test Microphone" probe was removed again.
- A silent recording still ends after 2 s. The message now says to check mute first (mute key, headset switch, Windows Sound settings), and offers **Choose Microphone**.

### Follow-ups 0.3.3: one install, permission asked (Salim, 2026-11-06)
- **One install.** The main vsix carries `dist/opencode-voice.vsix`, which `bun run package` (`tools/package.ts`) builds with the same version. About 4 s after activation, and before each recording, `Voice.ensureCompanion()` pings the companion. If it is missing or a different version, it runs `workbench.extensions.installExtension(<vsix uri>)`.
  - VS Code source (main, 2026-11-06), `ExtensionManagementService.installVSIX`: `getServersToInstall` → `prefersExecuteOnUI(manifest)` → the local server only. In a remote window the URI becomes `vscode-remote:` and the native service downloads it first, so the companion lands on the laptop.
  - A fresh install starts at once. An update of a running companion asks to reload the window.
  - If the install fails, the mic click offers a manual "Install from VSIX…".
  - `extensionDependencies` was not used: it only resolves from the Marketplace. Revisit at M5, when both are published.
- **Microphone permission.**
  - Windows: before each recording the companion reads the three privacy switches with `reg query`; no admin is needed. The switches are `…\ConsentStore\microphone` in HKLM and HKCU, plus `\NonPackaged` for desktop apps. If any is `Deny`, nothing is recorded, and the error names the switch, with an **Open Microphone Settings** button (`ms-settings:privacy-microphone`).
  - macOS asks by itself on first use. A one-time note tells the user to click Allow, and a denial shows as silence, with the same button (it opens Privacy → Microphone).
  - Silence or missing audio after start gives **Open Microphone Settings** / **Choose Microphone** buttons (`VoiceFeed.fix`).

### Follow-ups 0.3.2 (2026-11-06)
- **Silent mic → explained, not empty.** Salim's first try showed a red mic and no text. Soniox itself works: synthetic speech through `DictationSession` gives the full sentence.
  - The likely cause on Windows is the "Let desktop apps access your microphone" setting, or a muted or wrong default device. In those cases the recorder delivers zeros.
  - Now, if the peak level stays below 8 after 2 s, the recording ends with that hint.
  - A recording that ends without text always gives a reason: no audio, silence, no answer from Soniox, or "no words heard".
  - Each recording logs frames, peak level, Soniox answers and character count in both output channels.
- **Choose microphone:** the companion command `OpenCode Voice: Choose Microphone` lists devices in a short-lived recorder process. The choice is saved by name, not index, because indexes change when devices are plugged in.
- **Session list by project (Windows colleague):** the log showed 1 session while the web app showed several.
  - `location.get` echoed VS Code's `d:\…` while the project lives at `D:\…`.
  - Lists now use `session.list({ project })`, with the project id from `location.get`, and keep sessions started in this folder or any subfolder (`withinDirectory`).
  - New sessions use the project's spelling of the folder.

### Background workers as a floating panel (0.3.1, Salim, 2026-11-06)
- The "Background · N workers" row under the header took more space as workers grew. It is now a small chip in the header next to **+**, showing `running/total` with a spinner while any worker runs, or the count with a robot icon.
- Clicking the chip opens the same list as a floating panel under the header, over the transcript, up to 50vh tall with scrolling. Escape, a click outside, or opening a worker closes it.

### Voice capture (0.3.0, built 2026-11-06)
- **Two extensions.** Webviews have no microphone, and with Remote SSH the main extension runs on the server. Recording lives in the companion **OpenCode Voice** (`sr-web-studio.opencode-voice`, folder `companion/`, `extensionKind: ["ui"]`), which runs on the machine with the microphone.
- **Flow:**
  1. The mic is clicked, and `Voice.click()` runs in the main extension.
  2. The main extension mints a 120 s Soniox temporary key (`mintSonioxTempKey`), so the long-lived key never leaves its SecretStorage.
  3. It calls `opencode.companion.voice.start {id, key, model, languages}`.
  4. The companion forks `dist/recorder.js` with `ELECTRON_RUN_AS_NODE=1`, so a native crash cannot take down the extension host.
  5. `DictationSession` records with pvrecorder (16 kHz, 100 ms frames) and streams to Soniox `stt-rt-v6`, sending the key as WebSocket subprotocols.
  6. Updates go back as `opencode.voice.feed {id, kind: listening|heard|done}`.
  7. The main extension posts `{type:"dictation", id, text, done}` to the webview, and the prompt box applies it with `mergeDictation`.
- **Prompt box:**
  - The text is only inserted, never sent.
  - Typing during dictation is kept: only the newly heard part is appended.
  - Sending stops the recording and drops the words still on their way.
- **States:** `AppState.voice.recording` is `off`, `starting`, `on` or `stopping`.
  - The mic shows a spinner while `starting` and `stopping`, and a pulsing red record icon while `on`.
  - A recording stops itself after 60 s without new words, and after 10 min at most.
  - After stop, it waits up to 4 s for Soniox's last words.
- **No companion:** clicking the mic offers "Install from VSIX…". `vscode.extensions.onDidChange` refreshes `capture`.
- **Errors:** Soniox errors show readable messages: 401 means the key was rejected, 402 means the balance is exhausted, then 408 and 429.
- **Settings:** `opencode.voice.languages` (default `["bn","en"]`) and `opencode.voice.model` (default `stt-rt-v6`).
- **Packaging:** `bun run package` builds both `opencode-vscode.vsix` and `opencode-voice.vsix`.
  - pvrecorder 1.2.9 (Apache-2.0, see `NOTICE`) is shipped as files under `dist/pvrecorder/{dist,lib}`, because it resolves `../lib/<platform>` itself.
  - Builds included: win x64/arm64, mac arm64/x64, linux x64. No Raspberry Pi builds.
- **Verified here:** the packaged `recorder.js` opens the microphone (Linux, dummy device) and connects to Soniox with a temporary key. Errors come back as `done` with a reason.
- **Not verified here:** real transcription (Soniox answered 402, organization balance exhausted) and pvrecorder on Windows inside VS Code (the risk is Electron DLL-init issues #76 and #91; the separate process limits the damage).

## Controls (approved 2026-11-06, mockups in `docs/mockups/v3/`)

- **Agent / model** (v3/01, v3/02): one quiet footer row of plain muted text under the prompt textarea: `build ⌄ · Sonnet 5.5 · high ⌄`. No pills, chips or borders. Clicking opens a small popover anchored to that text.
  - Agent popover: one row per primary agent (`name — description`), check on the current one, keyboard ↑↓ / Enter / Esc.
  - Model popover: a search field, models grouped under muted provider headers, and variants (`low medium high`) right-aligned on the model's row and clickable. Lists come only from `agent.list` / `model.list`.
- **Permission** (v3/03): inline on the tool's own line. Tiny text buttons `Allow · Always · Deny` follow the tool target, with `Allow` in the accent color, and a 2px amber mark to the left of the line. No box or card. Maps to `once / always / reject`.
- **Questions / forms** (v3/05, v3/06): while a form is pending for the session, the prompt box is temporarily replaced by a compact chooser of the same width. Esc cancels the form (`session.form.cancel`), and the normal prompt box comes back.
  - Single-choice (string with `options`): numbered one-line rows `1  Label — muted description`, keys 1–9, ↑↓, Enter. If `custom` is set, the last row is `Other…` with an inline text field.
  - Multiselect: one-line rows with small checkboxes. `Other…` appears if `custom` is set. `minItems/maxItems` are respected.
  - Boolean: small `Yes | No` segmented control.
  - String / number / integer without options: one single-line input with placeholder, validation shown in muted error text.
  - External: one line with a link button that opens the URL in the browser.
  - Several fields: small tabs at the top (`Database ✓  Auth  Deploy`) with `2 / 3`. Tab moves to the next field. `when` conditions and `hidden` are applied. Submit appears on the last step.
- **Session switcher** (v3/07): the header shows the session title with `⌄` and a `+` at the right. Clicking the title opens a dropdown with a search field and groups (Today / Yesterday / Last week / Older). Each session is one line: title, then the relative time right-aligned. Status is shown by dots: a running session gets the accent dot, one waiting for input (permission/form) gets an amber dot. The current session has a check. The footer row has `Show archived`. Only root sessions (no `parentID`) of this project are listed.

## Todo list and empty state (approved 2026-11-06, mockups in `docs/mockups/v4/`)

- **Todo bar** (v4/01, v4/02): appears only when the session's agent has used the todo tool. Shown only when the agent has called it.
  - The tool is `todowrite`. In V1 it was always built in. In V2 (`opencode.ai/v2/docs/config`, "Todos") it exists only when `experimental.todo: true`, and the default is `false`. The extension never turns it on.
  - Shape, confirmed from the OpenCode 2.2.5 binary's own TUI fixtures (2026-11-06):
    - input `{ todos: [{ content: string, status: "pending" | "in_progress" | "completed" | "cancelled" }] }`
    - completed state `metadata: { todos }`, output like `"1 completed, 1 in progress, 1 pending, 1 cancelled"`
    - The TUI derives the current list from the latest `todowrite` call in the session, and hides it when nothing is pending or in progress.
  - On this server, as of 2026-11-06, neither `~/.config/opencode/opencode.json` nor `/api/config` has an `experimental` key, and the session history has no `todowrite` calls. The bar stays hidden until it is enabled.
  - Collapsed (default): one line floating just above the prompt box: a small progress ring, `3 of 7 · <current in-progress item>`, and a `⌃` chevron.
  - Expanded: a small panel opens upward with a thin border. The header shows `Tasks 3 / 7` and a thin progress bar, followed by one line per item. Done items get ✓ and are muted with strikethrough. The in-progress item is shown in the accent color with a half-circle icon. Pending items get ○.
  - It hides when every item is done and the turn has ended. Setting `opencode.todo.defaultExpanded` (default `false`).
- **Draft session / `+` button**: `+` does NOT create a server session. It opens a local draft (title "New session", empty transcript). The server session is created only when the first prompt is sent, so no empty "Untitled" sessions pile up. Pressing `+` while already in an empty draft just focuses the prompt box.
- **Empty project** (v4/03): when the project has no sessions, or a draft is open, the view shows calm centered content:
  - OpenCode wordmark, the project folder name, and the muted path (`~` shortened)
  - three one-line suggestion links that fill the prompt box (they don't send it): "Explain this codebase", "Find and fix a bug", "Write tests for the current file"
  - a tiny muted note: "Sessions keep running on the OpenCode server after you close VS Code"

  The normal prompt box and agent/model footer stay at the bottom.

## Notifications (added 2026-11-06)

Goal: tell Salim when OpenCode needs his attention or when work has finished. Use an OS-level notification where possible, otherwise a VS Code notification.

### Triggers

| Kind | Event | Default |
| --- | --- | --- |
| Needs attention: permission | `permission.asked` | on |
| Needs attention: question | `form.created` | on |
| Turn finished | `session.execution.succeeded` on a root session | on |
| Turn failed | `session.execution.failed` on a root session | on |
| Worker finished | `session.execution.succeeded/failed` on a child session (`parentID` set) | off |
| Background shell finished | `shell.exited` for a shell whose `metadata.sessionID` belongs to this project | off |

Rules:
- Only notify for sessions of this window's project (location), so several VS Code windows don't duplicate each other.
- Suppress when the window is focused AND that session is visible in the panel (`vscode.window.state.focused` + view visibility). Setting `opencode.notifications.whenFocused` (`"never" | "always"`, default `"never"`).
- An attention notification clears itself when `permission.replied` / `form.replied` / `form.cancelled` arrives, for example after answering from another client.
- Coalesce bursts: at most one notification per session every 5 s; a later attention event replaces an earlier one.
- Actions: attention → `Open` (focus the panel and session), plus `Allow` / `Deny` for permissions. Finished → `Open`.
- Settings: `opencode.notifications.enabled` (default `true`), `opencode.notifications.attention`, `.completed`, `.failed`, `.workers`, `.shells` (booleans with the defaults above), `opencode.notifications.os` (`"auto" | "off"`).

### Delivery: where an OS notification is possible

The extension host runs on the office server (Remote SSH). An OS notification sent from there would appear on the server, not on the laptop. VS Code has no stable API that lets extensions show OS notifications. Built-in chat has `chat.notifyWindowOnConfirmation`, but third-party access is still only a feature request (microsoft/vscode#346215).

1. **VS Code notification (always, M1):** `showWarningMessage` for attention and `showInformationMessage` for finished, both with actions. These only appear inside the VS Code window.
2. **OS notification on the laptop (chosen, M4):** a tiny companion extension `opencode-vscode-notifier` with `extensionKind: ["ui"]`, so it runs on the laptop side. The main extension calls its command (`opencode.notifier.show`); commands work across extension hosts. The companion shows a native toast (Windows toast via PowerShell / WinRT, macOS `osascript`, Linux `notify-send`). Clicking it focuses VS Code through a `vscode://` URI handler. The main extension lists the companion in `extensionPack`, so one install brings both. If the companion is missing, delivery falls back to option 1.
3. **Push through the OpenCode server (shared with the mobile app):** see *Mobile app* below. This also works when VS Code is closed.

Notifications from the extension only exist while VS Code is open. Once the mobile app exists, push covers the rest.

## Mobile app (Salim's "Phase 2", added 2026-11-06)

The same UI as a phone app, without VS Code-specific actions. It is a client of the same OpenCode server reached over LAN, Tailscale or a public domain.

### Scope

- **All projects:** `project.list` (`GET /api/project`) → project list → `session.list` filtered by `project`/`directory` → the same transcript and controls as the extension. There is no fixed workspace folder.
- **Removed or replaced:** open file in editor → read-only file/diff viewer from `session.diff` and tool metadata. VS Code terminal → read-only shell output view (`/api/shell/{id}/output`) with Stop. Status bar → connection indicator in the header.
- **Kept:** transcript, agent/model footer, permission line, question chooser, session switcher, todo bar, drafts, workers list, attachments (camera/gallery instead of the file picker), revert, turn timestamps.
- **Voice input (required in the first mobile release, added 2026-11-06):**
  - Mic capture is native (Capacitor), streaming to Soniox with the same `SpeechEngine` and `language_hints` as the extension (default `["bn","en"]`).
  - Free BYOK: the user's Soniox key goes into the app's secure storage, set on a Settings screen. Without a key, the mic shows a hint.
  - Android needs the `RECORD_AUDIO` permission prompt.
  - The UX is the same as in VS Code: live grey partial text, and nothing is auto-sent.

### Connection and QR pairing

- `opencode pair` already prints one-time links (single use, expire in 5 minutes) and a QR code. The link is `<server-url>/auth/connect/<code>`. `GET` with `Accept: application/json` returns `{ token }`, which is then used as the password. Sessions last 30 days, and changing the server password signs every client out.
- The app has a QR scanner, plus manual entry of a URL and password. It saves several connection profiles in secure storage.
- The VS Code extension gets a command **"OpenCode: Pair mobile device"**. It calls `POST /api/pair`, lets the user pick a reachable URL from `server.info.urls` (LAN / Tailscale) or a custom public URL, and shows the QR code in a webview with a 5-minute countdown.
- `opencode pair --remote` (OpenTunnel) exposes the server to the internet. The app and the extension never trigger it themselves.

### Push notifications

The event stream is live-only, and a phone app in the background cannot keep it open. Push must therefore come from the server side: an **OpenCode server plugin** (`opencode-push`, in this repo) subscribes with `ctx.event.subscribe({ types: [...] })` to the trigger events above and sends pushes. The plugin is installed by Salim explicitly. The extension and the app never edit OpenCode config.

**Decisions (2026-11-06):** laptop OS notifications come from the companion extension (M4). Mobile push goes through **ntfy**. The target platform is **Android** first (APK sideload; no store needed at first). Proposed stack, to re-check at kickoff: Capacitor 8 (`@capacitor/core` 8.6.0) wrapping the same Svelte UI, with `@capacitor-mlkit/barcode-scanning` for QR.

Push channel options considered:
- **ntfy** (self-hosted or ntfy.sh): the plugin POSTs to a private topic, and the ntfy app shows the push with a click URL that deep-links into our app. No Firebase account or store account is needed.
- **FCM (Android) / APNs (iOS):** native push inside our app. Needs a Firebase project, plus an Apple developer account for iOS. The plugin stores device tokens.
- **Web Push (VAPID):** only if the app is a PWA. iOS supports it only for installed PWAs.

To verify before building: whether a server plugin can expose a route or RPC for device registration (`rpc.*` events exist), and where plugin secrets live.

### Code sharing (applies to M1 already)

- `core`: API/state layer on `@opencode/client` (root entry only, no `node:` imports), reducers, form logic, grouping. No `vscode` imports. It can run in a browser webview.
- `ui`: Svelte components that talk to the host only through a `HostBridge` interface (`openFile`, `openDiff`, `showTerminal`, `openExternal`, `notify`, `storage`, `postToHost`). VS Code and mobile each implement the bridge.
- Splitting into a `packages/core`, `packages/ui`, `apps/vscode`, `apps/mobile` workspace happens at mobile kickoff. M1 only keeps these boundaries clean.

Existing community clients for reference: OpenCode Mobile (getopencode.app; uses `opencode pair` QR) and `doza62/opencode-mobile` (Expo; push plugin plus QR).

## Decision: interactive input

Option A. v1 provides live output, Stop and Background for agent shell commands. Interactive stdin is deferred until the persistent PTY path is confirmed.

## Ground truth (checked 2026-11-06 on srws-server-office)

- OpenCode `v2.2.5`, service on `0.0.0.0:4096`. `GET /api/info` reports `capabilities.persistentPty: true`.
- Service registration: `~/.config/opencode/service.json` (`hostname`, `port`, `password`).
- Official client: `@opencode/client`. `@opencode/client/service` provides `Service.discover()`, `Service.ensure()` (starts `opencode serve --service` when needed), and `Service.headers()`.
- Server API: 170 operations, OpenAPI at `/openapi.json`. Event stream: `GET /api/event`. The client only receives live events, with no replay, so the extension resyncs on `server.connected`.
- VS Code `1.144.0` is installed on this host. Salim uses VS Code Remote SSH from the laptop, so the extension runs on the office server and reaches `127.0.0.1:4096` directly.
- **Project folder spelling (0.2.5):**
  - `session.list({ directory })` matches the stored path exactly. Checked here: a trailing slash or a subfolder returns 0 sessions.
  - On Windows, VS Code's `fsPath` has a lowercase drive (`d:\Work\…`) while the server stores `D:\Work\…`, so the list was empty even though the browser showed the sessions. Reported 2026-11-06 on a colleague's laptop with a local OpenCode.
  - The controller now calls `location.get({ location: { directory } })` on connect and uses the server's spelling for every call.
  - Session, event and notification filters compare paths with `sameDirectory()`: separators and trailing slashes are ignored, and Windows paths compare case-insensitively.
  - If a Windows folder still lists 0 sessions (for example on an older server), it falls back to the newest 200 sessions of all folders, filtered the same way.
  - Workers are listed by `parentID` alone.
  - The output channel "OpenCode" logs the resolved location and session counts, with no message text.
- Existing extensions: `sst-dev.opencode` is only a terminal launcher. Community options include OpenChamber and ACP Patchbay (ACP). None of them meets the requirements below.

## Principles

1. The extension is a client only. The OpenCode server owns sessions, models, providers, MCPs, skills, agents and permissions. The extension never writes OpenCode config.
2. Closing VS Code must never affect a session. The extension does not own any process the agent depends on. If it starts the service, it uses `Service.ensure()`, which starts the detached shared service. It never starts a child process tied to the extension host.
3. Reconnect means re-reading the session state. Do not cache state that the server already holds.

## Feature → API map

| Feature | API | Notes |
| --- | --- | --- |
| Connect / auto start | `Service.discover()` → `Service.ensure()`; manual URL + password for a remote server | If `opencode` is not on PATH, show a setup card |
| Project = workspace folder | location `{ directory: workspaceFolder }` on every call | |
| Session list / switch / new | `session.list`, `session.create`, `session.get`, `session.message.list` | |
| Chat streaming | `event.subscribe` → `session.text.delta`, `session.tool.*`, `session.step.*`, `session.execution.*` | |
| Prompt, agent, model, variant | `session.prompt`, `session.switchAgent`, `session.switchModel`, `agent.list`, `model.list`, `command.list`, `skill.list` | Pickers show what OpenCode reports and nothing else |
| Open file links | Tool input/metadata paths → `vscode.window.showTextDocument` | |
| Diffs | `session.diff` (`FileDiff.Info.patch`) → virtual "before" document + `vscode.diff` | Show per turn and for the whole session |
| Permissions / questions | `permission.asked` → `session.permission.reply`; `form.created` → `session.form.reply` | Inline line (see Controls) and a notification (see Notifications) |
| Shell commands in the terminal panel | `shell.created/exited` events, `GET /api/shell` (`metadata.sessionID`), `GET /api/shell/{id}/output` cursor paging → `vscode.Pseudoterminal` | One VS Code terminal per agent command, named `OpenCode: <cmd>` |
| Stop a command | `DELETE /api/shell/{id}`, or `session.interrupt` | |
| Move to background | `POST /api/session/{id}/background` | |
| Workers (subagents) | sessions whose `parentID` is the main session; their events | Expandable tree; clicking opens a read-only editor tab (WebviewPanel) |
| Background wake-up | Handled by the server. The UI shows inbox/synthetic messages and `session.execution.started` | |
| Status bar | connection + `session.active` | |

## Known gap: interactive input (y/n)

The agent's `shell` tool uses `POST /api/shell`, which the API describes as "Spawn one non-interactive shell command … stdout/stderr captured to a file." The terminal mirror can therefore show live output and Stop, but it cannot send keystrokes to that process.

There are experimental persistent PTY routes (`/api/experimental/session/{id}/terminal`, `/persistent-pty/{id}/connect`, a WebSocket with input). The agent's use of them is not documented yet, so it has not been verified.

Options:

- A. v1: live output + Stop + Background. Interactive input is added later, once the persistent PTY path is confirmed.
- B. Investigate the persistent PTY / agent terminal path first (spike), then decide.

## Tech stack (to verify versions before scaffolding)

- TypeScript, Bun for scripts, esbuild bundle, `@vscode/vsce` packaging; Open VSX publishing too.
- Webview UI: Svelte + Tailwind using VS Code theme CSS variables (`--vscode-*`), so the UI follows the user's theme.
- `@opencode/client` for every API call. No hand-written HTTP client.

## Extension milestones (M1–M5)

These are milestones of the VS Code extension. They are not the same as Salim's "Phase 2", which is the mobile app. Branch `phase-1` = M1.

1. M1: scaffold, connection, status bar, session switcher, transcript, controls, todo bar, drafts and empty state, VS Code notifications. Keep the core/UI/bridge boundaries.
2. M2: native diffs, file links polish.
3. M3: terminal mirror for shell tools (output, Stop, Background).
4. M4: workers list + worker editor tabs, OS notifications (companion), "Pair mobile device" command.
5. M5: polish, remote server settings (password in `SecretStorage`), packaging, README, publish decision.

Product phase 2 (mobile): workspace split, `opencode-push` server plugin, mobile app.

Each milestone is a separate brief for a Sonnet 5.5 (high) developer worker, with a review after it.
