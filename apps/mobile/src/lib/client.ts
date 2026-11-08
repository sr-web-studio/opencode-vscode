/**
 * Talking to an OpenCode server: the client, the connection test and the pairing redemption. No URL and no password
 * is written here: they come from the saved profile or from what the user typed.
 */
import { OpenCode } from "@opencode/client"
import type { OpenCodeClient } from "@occ/core/api"
import { diagnoseConnectError, type ConnectProblem } from "./connect-error"
import type { PairingLink } from "./pairing-link"

/** `Authorization` value of the server's basic auth (user `opencode`). UTF-8 safe, no Node `Buffer`. */
export function basicAuth(password: string): string {
  const bytes = new TextEncoder().encode(`opencode:${password}`)
  let bin = ""
  for (const b of bytes) bin += String.fromCharCode(b)
  return `Basic ${btoa(bin)}`
}

export function makeClient(target: { url: string; password: string }): OpenCodeClient {
  return OpenCode.make({ baseUrl: target.url, headers: target.password ? { Authorization: basicAuth(target.password) } : undefined })
}

const origin = () => (typeof location === "object" ? location.origin : "")

export type TestResult = { ok: true; version: string; hostname?: string } | ({ ok: false } & ConnectProblem)

/** Ask `/api/info` (it needs the password, so a good answer proves both the address and the password). */
export async function testConnection(target: { url: string; password: string }): Promise<TestResult> {
  try {
    const info = await makeClient(target).server.info()
    return { ok: true, version: info.version, hostname: info.hostname ?? undefined }
  } catch (e) {
    return { ok: false, ...(await diagnoseConnectError(e, target.url, origin())) }
  }
}

export type PairResult = { ok: true; token: string } | ({ ok: false } & ConnectProblem)

/** Redeem the one-time code of a pairing link: the server answers with a session token that works as the password. */
export async function redeemPairing(link: PairingLink): Promise<PairResult> {
  try {
    const res = await OpenCode.make({ baseUrl: link.baseUrl }).server.connect({ code: link.code })
    if (!res.token) return { ok: false, kind: "other", message: "The server did not give a token. Create a new pairing code and try again." }
    return { ok: true, token: res.token }
  } catch (e) {
    const problem = await diagnoseConnectError(e, link.baseUrl, origin())
    // For a code, “rejected” means used, expired or wrong, not a wrong password.
    if (problem.kind === "unauthorized") return { ok: false, kind: "unauthorized", message: "This pairing code is not valid any more. It works once and only for five minutes. Create a new one on the computer." }
    return { ok: false, ...problem }
  }
}
