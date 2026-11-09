import { describe, expect, test } from "bun:test"
import { WorkerTab } from "@occ/core/worker-tab"

const form = (id: string, sessionID: string) => ({ id, sessionID, title: "Questions", fields: [] })

/** A worker tab over a fake controller: one pending form for the worker and one for another session. */
function setup(pending = [form("frm_w", "ses_w"), form("frm_other", "ses_other")], failReply = false) {
  const calls: Array<[string, unknown]> = []
  let observer: { event?(ev: unknown): void; resync?(): void } | undefined
  const client = {
    session: {
      get: async () => ({ id: "ses_w", title: "Worker title" }),
      form: {
        reply: async (input: unknown) => {
          if (failReply) throw new Error("server said no")
          calls.push(["reply", input])
        },
        cancel: async (input: unknown) => void calls.push(["cancel", input]),
      },
    },
    form: {
      list: async (query: unknown) => {
        calls.push(["list", query])
        return { data: pending }
      },
    },
    message: { list: async () => ({ data: [], cursor: { next: null, previous: null } }) },
  }
  const controller = {
    api: client,
    observe: (o: typeof observer) => {
      observer = o
      return () => {}
    },
    subscribe: () => () => {},
    snapshot: () => ({ target: { kind: "session", id: "ses_lead" }, features: { revert: true, rename: true }, workers: [], running: [], error: undefined }),
    permissionsOf: () => [],
    locationOf: () => ({ directory: "/w" }),
    dispatch: async (a: unknown) => void calls.push(["dispatch", a]),
  }
  return { tab: new WorkerTab(controller as never, "ses_w"), calls, event: (ev: unknown) => observer?.event?.(ev) }
}

describe("a worker's question on its own screen", () => {
  test("opening the worker loads its own pending form, not another session's", async () => {
    const { tab, calls } = setup()
    await tab.start()
    expect(calls).toContainEqual(["list", { location: { directory: "/w" } }])
    expect(tab.snapshot().form).toMatchObject({ id: "frm_w", sessionID: "ses_w" })
    tab.dispose()
  })

  test("a reply names the worker session and the form, then the form is gone", async () => {
    const { tab, calls } = setup()
    await tab.start()
    await tab.dispatch({ type: "formReply", answer: { q0: "blue" } })
    expect(calls).toContainEqual(["reply", { sessionID: "ses_w", formID: "frm_w", answer: { q0: "blue" } }])
    expect(tab.snapshot().form).toBeUndefined()
    expect(tab.snapshot().error).toBeUndefined()
    tab.dispose()
  })

  test("cancel names the worker session and the form", async () => {
    const { tab, calls } = setup()
    await tab.start()
    await tab.dispatch({ type: "formCancel" })
    expect(calls).toContainEqual(["cancel", { sessionID: "ses_w", formID: "frm_w" }])
    expect(tab.snapshot().form).toBeUndefined()
    tab.dispose()
  })

  test("a live form.created for this worker appears; one for another session does not", async () => {
    const { tab, event } = setup([])
    await tab.start()
    expect(tab.snapshot().form).toBeUndefined()
    event({ type: "form.created", data: { form: form("frm_other", "ses_other") } })
    expect(tab.snapshot().form).toBeUndefined()
    event({ type: "form.created", data: { form: form("frm_w", "ses_w") } })
    expect(tab.snapshot().form).toMatchObject({ id: "frm_w" })
    event({ type: "form.replied", data: { id: "frm_w", sessionID: "ses_w" } })
    expect(tab.snapshot().form).toBeUndefined()
    tab.dispose()
  })

  test("a reply to an older form leaves a newer one on screen", async () => {
    const { tab, event } = setup([])
    await tab.start()
    event({ type: "form.created", data: { form: form("frm_new", "ses_w") } })
    event({ type: "form.replied", data: { id: "frm_old", sessionID: "ses_w" } })
    expect(tab.snapshot().form).toMatchObject({ id: "frm_new" })
    tab.dispose()
  })

  test("a failing reply shows on the tab's own error line and keeps the form", async () => {
    const { tab } = setup(undefined, true)
    await tab.start()
    await tab.dispatch({ type: "formReply", answer: {} })
    expect(tab.snapshot().error).toBe("server said no")
    expect(tab.snapshot().form).toMatchObject({ id: "frm_w" })
    tab.dispose()
  })
})
