import { describe, expect, test } from "bun:test"
import {
  forwardMismatchNotice,
  McpManager,
  mcpActions,
  mcpSummary,
  redirectLoopbackPort,
  signInAdvice,
  type McpDeps,
  type McpHost,
} from "@occ/core/mcp"
import { isLocalServer } from "@occ/core/server-url"

describe("mcpActions", () => {
  test("connected: turn off, and sign out only with a stored credential", () => {
    expect(mcpActions({ status: "connected", credential: false })).toEqual({ toggle: "disconnect", signIn: false, signOut: false, spinner: false })
    expect(mcpActions({ status: "connected", integrationID: "i", credential: true }).signOut).toBe(true)
  })
  test("disabled and failed: turn on", () => {
    expect(mcpActions({ status: "disabled", credential: false }).toggle).toBe("connect")
    expect(mcpActions({ status: "failed", credential: false }).toggle).toBe("connect")
  })
  test("needs_auth: sign in only when there is an integration to sign in to", () => {
    expect(mcpActions({ status: "needs_auth", integrationID: "i", credential: false })).toEqual({ signIn: true, signOut: false, spinner: false })
    expect(mcpActions({ status: "needs_auth", credential: false }).signIn).toBe(false)
  })
  test("pending: a spinner and nothing to press", () => {
    expect(mcpActions({ status: "pending", integrationID: "i", credential: true })).toEqual({ signIn: false, signOut: false, spinner: true })
  })
})

test("mcpSummary counts statuses", () => {
  expect(mcpSummary([{ status: "connected" }, { status: "failed" }, { status: "needs_auth" }, { status: "connected" }])).toEqual({ total: 4, connected: 2, failed: 1, needsAuth: 1 })
})

describe("sign-in over Remote SSH", () => {
  const url = "https://auth.example.com/authorize?client_id=x&redirect_uri=http%3A%2F%2F127.0.0.1%3A35465%2Fcallback&state=s"
  test("reads the loopback callback port from the authorization URL", () => {
    expect(redirectLoopbackPort(url)).toBe(35465)
    expect(redirectLoopbackPort("https://a.example/authorize?redirect_uri=http%3A%2F%2Flocalhost%3A1455%2Fauth%2Fcallback")).toBe(1455)
  })
  test("no port for a public redirect, a missing redirect or garbage", () => {
    expect(redirectLoopbackPort("https://a.example/authorize?redirect_uri=https%3A%2F%2Fapp.example.com%2Fcb")).toBeUndefined()
    expect(redirectLoopbackPort("https://a.example/authorize")).toBeUndefined()
    expect(redirectLoopbackPort("not a url")).toBeUndefined()
    expect(redirectLoopbackPort("https://a.example/authorize?redirect_uri=http%3A%2F%2F127.0.0.1%2Fcb")).toBeUndefined()
  })
  test("remote window with a local server: forward the port first", () => {
    expect(signInAdvice({ port: 35465, remoteHost: true, serverLocal: true })).toEqual({ forward: 35465 })
  })
  test("a local window needs nothing", () => {
    expect(signInAdvice({ port: 35465, remoteHost: false, serverLocal: true })).toEqual({})
  })
  test("a server on another computer: say where the sign-in has to finish", () => {
    expect(signInAdvice({ port: 35465, remoteHost: true, serverLocal: false }).notice).toMatch(/another computer.*35465/)
    expect(signInAdvice({ remoteHost: false, serverLocal: false }).notice).toMatch(/another computer/)
    expect(signInAdvice({ port: 1, remoteHost: true, serverLocal: false }).forward).toBeUndefined()
  })
  test("a forward to a different local port is reported; the same port is silent", () => {
    expect(forwardMismatchNotice(35465, 35465)).toBeUndefined()
    expect(forwardMismatchNotice(35465, undefined)).toBeUndefined()
    expect(forwardMismatchNotice(35465, 41000)).toMatch(/41000.*35465.*may not complete/)
  })
  test("isLocalServer: empty setting and loopback hosts are local", () => {
    expect(isLocalServer("")).toBe(true)
    expect(isLocalServer("127.0.0.1:4096")).toBe(true)
    expect(isLocalServer("http://localhost:4096")).toBe(true)
    expect(isLocalServer("192.168.1.10:4096")).toBe(false)
    expect(isLocalServer("https://opencode.example.com")).toBe(false)
  })
})

/* ------------------------------------------------------------- manager */

type Row = { name: string; status: any; title?: string; integrationID?: string }

function fakeServer(rows: Row[]) {
  const calls: string[] = []
  const state = {
    rows,
    credentials: { mcp_a: ["cred_1"] } as Record<string, string[]>,
    attempt: { mode: "auto" as "auto" | "code", polls: [] as any[] },
    failNext: undefined as string | undefined,
  }
  const maybeFail = () => {
    if (state.failNext) {
      const m = state.failNext
      state.failNext = undefined
      throw { _tag: "InvalidRequestError", message: m }
    }
  }
  const client: any = {
    mcp: { list: async () => (calls.push("mcp.list"), { data: state.rows }) },
    experimental: {
      mcp: {
        connect: async (i: any) => (maybeFail(), calls.push(`connect ${i.server}`), void (state.rows = state.rows.map((r) => (r.name === i.server ? { ...r, status: { status: "connected" } } : r)))),
        disconnect: async (i: any) => (calls.push(`disconnect ${i.server}`), void (state.rows = state.rows.map((r) => (r.name === i.server ? { ...r, status: { status: "disabled" } } : r)))),
      },
    },
    integration: {
      get: async (i: any) => ({
        data: {
          id: i.integrationID,
          methods: [{ type: "key" }, { id: i.integrationID, type: "oauth", label: "x" }],
          connections: [...(state.credentials[i.integrationID] ?? []).map((id) => ({ type: "credential", id, label: "l", method: "oauth" })), { type: "env", name: "X" }],
        },
      }),
      oauth: {
        connect: async (i: any) => (calls.push(`oauth.connect ${i.integrationID} ${i.methodID}`), { data: { attemptID: "att_1", url: "https://auth.example/authorize?redirect_uri=http%3A%2F%2F127.0.0.1%3A35465%2Fcallback", instructions: "Sign in", mode: state.attempt.mode, time: { created: 1, expires: Date.now() + 60_000 } } }),
        status: async () => (calls.push("oauth.status"), { data: state.attempt.polls.shift() ?? { status: "pending" } }),
        complete: async (i: any) => (calls.push(`oauth.complete ${i.code}`), void 0),
        cancel: async (i: any) => (calls.push(`oauth.cancel ${i.attemptID}`), void 0),
      },
    },
    credential: { remove: async (i: any) => (calls.push(`credential.remove ${i.credentialID}`), void (state.credentials.mcp_a = [])) },
  }
  return { client, calls, state }
}

function manager(rows: Row[], host: McpHost = {}) {
  const server = fakeServer(rows)
  const errors: string[] = []
  const deps: McpDeps = {
    client: () => server.client,
    directory: () => "/w",
    host: () => host,
    changed: () => {},
    fail: (m) => errors.push(m),
    sleep: async () => {},
  }
  return { mcp: new McpManager(deps), server, errors }
}

const rows = (): Row[] => [
  { name: "alpha", status: { status: "connected" }, integrationID: "mcp_a" },
  { name: "beta", status: { status: "failed", error: "spawn ENOENT" } },
  { name: "gamma", status: { status: "needs_auth", error: "Authorization required. Run opencode mcp auth gamma and a very long explanation that must wrap" }, integrationID: "mcp_g" },
  { name: "delta", status: { status: "disabled" } },
  { name: "eps", status: { status: "pending" } },
]

describe("McpManager list", () => {
  test("rows carry status, error text and whether a stored credential exists", async () => {
    const { mcp } = manager(rows())
    await mcp.refresh()
    const by = Object.fromEntries(mcp.state.servers.map((s) => [s.name, s]))
    expect(by.alpha).toMatchObject({ status: "connected", credential: true, integrationID: "mcp_a" })
    expect(by.beta).toMatchObject({ status: "failed", error: "spawn ENOENT", credential: false })
    expect(by.gamma?.error).toMatch(/Authorization required/)
    expect(by.gamma?.credential).toBe(false)
    expect(by.eps?.status).toBe("pending")
    expect(mcp.state.loaded).toBe(true)
  })
  test("credentials are looked up once per integration, not on every refresh", async () => {
    const { mcp, server } = manager(rows())
    let gets = 0
    const get = server.client.integration.get
    server.client.integration.get = async (i: any) => (gets++, get(i))
    await mcp.refresh()
    await mcp.refresh()
    expect(gets).toBe(2) // mcp_a and mcp_g, once each
  })
  test("concurrent refreshes share one request", async () => {
    const { mcp, server } = manager(rows())
    await Promise.all([mcp.refresh(), mcp.refresh(), mcp.refresh()])
    expect(server.calls.filter((c) => c === "mcp.list")).toHaveLength(1)
  })
  test("a failing list shows nothing and, while the panel is open, the reason", async () => {
    const { mcp, server } = manager(rows())
    server.client.mcp.list = async () => { throw new Error("boom") }
    mcp.open()
    await mcp.refresh()
    expect(mcp.state.servers).toEqual([])
    expect(mcp.state.error).toBe("boom")
    mcp.close()
  })
  test("closing the panel stops the 3 s refresh", async () => {
    const { mcp } = manager(rows())
    mcp.open()
    await mcp.refresh()
    expect((mcp as any).timer).toBeDefined()
    mcp.close()
    expect((mcp as any).timer).toBeUndefined()
    expect(mcp.state.open).toBe(false)
  })
})

describe("McpManager toggle (runtime only)", () => {
  test("connected → disconnect, disabled/failed → connect, pending → nothing", async () => {
    const { mcp, server } = manager(rows())
    await mcp.refresh()
    await mcp.toggle("alpha")
    await mcp.toggle("delta")
    await mcp.toggle("beta")
    await mcp.toggle("eps")
    await mcp.toggle("gamma")
    expect(server.calls.filter((c) => /connect/.test(c) && !c.startsWith("oauth"))).toEqual(["disconnect alpha", "connect delta", "connect beta"])
    expect(mcp.state.servers.find((s) => s.name === "alpha")?.status).toBe("disabled")
    expect(mcp.state.busy).toEqual([])
  })
  test("a failure is reported (error line while closed, in the panel while open) and the busy flag clears", async () => {
    const closed = manager(rows())
    await closed.mcp.refresh()
    closed.server.state.failNext = "cannot start"
    await closed.mcp.toggle("beta")
    expect(closed.errors).toEqual(["beta: cannot start"])
    expect(closed.mcp.state.busy).toEqual([])
    const open = manager(rows())
    open.mcp.open()
    await open.mcp.refresh()
    open.server.state.failNext = "cannot start"
    await open.mcp.toggle("beta")
    expect(open.mcp.state.error).toBe("beta: cannot start")
    open.mcp.close()
  })
})

describe("McpManager sign-in", () => {
  const host = (extra: Partial<McpHost> = {}) => {
    const opened: string[] = []
    const h: McpHost = { openSignIn: async (u) => (opened.push(u), undefined), ...extra }
    return { h, opened }
  }
  /** Let the background wait run to its end. */
  const settle = async (mcp: McpManager) => { for (let i = 0; i < 30 && (mcp.state.signIn || (mcp as any).attempt); i++) await new Promise((r) => setTimeout(r, 0)) }

  test("auto mode: opens the URL, polls until complete, then re-lists", async () => {
    const { h, opened } = host()
    const { mcp, server } = manager(rows(), h)
    server.state.attempt.polls = [{ status: "pending" }, { status: "pending" }, { status: "complete" }]
    await mcp.refresh()
    await mcp.signIn("gamma")
    expect(server.calls).toContain("oauth.connect mcp_g mcp_g")
    expect(opened).toHaveLength(1)
    expect(mcp.state.signIn).toMatchObject({ server: "gamma", phase: "waiting" })
    await settle(mcp)
    expect(server.calls.filter((c) => c === "oauth.status")).toHaveLength(3)
    expect(mcp.state.signIn).toBeUndefined()
    expect(mcp.state.error).toBeUndefined()
  })
  test("auto mode: a failure shows the server's message", async () => {
    const { h } = host()
    const { mcp, server, errors } = manager(rows(), h)
    server.state.attempt.polls = [{ status: "failed", message: "access_denied" }]
    mcp.open()
    await mcp.refresh()
    await mcp.signIn("gamma")
    await settle(mcp)
    expect(mcp.state.error).toBe("Sign-in failed: access_denied")
    expect(mcp.state.signIn).toBeUndefined()
    expect(errors).toEqual([])
    mcp.close()
  })
  test("auto mode: expiry is reported", async () => {
    const { h } = host()
    const { mcp, server } = manager(rows(), h)
    server.state.attempt.polls = [{ status: "expired" }]
    mcp.open()
    await mcp.refresh()
    await mcp.signIn("gamma")
    await settle(mcp)
    expect(mcp.state.error).toBe("Sign-in expired. Try again.")
    mcp.close()
  })
  test("cancel stops polling and tells the server", async () => {
    const { h } = host()
    const { mcp, server } = manager(rows(), h)
    await mcp.refresh()
    await mcp.signIn("gamma")
    await mcp.cancelSignIn()
    await settle(mcp)
    expect(server.calls).toContain("oauth.cancel att_1")
    expect(mcp.state.signIn).toBeUndefined()
    const polls = server.calls.filter((c) => c === "oauth.status").length
    await new Promise((r) => setTimeout(r, 5))
    expect(server.calls.filter((c) => c === "oauth.status").length).toBe(polls)
  })
  test("code mode: asks for the code and completes with it", async () => {
    const { h } = host({ askCode: async () => " 123456 " })
    const { mcp, server } = manager(rows(), h)
    server.state.attempt.mode = "code"
    await mcp.refresh()
    await mcp.signIn("gamma")
    await settle(mcp)
    expect(server.calls).toContain("oauth.complete 123456")
    expect(server.calls).not.toContain("oauth.status")
  })
  test("code mode: an empty answer cancels the attempt", async () => {
    const { h } = host({ askCode: async () => undefined })
    const { mcp, server } = manager(rows(), h)
    server.state.attempt.mode = "code"
    await mcp.refresh()
    await mcp.signIn("gamma")
    await settle(mcp)
    expect(server.calls).toContain("oauth.cancel att_1")
    expect(server.calls.some((c) => c.startsWith("oauth.complete"))).toBe(false)
  })
  test("the host's remark (for example a port that could not be forwarded) stays visible while waiting", async () => {
    const { h } = host({ openSignIn: async () => "VS Code forwarded to 41000" })
    const { mcp } = manager(rows(), h)
    await mcp.refresh()
    await mcp.signIn("gamma")
    expect(mcp.state.notice).toBe("VS Code forwarded to 41000")
    await mcp.cancelSignIn()
  })
  test("a client that cannot open a browser says so", async () => {
    const { mcp, errors } = manager(rows(), {})
    await mcp.refresh()
    await mcp.signIn("gamma")
    expect(errors).toEqual(["This client cannot open a browser for sign-in."])
  })
  test("an integration without an OAuth method is explained", async () => {
    const { h } = host()
    const { mcp, server, errors } = manager(rows(), h)
    server.client.integration.get = async () => ({ data: { methods: [{ type: "key" }], connections: [] } })
    await mcp.refresh()
    await mcp.signIn("gamma")
    expect(errors[0]).toMatch(/does not support signing in/)
    expect(mcp.state.signIn).toBeUndefined()
  })
  test("a server without an integration has no sign-in", async () => {
    const { h, opened } = host()
    const { mcp } = manager([{ name: "plain", status: { status: "needs_auth", error: "x" } }], h)
    await mcp.refresh()
    await mcp.signIn("plain")
    expect(opened).toEqual([])
  })
})

describe("McpManager sign-out", () => {
  test("asks first, then removes every stored credential of the integration and re-lists", async () => {
    const asked: string[] = []
    const { mcp, server } = manager(rows(), { confirm: async (m, a) => (asked.push(`${a}: ${m}`), true) })
    await mcp.refresh()
    await mcp.signOut("alpha")
    expect(asked[0]).toMatch(/^Sign out: Sign out of alpha\?/)
    expect(server.calls).toContain("credential.remove cred_1")
    expect(mcp.state.servers.find((s) => s.name === "alpha")?.credential).toBe(false)
  })
  test("declining does nothing; env connections are never removed", async () => {
    const { mcp, server } = manager(rows(), { confirm: async () => false })
    await mcp.refresh()
    await mcp.signOut("alpha")
    expect(server.calls.some((c) => c.startsWith("credential.remove"))).toBe(false)
    const yes = manager(rows(), { confirm: async () => true })
    await yes.mcp.refresh()
    await yes.mcp.signOut("alpha")
    expect(yes.server.calls.filter((c) => c.startsWith("credential.remove"))).toEqual(["credential.remove cred_1"])
  })
  test("without a confirmation dialog nothing is removed", async () => {
    const { mcp, server } = manager(rows(), {})
    await mcp.refresh()
    await mcp.signOut("alpha")
    expect(server.calls.some((c) => c.startsWith("credential.remove"))).toBe(false)
  })
})

test("reset forgets the list and cancels a running sign-in", async () => {
  const { mcp, server } = manager(rows(), { openSignIn: async () => undefined })
  await mcp.refresh()
  await mcp.signIn("gamma")
  mcp.reset()
  expect(mcp.state.servers).toEqual([])
  expect(mcp.state.signIn).toBeUndefined()
  await new Promise((r) => setTimeout(r, 5))
  expect(server.calls.filter((c) => c === "oauth.status").length).toBeLessThanOrEqual(1)
})
