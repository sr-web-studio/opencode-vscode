import { describe, expect, test } from "bun:test"
import { EventEmitter } from "node:events"
import { PassThrough } from "node:stream"
import { WindowsHelper, askForAttention, type SpawnFn } from "../../src/companion/attention"
import { identityOf } from "../../src/core/attention"
import { WINDOWS_HELPER_SCRIPT, helperArgs } from "../../src/companion/windows-script"

/** A stand-in for the PowerShell process: answers `reply(request)` per stdin line once it printed `ready`. */
function fakePowerShell(reply: (req: any) => unknown | undefined, opts: { ready?: boolean } = {}) {
  const spawned: Array<{ command: string; args: string[]; kill: () => void }> = []
  const spawn: SpawnFn = (command, args) => {
    const stdin = new PassThrough()
    const stdout = new PassThrough()
    const stderr = new PassThrough()
    const child: any = new EventEmitter()
    child.stdin = stdin
    child.stdout = stdout
    child.stderr = stderr
    child.exitCode = null
    child.kill = () => {
      if (child.exitCode !== null) return true
      child.exitCode = 1
      child.emit("exit", 1, null)
      return true
    }
    spawned.push({ command, args, kill: child.kill })
    let buf = ""
    stdin.on("data", (d) => {
      buf += d.toString()
      let i
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i)
        buf = buf.slice(i + 1)
        const out = reply(JSON.parse(line))
        if (out !== undefined) stdout.write(JSON.stringify(out) + "\n")
      }
    })
    if (opts.ready !== false) queueMicrotask(() => stdout.write("banner noise\n" + '{"ready":true}\n'))
    return child
  }
  return { spawn, spawned }
}

const who = identityOf({ workspaceName: "api", appName: "Visual Studio Code" })

describe("WindowsHelper", () => {
  test("starts lazily, once, and answers by id", async () => {
    const fake = fakePowerShell((r) => ({ id: r.id, ok: true, echo: r.op }))
    const h = new WindowsHelper({ spawn: fake.spawn })
    expect(fake.spawned.length).toBe(0)
    const [a, b] = await Promise.all([h.call({ op: "windows", pid: 1 }), h.call({ op: "flash", hwnds: [] })])
    expect(fake.spawned.length).toBe(1)
    expect(fake.spawned[0]!.command).toBe("powershell.exe")
    expect(fake.spawned[0]!.args).toContain("-NonInteractive")
    expect(fake.spawned[0]!.args).toContain("-NoProfile")
    expect((a as any).echo).toBe("windows")
    expect((b as any).echo).toBe("flash")
    h.dispose()
  })

  test("restarts after the process died", async () => {
    const fake = fakePowerShell((r) => ({ id: r.id, ok: true }))
    const h = new WindowsHelper({ spawn: fake.spawn })
    await h.call({ op: "windows", pid: 1 })
    fake.spawned[0]!.kill()
    expect(h.running).toBe(false)
    await h.call({ op: "windows", pid: 1 })
    expect(fake.spawned.length).toBe(2)
    h.dispose()
  })

  test("a request in flight fails when the process dies", async () => {
    const fake = fakePowerShell(() => undefined)
    const h = new WindowsHelper({ spawn: fake.spawn })
    const p = h.call({ op: "windows", pid: 1 })
    await new Promise((r) => setTimeout(r, 10))
    fake.spawned[0]!.kill()
    await expect(p).rejects.toThrow(/stopped/)
  })

  test("a helper that never becomes ready times out and is replaced", async () => {
    const fake = fakePowerShell(() => undefined, { ready: false })
    const h = new WindowsHelper({ spawn: fake.spawn, startMs: 30 })
    await expect(h.call({ op: "windows", pid: 1 })).rejects.toThrow(/ready/)
    expect(h.running).toBe(false)
  })

  test("a stuck request times out", async () => {
    const fake = fakePowerShell(() => undefined)
    const h = new WindowsHelper({ spawn: fake.spawn, requestMs: 30 })
    await expect(h.call({ op: "windows", pid: 1 })).rejects.toThrow(/did not answer/)
    expect(h.running).toBe(false)
  })

  test("stops after the idle time", async () => {
    const fake = fakePowerShell((r) => ({ id: r.id, ok: true }))
    const h = new WindowsHelper({ spawn: fake.spawn, idleMs: 20 })
    await h.call({ op: "windows", pid: 1 })
    expect(h.running).toBe(true)
    await new Promise((r) => setTimeout(r, 60))
    expect(h.running).toBe(false)
  })

  test("spawn failure rejects, never throws synchronously", async () => {
    const h = new WindowsHelper({
      spawn: () => {
        throw new Error("ENOENT")
      },
    })
    await expect(h.call({ op: "windows", pid: 1 })).rejects.toThrow(/ENOENT/)
  })
})

describe("askForAttention on Windows", () => {
  const windows = [
    { h: 11, p: 100, t: "a.ts - web - Visual Studio Code" },
    { h: 22, p: 100, t: "b.ts - api [SSH: box] - Visual Studio Code" },
  ]

  test("finds this window and flashes it", async () => {
    const flashes: number[][] = []
    const fake = fakePowerShell((r) => {
      if (r.op === "windows") return { id: r.id, ok: true, pid: 100, windows }
      flashes.push(r.hwnds)
      return { id: r.id, ok: true, flashed: r.hwnds, skipped: [] }
    })
    const h = new WindowsHelper({ spawn: fake.spawn })
    const res = await askForAttention(h, who, { kind: "completed", title: "t", body: "b" }, () => undefined, "win32")
    expect(res.ok).toBe(true)
    expect(res.method).toBe("flash")
    expect(res.chosen).toEqual(["b.ts - api [SSH: box] - Visual Studio Code"])
    expect(flashes).toEqual([[22]])
    h.dispose()
  })

  test("no title match: flashes nothing and reports the candidates", async () => {
    const flashes: number[][] = []
    const fake = fakePowerShell((r) => {
      if (r.op === "windows") return { id: r.id, ok: true, pid: 100, windows }
      flashes.push(r.hwnds)
      return { id: r.id, ok: true, flashed: [], skipped: [] }
    })
    const h = new WindowsHelper({ spawn: fake.spawn })
    const res = await askForAttention(h, identityOf({ workspaceName: "zzz", appName: "Visual Studio Code" }), { kind: "completed", title: "t", body: "b" }, () => undefined, "win32")
    expect(res.ok).toBe(false)
    expect(res.candidates.length).toBe(2)
    expect(flashes).toEqual([])
    h.dispose()
  })

  test("helper failure is a result, not an exception", async () => {
    const h = new WindowsHelper({
      spawn: () => {
        throw new Error("no powershell")
      },
    })
    const res = await askForAttention(h, who, { kind: "completed", title: "t", body: "b" }, () => undefined, "win32")
    expect(res.ok).toBe(false)
    expect(res.problem).toMatch(/no powershell/)
  })

  test("unsupported platform does nothing", async () => {
    const res = await askForAttention(new WindowsHelper(), who, { kind: "completed", title: "t", body: "b" }, () => undefined, "freebsd" as NodeJS.Platform)
    expect(res.ok).toBe(false)
  })
})

describe("PowerShell script", () => {
  test("is ASCII, declares the FLASHWINFO layout and the flags", () => {
    expect(/^[\x09\x0a\x0d\x20-\x7e]*$/.test(WINDOWS_HELPER_SCRIPT)).toBe(true)
    expect(WINDOWS_HELPER_SCRIPT).toContain("public uint cbSize;\n    public IntPtr hwnd;\n    public uint dwFlags;\n    public uint uCount;\n    public uint dwTimeout;")
    expect(WINDOWS_HELPER_SCRIPT).toContain("f.dwFlags = 0x2 | 0xC;")
    expect(WINDOWS_HELPER_SCRIPT).toContain("Chrome_WidgetWin_1")
    expect(WINDOWS_HELPER_SCRIPT).not.toMatch(/SetForegroundWindow|SwitchToThisWindow|SetActiveWindow/)
  })
  test("is passed encoded", () => {
    const args = helperArgs("Write-Output 1")
    expect(args.at(-2)).toBe("-EncodedCommand")
    expect(Buffer.from(args.at(-1)!, "base64").toString("utf16le")).toBe("Write-Output 1")
  })
})
