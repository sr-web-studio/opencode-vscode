# Plan: OpenCode for VS Code and mobile

Last updated: 2026-11-06. The detailed spec is `docs/design.md`; this file is the short version of what I want and where we are.

## Why

I like OpenCode a lot. I use it like this:

- An Ubuntu service runs OpenCode permanently on port 4096 with a known password, reachable over LAN and Tailscale.
- I use it from the browser on my laptop and my phone. Even if I close the browser, sessions keep running, and I can pick one up exactly where it is, even hours later.

What I miss is a good VS Code extension that lets me use OpenCode inside VS Code's ecosystem, and after that a good mobile app with the same UI. I'm building both for myself, with a codebase clean enough to publish.

## Ground rules

- **OpenCode owns everything:** models, providers, MCPs, skills, agents, permissions and config. The extension and the app are clients only. They never change OpenCode config, and never restart or stop the server.
- **Closing VS Code (or the app) never breaks a session.** Background workers, shell commands and wake-ups keep running on the server. This is the most important rule.
- **No bundled runtime.**
  - The extension assumes the `opencode` CLI is installed. If it is missing, it asks me to install it.
  - If the shared service isn't running, it starts the detached service. It never starts one as its own child process.
- **The workspace folder is the project.** Sessions are managed by OpenCode.
- **Everything is free.** Paid third-party services, such as voice, use the user's own API key.

## VS Code extension

### What it does

**Chat panel, in a Claude Code-like style:**

- Compact one-line tool calls that expand and collapse.
- `N steps completed` above the final answer, collapsed by default (configurable).
- Readable text: at least 14px, line-height 1.6, codicons, and capitalized names such as `Assistant`.
- Colored tool lines, and shell lines with a `$` and an exit badge.
- Space between turns, and my prompts set apart with a left accent and padding.
- A compact date and time after each finished turn, e.g. `2:41 PM · 42s`.
- Scrolling follows new output only when I'm already at the bottom, with a jump-to-end button.
- Only messages since the last compaction load, plus "Show earlier messages".

**Controls:**

- Header session dropdown, with rename (pencil, F2 or double-click).
- `+` opens a draft. A server session is created only on the first send, so no empty "Untitled" sessions pile up.
- Agent and model popovers in the prompt footer, with pinned models.
- Inline `Allow · Always · Deny` for permissions, and questions replace the prompt box.
- Todo bar above the prompt box, and an empty-project screen.
- Prompt box at least 2 lines tall, with file and image attachments: paperclip, paste, or drag from Explorer.
- **Revert to a prompt (go back in time):**
  - A hover button on my prompt rolls back the conversation and the files changed after it (OpenCode snapshots).
  - The prompt comes back into the box for editing, and Redo cancels the revert.

**VS Code integration:**

- Clicking a file link opens the file in the editor, and edits show as native diffs.
- Agent shell commands appear in VS Code's terminal panel, like Copilot Chat, and I can stop them.
  - Typing input such as `y`/`n` is deferred until OpenCode's persistent PTY path is confirmed.
- **Workers (subagents):**
  - A Background row lists the running and finished workers.
  - Clicking a worker opens its session as a read-only, live editor tab.
  - The main session stays in the panel.

**Notifications:**

- When OpenCode needs me (a permission or question) or a task finishes or fails.
- Shown as VS Code notifications now. Laptop OS toasts come later from a small companion extension.

**Voice input:** see *Voice* below.

### Status

- **M1 (done, 0.1.x):**
  - connection, session switcher, transcript, controls, todo bar, drafts and empty state, VS Code notifications
  - tested on my Windows laptop
- **Round 2 (in progress, 0.2.0):**
  - all my feedback from the first real use, see `docs/design.md` "Round 2 feedback", items 1–16
  - this pulls the terminal mirror (planned for M3) and the worker tabs (planned for M4) forward
  - also the fix for the prompt box stealing focus
- **Next:**
  - M2: native diffs and file-link polish
  - M4: companion extension (OS toasts and voice capture), workers polish, "Pair mobile device" command
  - M5: remote server settings, README, packaging, publish decision

## Mobile app (Phase 2)

The same UI as a phone app, Android first. It connects to the same OpenCode server over LAN, Tailscale or a public domain.

- **All projects:** lists all OpenCode projects and their sessions. There is no fixed workspace folder.
- **Same experience:** transcript, controls, workers, todo bar, revert and voice, just like the extension.
- **VS Code-only actions are replaced:**
  - editor → a read-only file and diff viewer
  - terminal panel → a read-only shell output view with Stop
  - status bar → a connection indicator in the header
- **Pairing:** scan a QR code shown by the extension's "Pair mobile device" command. Manual URL and password entry also works. Several servers can be saved.
- **Push notifications** when a session needs me or a task finishes, even with the app closed. They are sent by a small OpenCode server plugin (`opencode-push`) through ntfy, which I install on the server myself.
- **Voice input**, the same as the extension: see below.
- **Stack** (re-checked at kickoff): Capacitor wrapping the same Svelte UI, with a shared `core` and `ui` and a `HostBridge` per platform.

## Voice

Dictate prompts in Bangla, English, and mixed Bangla-English, in both the extension and the mobile app.

- **Engine:** Soniox real-time speech-to-text, the best streaming accuracy for Bangla in the Sept 2026 benchmark (about 7.4% CER, about $0.10 per audio hour).
  - Languages are configurable; the default is Bangla + English, and 60+ languages are available.
  - The engine sits behind a small interface, so another one can be added later.
- **Free, bring your own key:**
  - Voice is off until the user adds their own Soniox key, and the user pays Soniox directly. There is no paid tier and no server of ours.
  - The key is stored in VS Code SecretStorage, or the phone's secure storage. Only short-lived temporary keys reach the UI.
- **Behavior:**
  - A mic button in the prompt box. The text appears live while I speak, and I review it before sending; it is never auto-sent.
  - The active languages are shown while recording (`বাংলা + EN`).
- **VS Code:**
  - The chat webview has no microphone access (VS Code limitation), so the laptop-side companion extension records the audio.
  - Which capture method works is tested on my laptop in M4.
- **Mobile:**
  - The phone has native microphone access, so voice works directly in the app with the same Soniox engine and the same key setup.
  - It ships with the first mobile release. Gboard's Bangla voice typing still works as a free fallback.
- **Development key:** my key is in `.env` as `SONIOX_API_KEY`. It is git-ignored, excluded from the package, and used only for dev testing.
