import { Plugin } from "@opencode/plugin"
import { PushEngine, type EventLike, type SessionMeta } from "./engine"
import { NtfyClient, type Logger } from "./ntfy"
import { parseOptions } from "./options"

export const PLUGIN_ID = "opencode-push"

export const EVENT_TYPES = [
  "permission.asked",
  "form.created",
  "session.execution.started",
  "session.execution.succeeded",
  "session.execution.failed",
  "session.execution.interrupted",
  "session.deleted",
] as const

const RESUBSCRIBE_MS = 3_000

const log: Logger = (level, message) => {
  const line = `[${PLUGIN_ID}] ${message}`
  if (level === "warn") console.warn(line)
  else console.log(line)
}

export default Plugin.define({
  id: PLUGIN_ID,
  setup(ctx) {
    const parsed = parseOptions(ctx.options)
    if (!parsed.ok) {
      log("warn", `disabled: ${parsed.error}`)
      return
    }
    const { options, warnings } = parsed
    for (const w of warnings) log("warn", w)

    const ntfy = new NtfyClient(options.ntfy, log)
    const engine = new PushEngine({
      options,
      log,
      send: (msg) => ntfy.send(msg),
      session: async (sessionID): Promise<SessionMeta | undefined> => {
        const s = await ctx.session.get({ sessionID })
        return { title: s.title, parentID: s.parentID, directory: s.location?.directory }
      },
    })

    const controller = new AbortController()
    const run = async () => {
      while (!controller.signal.aborted) {
        try {
          for await (const event of ctx.event.subscribe({ types: [...EVENT_TYPES], signal: controller.signal })) {
            // Fire and forget: a slow ntfy server must not hold back the event stream. `handle` never rejects.
            void engine.handle(event as EventLike)
          }
        } catch (err) {
          if (controller.signal.aborted) return
          log("warn", `event stream error (${err instanceof Error ? err.name : "error"}), resubscribing`)
        }
        if (controller.signal.aborted) return
        await new Promise((r) => setTimeout(r, RESUBSCRIBE_MS))
      }
    }
    void run()

    const where = new URL(options.ntfy.url).origin
    log("info", `loaded: pushing to ${where} (topic length ${options.ntfy.topic.length}), workers ${options.workers ? "on" : "off"}`)
    return () => controller.abort()
  },
})
