/**
 * The few things that need Capacitor: hardware back, resume, deep links, the QR scanner, the system browser, the
 * keyboard and the status bar. Each one has a harmless fallback in a desktop browser, so `bun run dev` works.
 */
import { Capacitor } from "@capacitor/core"
import { App } from "@capacitor/app"
import { Browser } from "@capacitor/browser"
import { Keyboard } from "@capacitor/keyboard"
import { StatusBar, Style } from "@capacitor/status-bar"
import { BarcodeFormat, BarcodeScanner } from "@capacitor-mlkit/barcode-scanning"

export const isNative = (): boolean => Capacitor.isNativePlatform()

type Off = () => void

async function listen(add: () => Promise<{ remove: () => Promise<void> }>): Promise<Off> {
  try {
    const handle = await add()
    return () => void handle.remove()
  } catch {
    return () => {}
  }
}

/** Android's back button or gesture. `handler` returns true when it used the press. */
export function onHardwareBack(handler: () => boolean): Off {
  let off: Off = () => {}
  let dead = false
  void listen(() =>
    App.addListener("backButton", () => {
      if (!handler()) void App.exitApp()
    }),
  ).then((o) => (dead ? o() : (off = o)))
  return () => {
    dead = true
    off()
  }
}

/** The app came back to the foreground. */
export function onResume(handler: () => void): Off {
  let off: Off = () => {}
  let dead = false
  void listen(() => App.addListener("resume", handler)).then((o) => (dead ? o() : (off = o)))
  return () => {
    dead = true
    off()
  }
}

/** The app went to the background (another app, the lock screen). */
export function onPause(handler: () => void): Off {
  let off: Off = () => {}
  let dead = false
  void listen(() => App.addListener("pause", handler)).then((o) => (dead ? o() : (off = o)))
  return () => {
    dead = true
    off()
  }
}

/** A deep link arrived while the app runs. */
export function onUrlOpen(handler: (url: string) => void): Off {
  let off: Off = () => {}
  let dead = false
  void listen(() => App.addListener("appUrlOpen", (e) => handler(e.url))).then((o) => (dead ? o() : (off = o)))
  return () => {
    dead = true
    off()
  }
}

/** The link that started the app, if any. */
export async function launchUrl(): Promise<string | undefined> {
  try {
    const r = await App.getLaunchUrl()
    return r?.url || undefined
  } catch {
    return undefined
  }
}

/** Open a web link in the system browser (a Chrome Custom Tab on Android). Only http(s) links leave the app. */
export async function openInBrowser(url: string): Promise<void> {
  if (!/^https?:\/\//i.test(url)) return
  if (!isNative()) {
    window.open(url, "_blank", "noopener,noreferrer")
    return
  }
  await Browser.open({ url })
}

export type ScanResult = { ok: true; value: string } | { ok: false; message: string; cancelled?: boolean }

/** Scan one QR code with Google's ML Kit scanner (it brings its own camera screen). */
export async function scanQr(): Promise<ScanResult> {
  if (!isNative()) return { ok: false, message: "Scanning works in the Android app. On this screen, paste the pairing link instead." }
  try {
    const supported = await BarcodeScanner.isSupported()
    if (!supported.supported) return { ok: false, message: "This phone cannot scan codes here. Paste the pairing link instead." }
    const module = await BarcodeScanner.isGoogleBarcodeScannerModuleAvailable()
    if (!module.available) {
      // The scanner comes from Google Play services and is downloaded once.
      await BarcodeScanner.installGoogleBarcodeScannerModule()
      await new Promise((r) => setTimeout(r, 4000))
    }
    const res = await BarcodeScanner.scan({ formats: [BarcodeFormat.QrCode] })
    const value = res.barcodes[0]?.rawValue
    return value ? { ok: true, value } : { ok: false, message: "No code was found. Try again, or paste the pairing link.", cancelled: true }
  } catch (e) {
    const text = e instanceof Error ? e.message : String(e)
    if (/cancel/i.test(text)) return { ok: false, message: "Scan cancelled.", cancelled: true }
    return { ok: false, message: `The scanner could not start (${text}). Paste the pairing link instead.` }
  }
}

/** Keep the prompt box visible when the keyboard opens, and match the status bar icons to the theme. */
export function setupChrome(): void {
  if (isNative()) {
    void Keyboard.addListener("keyboardDidShow", () => {
      const el = document.activeElement
      if (el instanceof HTMLElement && /^(TEXTAREA|INPUT)$/.test(el.tagName)) el.scrollIntoView({ block: "nearest" })
    }).catch(() => {})
  }
  const media = window.matchMedia("(prefers-color-scheme: dark)")
  const apply = () => {
    if (!isNative()) return
    // `Style.Dark` means light icons for a dark background.
    void StatusBar.setStyle({ style: media.matches ? Style.Dark : Style.Light }).catch(() => {})
  }
  apply()
  media.addEventListener("change", apply)
}
