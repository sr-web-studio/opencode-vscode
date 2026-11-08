# Security policy

These clients talk to an OpenCode server with a password, keep that password in the editor's or the phone's secure storage, and the Android app runs a background notification service. Please treat anything in that path as security-sensitive.

## Supported versions

| Component | Supported |
| --- | --- |
| VS Code extension (and the Voice companion) | the latest release |
| Android app | the latest beta release |
| `opencode-push` plugin | the version in `dev` |

Older releases are not patched; update to the latest one first.

## Reporting a vulnerability

Do **not** open a public issue. Use GitHub's private reporting for this repository:

<https://github.com/sr-web-studio/opencode-vscode/security/advisories/new>

Include the affected component and version, the platform, the steps to reproduce, and what an attacker gains. Remove real server addresses, passwords and tokens from anything you attach; use placeholders.

## In scope

- Storage, transmission and logging of the OpenCode server password and API keys.
- The pairing flow between the VS Code extension and the Android app (pairing link contents, how the phone stores the result).
- The Android notification service (`apps/mobile/android/.../notify/`): the event stream, its HTTP transport and what it writes to notifications or logs.
- The `opencode-push` plugin: the ntfy topic and what it sends.
- Anything that lets a web page, another app or another user on the network read a stored credential or act on the server without the user's intent.

Out of scope: vulnerabilities in the OpenCode server itself (report those to the [OpenCode project](https://github.com/anomalyco/opencode)), and issues that require an already-compromised machine or a rooted device.

## What to expect

Reports are handled on a best-effort basis. You will get an acknowledgement, a decision on scope, and credit in the advisory if you want it.
