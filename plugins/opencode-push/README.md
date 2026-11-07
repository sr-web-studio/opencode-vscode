# opencode-push

An [OpenCode](https://opencode.ai) V2 **server plugin** that sends a phone push through [ntfy](https://ntfy.sh) when a session needs you or finishes. It runs inside the OpenCode server, so it works when no client is open: the phone app, VS Code and the terminal can all be closed.

| Event | Push title | Body |
| --- | --- | --- |
| Permission asked | `<session title> needs permission` | `Waiting for your approval (<action>)` + project folder |
| Question / form created | `<session title> has a question` | first field text of the question + project folder |
| Root session turn succeeded | `<session title> finished` | `Turn finished` + project folder |
| Root session turn failed | `<session title> failed` | first line of the error + project folder |
| Worker (child session) turn ended | same as above, **only if `workers: true`** | |

Attention pushes (permission, question) and failures use ntfy priority 4 (`high`); "finished" uses 3 (`default`).
Rules, the same as the VS Code extension's notification engine: one push per session per 5 s (an attention push always gets through and replaces a pending "finished"), the same request id is never announced twice.

Tapping a push opens `opencode-mobile://session/<sessionID>?server=<serverId>` (the `Click` header of ntfy). That link is for the upcoming Android app; until it exists, tapping does nothing useful.

## Privacy

What leaves your server, to the ntfy server you choose (ntfy.sh or your own):

- the session **title** (as the VS Code toast shows it), at most 80 characters,
- the **name** of the project folder (not the path),
- for a permission: the **action name** only (`edit`, `shell`, …), never the resources, command, path or tool input,
- for a question: the text of the first field (what the toast shows), clipped to 140 characters,
- for a failure: the first line of the error message, clipped to 140 characters,
- the deep link with the session id.

Never sent: transcript text, tool inputs or outputs, file contents, diffs, permission resources, provider keys. Question and error text also pass a redaction step that blanks bearer tokens, `sk-…` style keys, `password=…` pairs and long random strings. Set `"details": false` and question/error text is replaced by generic wording (`Needs your input`, `The turn failed`).

**On ntfy.sh anyone who knows the topic name can read the pushes.** Use a long random topic (20+ characters) or a self-hosted ntfy with access control. Titles of your sessions are visible to whoever can read the topic.

## Install (owner, Ubuntu service)

The plugin is plain TypeScript; OpenCode (Bun) runs `src/index.ts` directly, there is no build step, and the plugin needs no `node_modules` (OpenCode provides `@opencode/plugin` at runtime — checked by loading a copy that has only `src/` and `package.json`).

1. Put the folder somewhere stable on the server, for example:

   ```sh
   git clone <repo> ~/src/opencode-vscode   # or copy plugins/opencode-push
   # the plugin directory is ~/src/opencode-vscode/plugins/opencode-push
   ```

2. Pick a topic and keep it out of git:

   ```sh
   head -c 24 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 24; echo
   ```

3. Add the plugin to `~/.config/opencode/opencode.json` (the key is `plugins`; the object form passes options). Add this entry to the existing `plugins` array, keep the other entries:

   ```jsonc
   {
     "plugins": [
       {
         "package": "/home/salim/work/projects/opencode-vscode/plugins/opencode-push",
         "options": {
           "ntfy": {
             "url": "https://ntfy.sh",
             "topic": "{file:~/.config/opencode/secrets/ntfy-topic}",
             "token": "{file:~/.config/opencode/secrets/ntfy-token}"
           },
           "click": { "serverId": "office" },
           "workers": false,
           "minDurationSeconds": 0
         }
       }
     ]
   }
   ```

   OpenCode watches its config, so the plugin loads without a restart. Do **not** restart the service just for this. The log line in step 4 confirms the load (`GET /api/plugin` also lists active plugins).

   `token` is optional: leave it out for a public topic. `{env:NAME}` and `{file:path}` are resolved by OpenCode in every config string, so the topic and token do not have to sit in `opencode.json`. If `token` is absent the plugin also reads the environment variable `OPENCODE_PUSH_NTFY_TOKEN` (or the variable named by `ntfy.tokenEnv`).

4. Check the server log for `[opencode-push] loaded: pushing to https://ntfy.sh (topic length 24), workers off`. The plugin writes with `console.log`/`console.warn`, so the line appears on the stdout/stderr of the OpenCode server process (with `opencode serve --print-logs` in a terminal; under a service manager, in its journal/log). It is not written to `opencode.log`. Warnings at load time: a short topic, plain `http://`.

If `ntfy.topic` is missing or invalid the plugin logs `disabled: <reason>` and does nothing; it never breaks OpenCode.

### Options

| Option | Default | Meaning |
| --- | --- | --- |
| `ntfy.url` | `https://ntfy.sh` | ntfy base URL (self-hosted: `https://ntfy.example.com`) |
| `ntfy.topic` | required | topic name: letters, digits, `_`, `-`, max 64 |
| `ntfy.token` | none | access token, sent as `Authorization: Bearer …` |
| `ntfy.tokenEnv` | `OPENCODE_PUSH_NTFY_TOKEN` | environment variable read when `token` is empty |
| `ntfy.username`, `ntfy.password` | none | Basic auth, used only when no token |
| `ntfy.timeoutMs` | `5000` | request timeout (500–30000) |
| `kinds.permission` / `question` / `finished` / `failed` | all `true` | per-kind switches |
| `workers` | `false` | also push when a worker (child session) turn ends |
| `minDurationSeconds` | `0` | no "finished" push for turns shorter than this (failures always push) |
| `details` | `true` | `false`: no question or error text in pushes |
| `click.template` | `opencode-mobile://session/{sessionID}?server={serverId}` | click URL; `""` for none. Placeholders `{sessionID}`, `{serverId}` (URL-encoded) |
| `click.serverId` | host name | the id the app knows this server by |

## ntfy setup

1. Install the **ntfy** app on the phone (Google Play or F-Droid).
2. **ntfy.sh (easiest):** in the app tap **+** → topic name = your random topic → leave the server default. No account needed.
3. **Self-hosted:** run ntfy on a server you control behind HTTPS, set `auth-default-access: deny-all`, create a user and a token (`ntfy token add <user>`), grant it the topic (`ntfy access <user> <topic> rw`), and in the phone app add that server under *Settings → Default server / Manage users*. Set `ntfy.url` and `ntfy.token` here.
4. For a reliable delivery on Android, in the ntfy app enable *Instant delivery* for self-hosted servers (ntfy.sh uses Firebase) and exclude the app from battery optimisation.

Docs: <https://docs.ntfy.sh/publish/> (JSON publishing, `click`, authentication).

## Test it

Unit tests (a fake ntfy server on 127.0.0.1, fake events):

```sh
cd plugins/opencode-push
bun install
bun test
bun run typecheck
```

Manual check without touching your service: start a **private** server with its own data and config directory, a fake or real topic, and send one short prompt.

```sh
export OPENCODE_CONFIG_DIR=/tmp/opencode/push-test/config   # contains the plugin entry, pointing ntfy.url at a local listener
cd /tmp/opencode/push-test/project
XDG_DATA_HOME=/tmp/opencode/push-test/xdg/data opencode serve --hostname 127.0.0.1 --port 4196 --print-logs
```

then create a session and prompt it (`reply ok`): the log shows `push finished`, and your listener (or the phone, with a real topic) receives the push. To see an attention push, add `{ "action": "shell", "resource": "*", "effect": "ask" }` to the private config's `permissions` and ask the model to run `echo hello`.

## How it works (for maintainers)

- `Plugin.define({ id: "opencode-push", setup(ctx) })` (`@opencode/plugin`). `setup` reads `ctx.options`, starts a loop over `ctx.event.subscribe({ types, signal })` and returns a cleanup that aborts it. The stream is resubscribed after an error.
- Subscribed types: `permission.asked`, `form.created`, `session.execution.started` / `succeeded` / `failed` / `interrupted`, `session.deleted`. Started/interrupted only feed `minDurationSeconds`; deleted clears state.
- `session.execution.*` events carry no `location`, so title, `parentID` and folder come from `ctx.session.get({ sessionID })` (an unknown session falls back to the title `OpenCode`).
- Publishing uses ntfy's JSON API (POST to the server root), so non-ASCII titles are safe. One attempt per push, 5 s timeout, no retries; failures are logged at most once per minute, without URL, topic or token.
- Source: `src/index.ts` (wiring), `src/engine.ts` (rules), `src/format.ts` (wording, redaction), `src/ntfy.ts` (client), `src/options.ts` (config parsing).

## Notes and limits

- **Device registration route/RPC** (for a future FCM-style flow): a server plugin can register typed RPC methods with `ctx.rpc.register(Rpc.define(...), handlers)`; clients call them over HTTP with `client.rpc(Def)`. Not used here; ntfy needs no registration.
- **Is anyone watching?** The plugin API has no list of connected clients, so the plugin cannot silence a push while the VS Code window is focused. Combine with `kinds`/`minDurationSeconds` instead.
- A push has no actions (Allow/Deny buttons) yet.
