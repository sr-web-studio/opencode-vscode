# Connect the Android app to your OpenCode server

The Android app **OpenCode (unofficial)** is a client. It does not run OpenCode itself: it connects to an OpenCode V2
server on a computer. That server has to listen on the network and have a password, because a phone can only reach it
over Wi-Fi or Tailscale.

This guide sets up that server once and then pairs the app. It works the same on Linux, macOS and Windows.

- **What you need** — the computer, the phone and ten minutes.
- **Step 1** makes the server reachable from the phone.
- **Step 2** finds the address the phone should use.
- **Step 3** installs the app.
- **Step 4** pairs the app with the server.

If OpenCode already runs on an always-on machine (a home server, a VPS, a Tailscale host), skip to
[Already have a remote OpenCode server?](#already-have-a-remote-opencode-server).

## What you need

- A computer with OpenCode V2 installed, so the `opencode` command works. Check with `opencode --version`.
- The computer and the phone on the same Wi-Fi network, **or** both signed in to the same
  [Tailscale](https://tailscale.com) network.
- The app, installed as described in [Step 3](#3-install-the-app).
- A password you choose for the server. Use a long one: it protects everything OpenCode can do on that computer.

## 1. Run OpenCode as a network service

OpenCode runs one shared background server. By default it listens on `127.0.0.1` only, on a port that depends on the
platform, so a phone cannot reach it. Change that once:

```sh
opencode service set hostname 0.0.0.0
opencode service set port 4096
opencode service set password "choose-a-strong-password"
opencode service start
```

`opencode service set` stops the running background server, so the last line starts it again with the new settings.
This is the supported way to change the settings; it writes them to OpenCode's `service.json` for you.

Check that the server is up:

```sh
opencode service status
```

It prints `http://0.0.0.0:4096` when the server runs (or `stopped`). `opencode service get hostname` and
`opencode service get port` show the saved values.

**What the settings mean**

- `hostname 0.0.0.0` listens on every network interface: your Wi-Fi/Ethernet LAN and Tailscale. `127.0.0.1` or
  `localhost` would listen on the computer only, and the phone could never connect.
- `port 4096` is a fixed, easy-to-type port. Any free port works; use the same number everywhere below. Without this
  setting the service picks a platform default (49374 on Linux, macOS and WSL, 28894 on Windows). If `4096` is already
  taken on the computer, choose another free port and use it instead in every step.
- `password` is required for every request. OpenCode uses HTTP Basic auth with the user name `opencode`, which the
  app fills in for you.

**The config file (optional reading)**

The three settings live in `service.json` in OpenCode's config folder:

| System | Folder |
| --- | --- |
| Linux, macOS | `~/.config/opencode/` |
| Windows | `%USERPROFILE%\.config\opencode\` (the same layout under your user profile) |
| Any system with `XDG_CONFIG_HOME` set | `$XDG_CONFIG_HOME/opencode/` |

To print the exact folder on your machine:

```sh
opencode debug paths config
```

The file then contains:

```json
{
  "hostname": "0.0.0.0",
  "port": 4096,
  "password": "choose-a-strong-password"
}
```

Editing the file by hand works too. Run `opencode service restart` afterwards, because the server reads it only at
start. Prefer the `opencode service set` commands above: they cannot break the JSON.

**Allow the port through the firewall**

- **Ubuntu / Debian (ufw):** `sudo ufw allow 4096/tcp` (only if `ufw` is enabled).
- **Windows:** the first time OpenCode listens, Windows Defender Firewall asks. Allow it on **private** networks.
- **macOS:** allow incoming connections if macOS asks.

Keep the port on your local network or Tailscale. Never forward it on your router; see
[Security notes](#security-notes).

## 2. Find your computer's address

The phone connects to the **computer**, so use the computer's address, never the phone's. Ignore `127.0.0.1`
(this computer only) and `172.17.x`–`172.31.x` (usually a Docker container network).

- **Linux:** `ip -4 addr show` — the `inet` line of your Wi-Fi or Ethernet interface, for example
  `inet 192.168.1.10/24`.
- **macOS:** `ipconfig getifaddr en0` for Wi-Fi (`en1` for some Macs), or System Settings → Network.
- **Windows:** `ipconfig` — the **IPv4 Address** of your Wi-Fi or Ethernet adapter, for example `192.168.1.10`.
- **Tailscale (any system):** open the Tailscale menu or app; the computer's `100.x.y.z` address is shown there. Use
  it when the phone also has Tailscale.
- **From OpenCode:** `opencode api get /api/info` lists the server's addresses in `urls`.

Write the address down as `http://<address>:4096`, for example `http://192.168.1.10:4096` or
`http://100.64.0.1:4096`.

## 3. Install the app

1. On the phone, open the [latest release](https://github.com/sr-web-studio/opencode-vscode/releases) and download the
   `opencode-mobile-…-beta.apk` file from the newest `mobile-v…-beta` pre-release. Android 7.0 or newer is required.
2. Open the downloaded file. Android asks whether the browser or file manager may install apps; allow it for this
   install.
3. The app is a beta and is not in the Play Store. Updates are installed the same way, from a newer APK.

## 4. Pair

There are two ways. The QR code is quicker: it connects the app for you.

**With the QR code**

1. In VS Code, connected to the same OpenCode server, open the Command Palette and run
   **OpenCode: Pair Mobile Device…**.
2. Pick the address your phone can reach. The list shows the **server's** addresses, not the phone's:
   - **Wi-Fi / local network** when the phone is on the same Wi-Fi,
   - **Tailscale** when the phone has Tailscale on.
3. In the app tap **Add server** → **Scan QR code**, and point the camera at the code in VS Code.
4. The code works once and expires after 5 minutes. If it expired, press **New code** in the panel and scan again.

**By typing the address**

1. In the app tap **Add server**.
2. **Server address:** `http://192.168.1.10:4096`, using the address from Step 2.
3. **Password:** the password from Step 1.
4. **Test connection** shows whether it works; then **Save and open**.

The app keeps the password in Android's Keystore-backed secure storage. If VS Code runs on a different computer than
the server (for example over Remote SSH), the pairing panel still lists the server's addresses, which is what the
phone needs.

## Already have a remote OpenCode server?

If OpenCode runs on an always-on machine and VS Code connects to it with `opencode.serverUrl`, you do not need Steps 1
and 2 on this computer:

- The remote server still needs `hostname 0.0.0.0` and a password, and its firewall must allow the port. Run the
  Step 1 commands **on that machine**.
- Then either run **OpenCode: Pair Mobile Device…** in a VS Code window connected to that server and scan the code,
  or type the server's address and password in the app.

A foreground `opencode serve` does not read `service.json`. Give it a fixed password with the `OPENCODE_PASSWORD`
environment variable (the older `OPENCODE_SERVER_PASSWORD` also works), and the same variable to `opencode --server` on
the clients:

```sh
OPENCODE_PASSWORD="choose-a-strong-password" opencode serve --hostname 0.0.0.0 --port 4096
```

## Troubleshooting

- **The app says it cannot reach the server.** Check the address (computer, not phone), that both devices are on the
  same Wi-Fi or Tailscale network, and the firewall. `opencode service status` must show `http://0.0.0.0:<port>`, not
  `127.0.0.1`. On the phone, open `http://<address>:<port>/api/info` in a browser: a password prompt or a `401` means
  the server is reachable, a timeout means it is not.
- **Wrong password.** The app reports an authentication error. Use the server password, not the OpenCode account or
  any provider key. After `opencode service set password "…"`, enter the new one in the app.
- **The pairing code expired.** Codes work once for 5 minutes. Run **OpenCode: Pair Mobile Device…** again, or press
  **New code** in the panel.
- **The QR code is not recognised.** Use **Scan QR code** in the app, not the phone's camera app. You can also paste
  the link shown under the code.
- **It works on Wi-Fi but not on mobile data.** That is expected: a LAN address only works on the LAN. Install
  Tailscale on both devices and use the `100.x` address, or stay on Wi-Fi. Never expose the port to the internet.
- **Notifications arrive late on a Samsung phone.** Add the app to **Never sleeping apps** (Settings → Battery →
  Background usage limits), and allow notifications for it.

## Security notes

- The password protects everything: sessions, files and the shell OpenCode can run. Use a long random password and
  keep it to yourself.
- `0.0.0.0` listens on every interface, so anyone on the same network can reach the port; the password is what keeps
  them out. Over plain `http://` neither the password nor the traffic is encrypted. On a network you do not trust, use
  Tailscale (encrypted) or put the server behind an HTTPS reverse proxy.
- Never forward port 4096 on your router and never expose it to the internet.
- `service.json` stores the password in plain text on that computer. Do not commit it or share it.
- Changing the password signs out every connected client, including the phone; enter the new password in the app.

---

OpenCode (unofficial) is not affiliated with the OpenCode team. The app talks only to your own OpenCode server;
nothing goes through a third-party push service.
