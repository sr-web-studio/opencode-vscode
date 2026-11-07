import { afterEach, describe, expect, test } from "bun:test"
import plugin, { EVENT_TYPES } from "../src/index"
import { ev, fakeNtfy, TOPIC } from "./helpers"

const stops: (() => void)[] = []
afterEach(() => {
  while (stops.length) stops.pop()!()
})

/** A fake plugin context whose event stream is fed by the test. */
function fakeCtx(options: unknown, sessions: Record<string, any>) {
  const queue: any[] = []
  let wake: (() => void) | undefined
  const subscribeCalls: any[] = []
  const ctx = {
    options,
    event: {
      subscribe: (opts: { types?: string[]; signal?: AbortSignal }) => {
        subscribeCalls.push(opts)
        return (async function* () {
          while (!opts.signal?.aborted) {
            if (queue.length === 0) await new Promise<void>((r) => (wake = r))
            const next = queue.shift()
            if (next) yield next
          }
        })()
      },
    },
    session: { get: async ({ sessionID }: { sessionID: string }) => sessions[sessionID] ?? Promise.reject(new Error("not found")) },
  }
  return { ctx, subscribeCalls, push: (e: any) => (queue.push(e), wake?.()) }
}

const waitFor = async (cond: () => boolean) => {
  for (let i = 0; i < 100 && !cond(); i++) await new Promise((r) => setTimeout(r, 20))
}

describe("plugin entry", () => {
  test("subscribes with the trigger types, looks the session up and pushes", async () => {
    const ntfy = fakeNtfy()
    stops.push(ntfy.stop)
    const f = fakeCtx({ ntfy: { url: ntfy.url, topic: TOPIC }, click: { serverId: "box" } }, {
      ses_a: { title: "Fix login bug", location: { directory: "/home/u/my-app" } },
    })
    const cleanup = await plugin.setup(f.ctx as any)
    expect(plugin.id).toBe("opencode-push")
    expect(f.subscribeCalls[0].types).toEqual([...EVENT_TYPES])

    // session.execution.* carries no location: the title and folder come from session.get
    f.push(ev.succeeded("ses_a"))
    await waitFor(() => ntfy.requests.length > 0)
    expect(ntfy.requests[0]!.json.title).toBe("Fix login bug finished")
    expect(ntfy.requests[0]!.json.message).toBe("Turn finished\nmy-app")

    if (typeof cleanup === "function") cleanup()
  })

  test("a missing topic disables the plugin without throwing", async () => {
    const f = fakeCtx({}, {})
    const cleanup = await plugin.setup(f.ctx as any)
    expect(cleanup).toBeUndefined()
    expect(f.subscribeCalls).toHaveLength(0)
  })

  test("a failing ntfy server does not stop later events", async () => {
    const ntfy = fakeNtfy((n) => (n === 1 ? new Response("x", { status: 500 }) : Response.json({})))
    stops.push(ntfy.stop)
    const f = fakeCtx({ ntfy: { url: ntfy.url, topic: TOPIC } }, { ses_a: { title: "A" }, ses_b: { title: "B" } })
    const cleanup = await plugin.setup(f.ctx as any)
    f.push(ev.succeeded("ses_a"))
    f.push(ev.succeeded("ses_b"))
    await waitFor(() => ntfy.requests.length >= 2)
    expect(ntfy.requests).toHaveLength(2)
    if (typeof cleanup === "function") cleanup()
  })
})
