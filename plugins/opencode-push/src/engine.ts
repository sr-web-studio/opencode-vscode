import { buildPush, clickUrl, isAttention, type Kind, type Push } from "./format"
import type { Message } from "./ntfy"
import type { Options } from "./options"

/** The few fields of an OpenCode event this plugin reads. Everything else is ignored, so it cannot leak. */
export type EventLike = {
  type: string
  data?: unknown
  location?: { directory?: string }
}

export type SessionMeta = { title?: string; parentID?: string; directory?: string }

export type EngineDeps = {
  options: Options
  /** Look the session up (title, parent, folder). May reject or return undefined; both are handled. */
  session: (sessionID: string) => Promise<SessionMeta | undefined>
  send: (msg: Message) => Promise<unknown>
  now?: () => number
  log?: (level: "info" | "warn", message: string) => void
}

type Shown = { kind: Kind; at: number }

const REQUEST_MEMORY = 256

const rec = (v: unknown): Record<string, unknown> => (typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {})
const text = (v: unknown): string | undefined => (typeof v === "string" && v !== "" ? v : undefined)

/**
 * Decides which events become pushes. Same rules as the VS Code extension's notification engine
 * (`src/core/notifications/engine.ts`): permission / question / finished / failed, worker turns only when enabled,
 * one push per session per 5 s window where attention beats everything, repeated request ids dropped.
 *
 * `handle` never throws. It resolves after the push attempt, so tests can await it; the plugin loop does not wait for it.
 */
export class PushEngine {
  private shown = new Map<string, Shown>()
  private started = new Map<string, number>()
  private seenRequests: string[] = []
  private readonly now: () => number

  constructor(private readonly deps: EngineDeps) {
    this.now = deps.now ?? Date.now
  }

  async handle(ev: EventLike): Promise<void> {
    try {
      await this.dispatch(ev)
    } catch (err) {
      this.log("warn", `event ${ev?.type ?? "?"} skipped: ${err instanceof Error ? err.name : "error"}`)
    }
  }

  private async dispatch(ev: EventLike): Promise<void> {
    const d = rec(ev.data)
    switch (ev.type) {
      case "session.execution.started": {
        const id = text(d.sessionID)
        if (id) this.started.set(id, this.now())
        return
      }
      case "session.execution.interrupted": {
        const id = text(d.sessionID)
        if (id) this.started.delete(id)
        return
      }
      case "session.deleted": {
        const id = text(d.sessionID)
        if (id) {
          this.started.delete(id)
          this.shown.delete(id)
        }
        return
      }
      case "permission.asked":
        return this.attention(ev, text(d.sessionID), "permission", { requestID: text(d.id), action: text(d.action) })
      case "form.created": {
        const form = rec(d.form)
        const field = Array.isArray(form.fields) ? rec(form.fields[0]) : {}
        return this.attention(ev, text(form.sessionID), "question", {
          requestID: text(form.id),
          detail: text(field.description) ?? text(field.title) ?? text(form.title),
        })
      }
      case "session.execution.succeeded":
      case "session.execution.failed": {
        const sessionID = text(d.sessionID)
        if (!sessionID) return
        const failed = ev.type === "session.execution.failed"
        const startedAt = this.started.get(sessionID)
        this.started.delete(sessionID)
        const meta = await this.lookup(sessionID)
        const isWorker = Boolean(meta?.parentID)
        if (isWorker && !this.deps.options.workers) return this.drop(failed ? "failed" : "finished", sessionID, "worker turn (workers option is off)")
        const kind: Kind = failed ? "failed" : "finished"
        if (!failed && startedAt !== undefined) {
          const seconds = (this.now() - startedAt) / 1000
          if (seconds < this.deps.options.minDurationSeconds) return this.drop(kind, sessionID, `turn took ${seconds.toFixed(1)} s (minDurationSeconds)`)
        }
        return this.consider(ev, sessionID, kind, { meta, detail: failed ? text(rec(d.error).message) : undefined })
      }
      default:
        return
    }
  }

  private async attention(ev: EventLike, sessionID: string | undefined, kind: "permission" | "question", extra: { requestID?: string; detail?: string; action?: string }) {
    if (!sessionID) return this.drop(kind, "-", "the event has no session id")
    return this.consider(ev, sessionID, kind, { meta: undefined, ...extra })
  }

  private async lookup(sessionID: string): Promise<SessionMeta | undefined> {
    try {
      return await this.deps.session(sessionID)
    } catch {
      return undefined
    }
  }

  private async consider(
    ev: EventLike,
    sessionID: string,
    kind: Kind,
    extra: { meta?: SessionMeta; requestID?: string; detail?: string; action?: string },
  ): Promise<void> {
    const { options } = this.deps
    if (!options.kinds[kind]) return this.drop(kind, sessionID, `kinds.${kind} is off`)

    // Same request announced twice (replay): the first one stands.
    if (extra.requestID) {
      if (this.seenRequests.includes(extra.requestID)) return this.drop(kind, sessionID, "the same request was already announced")
      this.seenRequests.push(extra.requestID)
      if (this.seenRequests.length > REQUEST_MEMORY) this.seenRequests.shift()
    }

    const t = this.now()
    this.prune(t)
    const prior = this.shown.get(sessionID)
    if (prior && t - prior.at < options.coalesceMs && !isAttention(kind)) {
      return this.drop(kind, sessionID, `a ${prior.kind} push for this session went out ${t - prior.at} ms ago (coalesce window)`)
    }
    // Claim the slot before any await, so two events racing for one session cannot both pass.
    this.shown.set(sessionID, { kind, at: t })

    const meta = extra.meta ?? (await this.lookup(sessionID))
    const push: Push = buildPush({
      kind,
      sessionID,
      sessionTitle: meta?.title,
      directory: meta?.directory ?? ev.location?.directory,
      detail: extra.detail,
      action: extra.action,
      details: options.details,
    })
    const click = clickUrl(options.clickTemplate, sessionID, options.serverId)
    this.log("info", `push ${kind} (session ${sessionID})`)
    await this.deps.send({ title: push.title, body: push.body, priority: push.priority, tags: push.tags, click })
  }

  private prune(t: number) {
    for (const [id, s] of this.shown) if (t - s.at >= this.deps.options.coalesceMs) this.shown.delete(id)
    // A turn that never ended (crash, interrupted elsewhere) must not pin memory forever.
    if (this.started.size > 512) this.started.clear()
  }

  private drop(kind: Kind, sessionID: string, why: string) {
    this.log("info", `skip ${kind} (session ${sessionID}): ${why}`)
  }

  private log(level: "info" | "warn", message: string) {
    try {
      this.deps.log?.(level, message)
    } catch {
      // logging never matters more than the push
    }
  }
}
