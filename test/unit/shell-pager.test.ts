import { describe, expect, test } from "bun:test"
import { ShellPager, type ShellPage, type ShellState } from "@occ/core/shell-pager"

/** A fake server shell: bytes grow over time, status flips to exited at a chosen tick. Mirrors the live behaviour. */
function fakeShell(script: { chunks: string[]; exitAt: number; exit?: number; status?: ShellState["status"] }) {
  const enc = new TextEncoder()
  const dec = new TextDecoder()
  let tick = 0
  const bytes = () => enc.encode(script.chunks.slice(0, tick + 1).join(""))
  const calls: Array<{ cursor: number; limit: number }> = []
  return {
    calls,
    advance: () => tick++,
    source: {
      async state(): Promise<ShellState> {
        return tick >= script.exitAt ? { status: script.status ?? "exited", exit: script.exit } : { status: "running" }
      },
      async output({ cursor, limit }: { cursor: number; limit: number }): Promise<ShellPage> {
        calls.push({ cursor, limit })
        const all = bytes()
        const end = Math.min(all.length, cursor + limit)
        return { output: dec.decode(all.slice(cursor, end)), cursor: end, size: all.length, truncated: false }
      },
    },
  }
}

function collect() {
  const log: string[] = []
  const exits: ShellState[] = []
  const gone: string[] = []
  return {
    log,
    exits,
    gone,
    text: () => log.join(""),
    sink: { text: (c: string) => log.push(c), exit: (s: ShellState) => exits.push(s), unavailable: (r: string) => gone.push(r) },
  }
}

describe("ShellPager", () => {
  test("collects output across polls by cursor and reports the exit code once", async () => {
    const shell = fakeShell({ chunks: ["hi\n", "more\n", "done\n"], exitAt: 2, exit: 0 })
    const out = collect()
    const pager = new ShellPager(shell.source, out.sink, { sleep: async () => void shell.advance() })
    await pager.run()
    expect(out.text()).toBe("hi\nmore\ndone\n")
    expect(out.exits).toEqual([{ status: "exited", exit: 0 }])
    // Never re-reads from zero: every poll asks from where the last one ended.
    const cursors = shell.calls.map((c) => c.cursor)
    expect(cursors).toEqual([...cursors].sort((a, b) => a - b))
  })

  test("drains output written between the state check and the read before reporting exit", async () => {
    const shell = fakeShell({ chunks: ["a\n", "late\n"], exitAt: 0, exit: 3 })
    const out = collect()
    await new ShellPager(shell.source, out.sink, { sleep: async () => undefined }).run()
    expect(out.exits).toEqual([{ status: "exited", exit: 3 }])
    expect(out.text()).toBe("a\n")
  })

  test("pages large output with a small page size and loses nothing", async () => {
    const body = Array.from({ length: 500 }, (_, i) => `line ${i}\n`).join("")
    const shell = fakeShell({ chunks: [body], exitAt: 0, exit: 0 })
    const out = collect()
    await new ShellPager(shell.source, out.sink, { pageBytes: 256 }).run()
    expect(out.text()).toBe(body)
    expect(shell.calls.length).toBeGreaterThan(10)
  })

  test("a page that cuts a multi-byte character does not corrupt it", async () => {
    const body = "ééééééééé\n日本語日本語\n"
    for (const pageBytes of [3, 5, 7, 11]) {
      const shell = fakeShell({ chunks: [body], exitAt: 0, exit: 0 })
      const out = collect()
      await new ShellPager(shell.source, out.sink, { pageBytes }).run()
      expect(out.text()).toBe(body)
    }
  })

  test("killed and timeout states end the pager with that status", async () => {
    for (const status of ["killed", "timeout"] as const) {
      const shell = fakeShell({ chunks: ["x"], exitAt: 0, status })
      const out = collect()
      await new ShellPager(shell.source, out.sink).run()
      expect(out.exits).toEqual([{ status, exit: undefined }])
    }
  })

  test("stop() ends polling without reporting an exit", async () => {
    const shell = fakeShell({ chunks: ["x"], exitAt: 99 })
    const out = collect()
    const holder: { pager?: ShellPager } = {}
    holder.pager = new ShellPager(shell.source, out.sink, { sleep: async () => holder.pager?.stop() })
    await holder.pager.run()
    expect(out.exits).toEqual([])
    expect(out.gone).toEqual([])
  })

  test("a shell the server no longer knows becomes `unavailable` with a calm message", async () => {
    const out = collect()
    const source = {
      state: async (): Promise<ShellState> => {
        throw Object.assign(new Error("Shell command not found: sh_x"), { name: "ShellNotFoundError" })
      },
      output: async (): Promise<ShellPage> => ({ output: "", cursor: 0, size: 0 }),
    }
    await new ShellPager(source, out.sink).run()
    expect(out.gone).toEqual(["The command is no longer available on the server."])
    expect(out.exits).toEqual([])
  })

  test("other errors are reported with their message and stop the pager", async () => {
    const out = collect()
    const source = {
      state: async (): Promise<ShellState> => ({ status: "running" }),
      output: async (): Promise<ShellPage> => {
        throw new Error("boom")
      },
    }
    await new ShellPager(source, out.sink).run()
    expect(out.gone[0]).toContain("boom")
  })

  test("a server without byte cursors (older versions) still streams: only new characters are emitted", async () => {
    let n = 0
    const outputs = ["one\n", "one\ntwo\n", "one\ntwo\nthree\n"]
    const out = collect()
    const source = {
      state: async (): Promise<ShellState> => (n >= 2 ? { status: "exited", exit: 0 } : { status: "running" }),
      output: async (): Promise<ShellPage> => ({ output: outputs[Math.min(n, 2)]! }) as unknown as ShellPage,
    }
    await new ShellPager(source, out.sink, { sleep: async () => void n++ }).run()
    expect(out.text()).toBe("one\ntwo\nthree\n")
    expect(out.exits).toEqual([{ status: "exited", exit: 0 }])
  })

  test("reattaching from a cursor continues without repeating earlier output", async () => {
    const shell = fakeShell({ chunks: ["first\nsecond\n"], exitAt: 0, exit: 0 })
    const out = collect()
    await new ShellPager(shell.source, out.sink, {}, 6).run()
    expect(out.text()).toBe("second\n")
  })
})
