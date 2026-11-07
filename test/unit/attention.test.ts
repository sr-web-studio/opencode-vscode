import { describe, expect, test } from "bun:test"
import {
  LineBuffer,
  attentionFor,
  decodeLine,
  encodeRequest,
  identityOf,
  normalizeRequest,
  notifySendArgs,
  osascriptArgs,
  parseWmctrl,
  pickWindows,
  scoreTitle,
  wmctrlAttentionArgs,
  type WindowCandidate,
} from "@occ/core/attention"

const APP = "Visual Studio Code"
const win = (id: number, title: string): WindowCandidate => ({ id, title })

describe("identityOf", () => {
  test("strips the remote suffix from the workspace name", () => {
    expect(identityOf({ workspaceName: "proj [SSH: devbox]", appName: APP, remoteName: "ssh-remote" }).rootName).toBe("proj")
    expect(identityOf({ workspaceName: "proj", appName: APP }).rootName).toBe("proj")
  })
  test("workspace files keep their name, remote host comes from the authority", () => {
    const who = identityOf({ workspaceName: "my (Workspace) [SSH: box]", authority: "ssh-remote+box" })
    expect(who.rootName).toBe("my (Workspace)")
    expect(who.remoteHost).toBe("box")
  })
  test("opaque authorities give no host; empty window has no root", () => {
    expect(identityOf({ workspaceName: "p", authority: "dev-container+7b22686f737450617468223a22" }).remoteHost).toBeUndefined()
    expect(identityOf({ authority: "" })).toEqual({ rootName: undefined, appName: undefined, remoteName: undefined, remoteHost: undefined })
  })
})

describe("pickWindows", () => {
  const who = identityOf({ workspaceName: "api", appName: APP })

  test("one candidate is the one (same process)", () => {
    const p = pickWindows([win(1, "anything - whatever")], who, { trustSingle: true })
    expect(p.reason).toBe("single")
    expect(p.chosen.map((c) => c.id)).toEqual([1])
  })

  test("one candidate without trust still has to match", () => {
    expect(pickWindows([win(1, "other - Visual Studio Code")], who).chosen).toEqual([])
  })

  test("matches the folder among several windows", () => {
    const p = pickWindows([win(1, "a.ts - web - Visual Studio Code"), win(2, "b.ts - api - Visual Studio Code"), win(3, "docs - Visual Studio Code")], who, { trustSingle: true })
    expect(p.reason).toBe("match")
    expect(p.chosen.map((c) => c.id)).toEqual([2])
  })

  test("remote title `folder [SSH: host]` matches, with the host as a tie-break", () => {
    const remote = identityOf({ workspaceName: "api [SSH: box]", appName: APP, remoteName: "ssh-remote", authority: "ssh-remote+box" })
    const p = pickWindows([win(1, "x.ts - api [SSH: other] - Visual Studio Code"), win(2, "x.ts - api [SSH: box] - Visual Studio Code")], remote, { trustSingle: true })
    expect(p.chosen.map((c) => c.id)).toEqual([2])
    expect(p.reason).toBe("match")
  })

  test("folder name is matched as a whole title part, not a substring", () => {
    const p = pickWindows([win(1, "x.ts - api-gateway - Visual Studio Code"), win(2, "x.ts - my api - Visual Studio Code")], who, { trustSingle: true })
    expect(p.chosen).toEqual([])
  })

  test("a window with no editor open: `api - Visual Studio Code`", () => {
    const p = pickWindows([win(1, "api - Visual Studio Code"), win(2, "web - Visual Studio Code")], who)
    expect(p.chosen.map((c) => c.id)).toEqual([1])
  })

  test("duplicates (two windows on the same folder) are all chosen", () => {
    const p = pickWindows([win(1, "a.ts - api - Visual Studio Code"), win(2, "b.ts - api - Visual Studio Code"), win(3, "web - Visual Studio Code")], who, { trustSingle: true })
    expect(p.reason).toBe("tie")
    expect(p.chosen.map((c) => c.id)).toEqual([1, 2])
  })

  test("no match flashes nothing, even when the app name fits", () => {
    const p = pickWindows([win(1, "web - Visual Studio Code"), win(2, "docs - Visual Studio Code")], who, { trustSingle: true })
    expect(p.reason).toBe("none")
    expect(p.chosen).toEqual([])
  })

  test("custom window.title without the folder: nothing, unless a single candidate", () => {
    const custom = [win(1, "My Custom Title"), win(2, "Other Custom")]
    expect(pickWindows(custom, who, { trustSingle: true }).chosen).toEqual([])
    expect(pickWindows([win(1, "My Custom Title")], who, { trustSingle: true }).chosen.map((c) => c.id)).toEqual([1])
  })

  test("a window without a folder (empty window): the app name is the only clue", () => {
    const empty = identityOf({ appName: APP })
    const p = pickWindows([win(1, "Welcome - Visual Studio Code"), win(2, "Notes")], empty, { trustSingle: true })
    expect(p.chosen.map((c) => c.id)).toEqual([1])
  })

  test("requireApp (X11 lists every window) ignores titles that are not this app", () => {
    const p = pickWindows([win(1, "api - Mozilla Firefox"), win(2, "api - Visual Studio Code")], who, { requireApp: true })
    expect(p.chosen.map((c) => c.id)).toEqual([2])
    expect(pickWindows([win(1, "api - Mozilla Firefox")], who, { requireApp: true, trustSingle: true }).chosen).toEqual([])
  })

  test("no candidates", () => {
    expect(pickWindows([], who, { trustSingle: true })).toEqual({ chosen: [], reason: "none" })
  })

  test("scoreTitle ranks folder above host above app", () => {
    const remote = identityOf({ workspaceName: "api", appName: APP, authority: "ssh-remote+box" })
    expect(scoreTitle("a - api [SSH: box] - Visual Studio Code", remote)).toBeGreaterThan(scoreTitle("a - api - Visual Studio Code", remote))
    expect(scoreTitle("x - Visual Studio Code", remote)).toBe(1)
  })
})

describe("helper line protocol", () => {
  test("encodes one ASCII line without a newline", () => {
    const line = encodeRequest({ id: 3, op: "windows", pid: 42 })
    expect(JSON.parse(line)).toEqual({ id: 3, op: "windows", pid: 42 })
    expect(line).not.toContain("\n")
  })

  test("non-ASCII survives as escapes", () => {
    const line = encodeRequest({ id: 1, op: "flash", hwnds: [1] })
    expect(/^[\x20-\x7e]*$/.test(line)).toBe(true)
    const odd = encodeRequest({ id: 1, op: "windows", pid: 1, note: "বাংলা é" } as never)
    expect(/^[\x20-\x7e]*$/.test(odd)).toBe(true)
    expect(JSON.parse(odd).note).toBe("বাংলা é")
  })

  test("decodes ready, responses and ignores noise", () => {
    expect(decodeLine('{"ready":true}')).toEqual({ kind: "ready" })
    expect(decodeLine('{"id":2,"ok":true,"flashed":[7],"skipped":[]}\r')).toEqual({ kind: "response", response: { id: 2, ok: true, flashed: [7], skipped: [] } })
    expect(decodeLine('{"id":2,"ok":false,"error":"boom"}')).toEqual({ kind: "response", response: { id: 2, ok: false, error: "boom" } })
    expect(decodeLine("WARNING: something")).toBeUndefined()
    expect(decodeLine("{not json")).toBeUndefined()
    expect(decodeLine("")).toBeUndefined()
    expect(decodeLine('{"hello":1}')).toBeUndefined()
    expect(decodeLine("[1]")).toBeUndefined()
  })

  test("LineBuffer joins chunks and keeps the partial tail", () => {
    const b = new LineBuffer()
    expect(b.push('{"a":')).toEqual([])
    expect(b.push('1}\r\n{"b":2}\n{"c"')).toEqual(['{"a":1}', '{"b":2}'])
    expect(b.push(":3}\n")).toEqual(['{"c":3}'])
  })
})

describe("osascript / notify-send arguments", () => {
  test("text travels as argv, never inside the script", () => {
    const args = osascriptArgs('Say "hi" \\ now', "it's\nbody")
    const script = args.filter((_, i) => args[i - 1] === "-e").join("\n")
    expect(script).toBe("on run argv\ndisplay notification (item 2 of argv) with title (item 1 of argv)\nend run")
    expect(args.slice(-2)).toEqual(['Say "hi" \\ now', "it's body"])
  })
  test("an argument that starts with a dash cannot be read as an option", () => {
    const [title, body] = osascriptArgs("-e evil", "-").slice(-2)
    expect(title!.startsWith("-")).toBe(false)
    expect(body!.startsWith("-")).toBe(false)
    expect(notifySendArgs("-x", "-y").slice(0, 2)).toEqual(["--app-name=OpenCode", "--"])
  })
  test("empty and long text are tamed", () => {
    expect(osascriptArgs("", "").slice(-2)).toEqual([" ", " "])
    expect(osascriptArgs("t", "x".repeat(1000)).slice(-1)[0]!.length).toBe(240)
    expect(notifySendArgs("", "b")[2]).toBe("OpenCode")
  })
})

describe("wmctrl", () => {
  const out = [
    "0x04600003  0 1234 laptop a.ts - api [SSH: box] - Visual Studio Code",
    "0x04800007  1 5678 laptop Mozilla Firefox",
    "0x05000001 -1 99 laptop ",
    "garbage",
  ].join("\n")
  test("parses ids, pids and titles with spaces", () => {
    expect(parseWmctrl(out)).toEqual([
      { id: "0x04600003", pid: 1234, title: "a.ts - api [SSH: box] - Visual Studio Code" },
      { id: "0x04800007", pid: 5678, title: "Mozilla Firefox" },
      { id: "0x05000001", pid: 99, title: "" },
    ])
  })
  test("demand-attention arguments never activate the window", () => {
    expect(wmctrlAttentionArgs("0x1")).toEqual(["-i", "-r", "0x1", "-b", "add,demand_attention"])
  })
})

describe("request gating and normalizing", () => {
  const notice = { kind: "completed", title: "OpenCode", body: "Done" }
  test("auto + unfocused → request", () => {
    expect(attentionFor(notice, { os: "auto", focused: false })).toEqual(notice)
  })
  test("focused → nothing; off → nothing", () => {
    expect(attentionFor(notice, { os: "auto", focused: true })).toBeUndefined()
    expect(attentionFor(notice, { os: "off", focused: false })).toBeUndefined()
  })
  test("normalizeRequest tolerates anything", () => {
    expect(normalizeRequest(undefined)).toEqual({ kind: "completed", title: "OpenCode", body: "" })
    expect(normalizeRequest({ kind: "permission", title: "T", body: "B", extra: 1 })).toEqual({ kind: "permission", title: "T", body: "B" })
    expect(normalizeRequest("x")).toEqual({ kind: "completed", title: "OpenCode", body: "" })
  })
})
