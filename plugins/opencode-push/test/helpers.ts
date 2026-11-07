import { PushEngine, type EventLike, type SessionMeta } from "../src/engine"
import { NtfyClient } from "../src/ntfy"
import { parseOptions, type Options } from "../src/options"

export type Recorded = { method: string; path: string; headers: Record<string, string>; json: Record<string, any> }

/** A tiny ntfy stand-in on 127.0.0.1 that records every request. */
export function fakeNtfy(handler?: (n: number) => Response | Promise<Response>) {
  const requests: Recorded[] = []
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(req) {
      const headers: Record<string, string> = {}
      req.headers.forEach((v, k) => (headers[k] = v))
      let json: Record<string, any> = {}
      try {
        json = await req.json()
      } catch {}
      requests.push({ method: req.method, path: new URL(req.url).pathname, headers, json })
      return handler ? handler(requests.length) : Response.json({ id: "x" })
    },
  })
  return { url: `http://127.0.0.1:${server.port}`, requests, stop: () => server.stop(true) }
}

export const TOPIC = "test-topic-0123456789abcdef"

export function options(raw: Record<string, unknown> = {}, env: Record<string, string> = {}): Options {
  const r = parseOptions({ ntfy: { url: "http://127.0.0.1:1", topic: TOPIC }, click: { serverId: "box" }, ...raw }, env, "host")
  if (!r.ok) throw new Error(r.error)
  return r.options
}

export type Clock = { now: () => number; advance: (ms: number) => void }
export const clock = (start = 1_000_000): Clock => {
  let t = start
  return { now: () => t, advance: (ms) => void (t += ms) }
}

export function harness(opts: { options?: Record<string, unknown>; sessions?: Record<string, SessionMeta>; ntfyHandler?: (n: number) => Response | Promise<Response> } = {}) {
  const ntfy = fakeNtfy(opts.ntfyHandler)
  const c = clock()
  const logs: string[] = []
  const o = options({ ntfy: { url: ntfy.url, topic: TOPIC }, ...opts.options })
  const client = new NtfyClient(o.ntfy, (level, m) => logs.push(`${level}: ${m}`), c.now)
  const sessions: Record<string, SessionMeta> = { ses_a: { title: "Fix login bug", directory: "/home/u/work/my-app" }, ...opts.sessions }
  const engine = new PushEngine({
    options: o,
    now: c.now,
    log: (level, m) => logs.push(`${level}: ${m}`),
    send: (m) => client.send(m),
    session: async (id) => sessions[id],
  })
  return { ntfy, engine, clock: c, logs, sessions, options: o }
}

let seq = 0
export const ev = {
  permission: (sessionID: string, extra: Record<string, unknown> = {}): EventLike => ({
    type: "permission.asked",
    data: { id: `per_${++seq}`, sessionID, action: "edit", resources: ["/secret/path/.env"], message: "Edit /secret/path/.env", ...extra },
    location: { directory: "/home/u/work/my-app" },
  }),
  question: (sessionID: string, extra: Record<string, unknown> = {}): EventLike => ({
    type: "form.created",
    data: { form: { id: `frm_${++seq}`, sessionID, title: "Question", fields: [{ key: "a", type: "string", description: "Which database should I use?" }], ...extra } },
  }),
  started: (sessionID: string): EventLike => ({ type: "session.execution.started", data: { sessionID } }),
  succeeded: (sessionID: string): EventLike => ({ type: "session.execution.succeeded", data: { sessionID } }),
  failed: (sessionID: string, message = "Provider returned 500"): EventLike => ({ type: "session.execution.failed", data: { sessionID, error: { type: "provider", message } } }),
  interrupted: (sessionID: string): EventLike => ({ type: "session.execution.interrupted", data: { sessionID } }),
  deleted: (sessionID: string): EventLike => ({ type: "session.deleted", data: { sessionID } }),
}
