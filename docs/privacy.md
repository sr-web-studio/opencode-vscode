# Privacy policy — OpenCode (unofficial) for Android

This policy covers the Android app **OpenCode (unofficial)** (`dev.srwebstudio.opencode`) and the two VS Code
extensions from the same project, **OpenCode (unofficial)** and its **Voice** companion. They are published by
**SR Web Studio** ([srwebstudio.com](https://srwebstudio.com)).

**Effective 10 November 2026.**

The short version: these clients are remote controls for an OpenCode server that **you** run. Your sessions, files
and prompts stay between your phone or editor and that server. SR Web Studio has no server of its own, receives
nothing from the app, and cannot read your data. The one exception is Google's barcode scanner, which sends Google
some technical diagnostics when you scan the pairing QR code; it is described below.

## Who we are

SR Web Studio builds these clients. They are unofficial: "OpenCode" is the name of a separate project, and these
clients are not affiliated with, endorsed by or supported by the OpenCode team.

Contact: [GitHub Issues](https://github.com/sr-web-studio/opencode-vscode/issues) of the project. That is the only
support channel; there is no account, no sign-up and no mailing list.

## What the app needs before it does anything

The app does not work on its own. It connects to an OpenCode V2 server that you install and run on a computer you
control, usually on your own network (Wi-Fi or [Tailscale](https://tailscale.com)) or a server you rent. You type
the server's address and password, or scan a pairing QR code from the VS Code extension. Everything the app shows
and everything it sends goes to that server.

## What the app stores on your phone

- **Saved servers**: the name you gave the server, its address, and its password (or the one-time pairing token).
  On Android these are encrypted with a key that lives in the Android Keystore and never leaves the device.
- **Your unsent prompts** (the draft of each folder and session): the text you typed, the names of files you
  attached, and small images you pasted, so a draft survives the app being closed.
- **App settings**: chat display options, the model used for "Enhance prompt", pinned sessions, which projects the
  drawer keeps open, and whether you have already been asked about notifications and battery settings.
- **Notification state**: the switches you chose, and the IDs of the requests and events already announced, so the
  same one is not announced twice.
- **Pictures and files you open** are held in memory only while you look at them.

Android's cloud backup is turned off for the app, so none of this is copied to Google Drive. Nothing in the list
above is sent anywhere except to your server as described below.

## What the app sends, and to whom

**Only to the server you added.** The app has no other destination: no SR Web Studio server, no analytics service,
no crash reporting, no advertising network and no push service.

- **To show the app**: it reads your projects, sessions, messages, diffs and files from your server, and listens to
  the server's event stream for new activity.
- **When you act**: the prompt you send, the files and images you attach, your answers to permission requests and
  questions, and session actions such as renaming or deleting a session are sent to that server.
- **In the background** (if you leave notifications on): the app keeps one connection per saved server open, and on
  connecting it asks the server for a session's title, folder and last answer so that the notification can say what
  happened, and for any question or permission request still waiting for you.
- **Every request** carries the server's password as HTTP Basic authentication, because that is how the OpenCode
  server protects itself.

The address you enter decides where the data goes, so the server's own privacy practice is yours to choose. If you
connect to somebody else's OpenCode server, that person can read what you send.

**Plain `http://` is allowed** on purpose, because a server at home usually has no certificate. Over `http://` the
password and everything you send travel unencrypted across that network, so anyone who can watch the network can
read them. Use `https://` or Tailscale on a network you do not trust; the setup guide explains this.

## Google ML Kit (QR code scanning)

The only third-party code in the app that talks to a third party is Google's ML Kit barcode scanner, used for one
thing: scanning the pairing QR code shown by the VS Code extension.

- The camera picture is processed **on the phone**. Google states that the Google code scanner runs entirely inside
  Google Play services, that all image processing happens on the device, and that Google does not store the image or
  the scan result ([Google code scanner](https://developers.google.com/ml-kit/vision/barcode-scanner)).
- ML Kit does send **technical data to Google** for diagnostics and usage analytics. Google lists it as: device
  information (manufacturer, model, OS version and build, available ML accelerators), the app's package name and
  version, per-installation identifiers (and a device identifier for features delivered through Google Play
  services), performance metrics such as latency, API configuration such as image format and resolution, input and
  output size, feature version, event type and error codes. It is sent over HTTPS and, according to Google, not
  shared with third parties ([ML Kit and Google Play's data disclosure requirements](https://developers.google.com/ml-kit/android-data-disclosure),
  [ML Kit terms](https://developers.google.com/ml-kit/terms)).
- That data is not linked to your OpenCode account or your sessions, is not used for advertising, and cannot be
  switched off in the app; Google provides no such setting. The app does not enable the scanner's auto-zoom option,
  the one barcode feature that would add scanning-session data.
- The scanner module itself is downloaded and updated by Google Play services, not by us.

Nothing else in the app contacts Google, and the app uses no other SDK that reports anything. The Play Store app
itself, Android and Google Play services are part of your phone and are governed by Google's privacy policy, not
this one.

## Permissions, and why

- **Internet** — to reach your server.
- **Network state** — to notice when the phone changes network and reconnect.
- **Camera** — only for the QR scanner. The app never opens the camera itself and keeps no pictures; the scanner
  belongs to Google Play services, which shows its own camera screen.
- **Notifications** — to tell you when a session needs you or finishes. Asked when you first turn notifications on.
- **Foreground service (special use)** — to keep the connection to your server open while the app is in the
  background, so that a notification arrives when a session is waiting. It shows a quiet, permanent notification
  while it runs.
- **Start at boot** — to restore that connection after a restart or an app update, if you had it on.
- **Ignore battery optimisation** — asked once, so that Android does not cut the connection while the phone sleeps.
  You can decline; notifications then arrive less reliably.

## Notifications and the lock screen

A notification shows the session title, a one-line summary (a permission request, a question, the first part of the
answer, or an error), and the project folder's name. On a locked screen Android is told to hide that content: the
lock screen only says that a session needs permission, has a question, finished or failed. Message text, file
contents, tool input and the server password never appear in a notification. The app's own log (visible only with
developer tools) records session IDs and server names, never message text or passwords.

## The VS Code extensions

The extensions use the same model: they talk only to the OpenCode server you configure (password kept in VS Code's
secret storage) and send nothing to us.

- **Voice input, on-device engine (default)**: the first time you use it, the companion downloads the sherpa-onnx
  speech engine from the npm registry and the speech models from Hugging Face into its own storage folder on your
  computer, checking each download against a fixed checksum. After that the audio is recognised on your computer
  and never leaves it.
- **Voice input, Soniox engine (optional)**: if you choose it and add your own Soniox API key, your speech is
  streamed to Soniox while you record (`wss://stt-rt.soniox.com`) and a short-lived key is requested from
  `api.soniox.com`. Soniox's own terms and privacy policy apply to that audio. Do not use this engine if you do not
  want your voice sent to them.
- VS Code's own Settings Sync may copy the pinned session IDs and the chosen "Enhance prompt" model between your
  machines if you have Settings Sync on. That is a VS Code feature and stays inside your Microsoft or GitHub
  account.

There is no telemetry in the extensions.

## Retention and deletion

- **On your phone**: everything the app stores stays until you remove it. "Clear storage" in Android's app settings
  or uninstalling the app deletes all of it, including saved servers and passwords. Removing a server in the app
  deletes its address and password.
- **On your server**: sessions, messages, files and their history belong to you and live on your computer. Delete a
  session in the app or on the server; we have no copy and no access.
- **Google ML Kit diagnostics**: held by Google under [Google's privacy policy](https://policies.google.com/privacy).
  We cannot read or delete them.
- There is no account with us, so there is nothing for you to ask us to delete. If you think we hold something
  about you, write in [GitHub Issues](https://github.com/sr-web-studio/opencode-vscode/issues) and we will look.

## Children

The app is a tool for developers and is not directed at children. It has no content of its own, no accounts and no
advertising, and it only works with a server an adult has set up.

## Changes

If this policy changes, the new version replaces this page and the effective date above changes with it. The page
lives in the project's repository, so its history is public.

## Not affiliated with the OpenCode team

OpenCode belongs to the OpenCode team. These clients are unofficial and are not affiliated with, endorsed by or
supported by them.

---

The repository also contains an optional plugin for the OpenCode server that sends notifications through an
[ntfy](https://ntfy.sh) server of your choosing. It is not part of the app or the extensions, it runs on your server
only if you install it, and it is described in its own README.
