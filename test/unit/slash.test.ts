import { describe, expect, test } from "bun:test"
import { CommandCatalog } from "../../src/core/commands"
import {
  applySuggestion,
  commandBlock,
  isEmptySession,
  parseSlash,
  rankByQuery,
  skillsFilter,
  slashQuery,
  suggestCommands,
  suggestSkills,
  undoTarget,
} from "../../src/core/slash"
import { applyEvent, viewFromMessages } from "../../src/core/transcript/reducer"

describe("parseSlash", () => {
  test("name and arguments", () => {
    expect(parseSlash("/review")).toEqual({ name: "review", args: "" })
    expect(parseSlash("  /review main..HEAD  ")).toEqual({ name: "review", args: "main..HEAD" })
    expect(parseSlash("/goal ship it\nand test it")).toEqual({ name: "goal", args: "ship it\nand test it" })
    expect(parseSlash("/fal:generate-image a cat")).toEqual({ name: "fal:generate-image", args: "a cat" })
  })
  test("anything else is a normal prompt", () => {
    expect(parseSlash("hello /review")).toBeUndefined()
    expect(parseSlash("/")).toBeUndefined()
    expect(parseSlash("/ review")).toBeUndefined()
    expect(parseSlash("")).toBeUndefined()
  })
})

describe("slashQuery: the popup shows only while the caret is in the first word", () => {
  test("caret inside or at the end of the first word", () => {
    expect(slashQuery("/", 1)).toEqual({ query: "" })
    expect(slashQuery("/rev", 4)).toEqual({ query: "rev" })
    expect(slashQuery("/rev", 2)).toEqual({ query: "r" })
    expect(slashQuery("/rev args", 4)).toEqual({ query: "rev" })
  })
  test("not after the first word, not at the start, not without a slash", () => {
    expect(slashQuery("/rev args", 5)).toBeUndefined()
    expect(slashQuery("/rev args", 9)).toBeUndefined()
    expect(slashQuery("/rev", 0)).toBeUndefined()
    expect(slashQuery("hi /rev", 7)).toBeUndefined()
    expect(slashQuery(" /rev", 5)).toBeUndefined()
    expect(slashQuery("", 0)).toBeUndefined()
  })
})

describe("skillsFilter", () => {
  test("only after `/skills` and a space", () => {
    expect(skillsFilter("/skills ")).toBe("")
    expect(skillsFilter("/skills  fal ")).toBe("fal")
    expect(skillsFilter("/skills")).toBeUndefined()
    expect(skillsFilter("/skillset x")).toBeUndefined()
    expect(skillsFilter("/review x")).toBeUndefined()
  })
})

describe("ranking", () => {
  const names = ["init", "review", "fal:generate-image", "preview"]
  test("exact, then prefix, then substring; stable within a rank", () => {
    expect(rankByQuery(names, "rev", (n) => [n])).toEqual(["review", "preview"])
    expect(rankByQuery(names, "view", (n) => [n])).toEqual(["review", "preview"])
    expect(rankByQuery(["review", "reviewer", "re"], "re", (n) => [n])).toEqual(["re", "review", "reviewer"])
    expect(rankByQuery(names, "", (n) => [n])).toEqual(names)
    expect(rankByQuery(names, "zzz", (n) => [n])).toEqual([])
  })
  test("is case-insensitive and matches colons", () => {
    expect(rankByQuery(names, "FAL:", (n) => [n])).toEqual(["fal:generate-image"])
  })
})

describe("suggestCommands", () => {
  const server = [
    { name: "init", description: "guided AGENTS.md setup" },
    { name: "compact", description: "server's own" },
    { name: "skills", description: "server's own" },
    { name: "review" },
  ]
  test("client commands come first and win over a server command of the same name", () => {
    const all = suggestCommands("", server)
    expect(all.map((s) => s.name)).toEqual(["mcps", "compact", "undo", "redo", "fork", "skills", "init", "review"])
    expect(all.find((s) => s.name === "compact")).toMatchObject({ source: "client" })
    expect(all.filter((s) => s.name === "compact")).toHaveLength(1)
  })
  test("filters by prefix, then substring", () => {
    expect(suggestCommands("re", server).map((s) => s.name)).toEqual(["redo", "review"])
    expect(suggestCommands("nit", server).map((s) => s.name)).toEqual(["init"])
  })
  test("works with no server commands", () => {
    expect(suggestCommands("u", []).map((s) => s.name)).toEqual(["undo"])
  })
})

describe("suggestSkills", () => {
  const skills = [{ id: "browser", name: "Browser" }, { id: "fal", name: "fal media", description: "x" }]
  test("matches name or id", () => {
    expect(suggestSkills("br", skills).map((s) => s.id)).toEqual(["browser"])
    expect(suggestSkills("media", skills).map((s) => s.id)).toEqual(["fal"])
    expect(suggestSkills("", skills)).toHaveLength(2)
    expect(suggestSkills("", skills)[0]).toMatchObject({ source: "skill", id: "browser", name: "Browser" })
  })
})

describe("applySuggestion", () => {
  test("replaces the first word and keeps the text after it", () => {
    expect(applySuggestion("/re", "review")).toEqual({ text: "/review ", caret: 8 })
    expect(applySuggestion("/re main", "review")).toEqual({ text: "/review main", caret: 8 })
    expect(applySuggestion("/", "init")).toEqual({ text: "/init ", caret: 6 })
  })
})

const msgs = (): any[] => [
  { id: "u1", type: "user", text: "one", time: { created: 1 } },
  { id: "i1", type: "idle", outcome: "succeeded", time: { created: 2 } },
  { id: "u2", type: "user", text: "two", time: { created: 3 } },
  { id: "i2", type: "idle", outcome: "succeeded", time: { created: 4 } },
  { id: "u3", type: "user", text: "three", time: { created: 5 } },
  { id: "i3", type: "idle", outcome: "succeeded", time: { created: 6 } },
]
const staged = (v: ReturnType<typeof viewFromMessages>, messageID: string) =>
  applyEvent(v, { id: "e", type: "session.revert.staged", created: 7, data: { revert: { messageID } } })

describe("undoTarget", () => {
  test("the newest user turn", () => {
    expect(undoTarget(viewFromMessages(msgs()))).toBe("u3")
  })
  test("with a revert staged, one turn further back", () => {
    expect(undoTarget(staged(viewFromMessages(msgs()), "u3"))).toBe("u2")
    expect(undoTarget(staged(staged(viewFromMessages(msgs()), "u3"), "u2"))).toBe("u1")
  })
  test("nothing left to undo", () => {
    expect(undoTarget(staged(viewFromMessages(msgs()), "u1"))).toBeUndefined()
    expect(undoTarget(viewFromMessages([]))).toBeUndefined()
  })
})

describe("commandBlock", () => {
  const ok = { hasSession: true, running: false, revertStaged: false, canRevert: true, undoTarget: "u1" }
  test("a draft has nothing to compact or fork", () => {
    expect(commandBlock("compact", { ...ok, hasSession: false })).toMatch(/Nothing to compact/)
    expect(commandBlock("fork", { ...ok, hasSession: false })).toBe("Nothing to fork yet.")
    expect(commandBlock("compact", ok)).toBeUndefined()
    expect(commandBlock("fork", ok)).toBeUndefined()
  })
  test("undo respects the server feature, an empty history and the stop-first rule", () => {
    expect(commandBlock("undo", ok)).toBeUndefined()
    expect(commandBlock("undo", { ...ok, canRevert: false })).toMatch(/2\.2/)
    expect(commandBlock("undo", { ...ok, undoTarget: undefined })).toBe("Nothing to undo yet.")
    expect(commandBlock("undo", { ...ok, running: true })).toBe("Stop the session first, then undo.")
  })
  test("redo only with a staged revert", () => {
    expect(commandBlock("redo", ok)).toMatch(/Nothing to redo/)
    expect(commandBlock("redo", { ...ok, revertStaged: true })).toBeUndefined()
  })
  test("mcps and skills always run", () => {
    expect(commandBlock("mcps", { ...ok, hasSession: false })).toBeUndefined()
    expect(commandBlock("skills", { ...ok, hasSession: false })).toBeUndefined()
  })
})

test("isEmptySession reads the server's error kind", () => {
  expect(isEmptySession({ _tag: "InvalidRequestError", kind: "empty_session", message: "x" })).toBe(true)
  expect(isEmptySession({ _tag: "InvalidRequestError", kind: "other" })).toBe(false)
  expect(isEmptySession(new Error("x"))).toBe(false)
  expect(isEmptySession(undefined)).toBe(false)
})

describe("CommandCatalog", () => {
  const fake = () => {
    const calls = { command: 0, skill: 0 }
    const client: any = {
      command: { list: async () => (calls.command++, { data: [{ name: "init", description: "d" }, { name: "review" }] }) },
      skill: { list: async () => (calls.skill++, { data: [{ id: "browser", name: "Browser", description: "d", path: "/p", content: "BIG TEXT" }] }) },
    }
    return { client, calls }
  }
  test("caches for a short time and reloads after invalidation", async () => {
    let now = 1000
    const c = new CommandCatalog(() => now)
    const { client, calls } = fake()
    expect(await c.loadCommands(client, "/d")).toBe(true)
    expect(await c.loadCommands(client, "/d")).toBe(false)
    now += 20_000
    expect(await c.loadCommands(client, "/d")).toBe(true)
    c.invalidateCommands()
    expect(await c.loadCommands(client, "/d")).toBe(true)
    expect(calls.command).toBe(3)
    expect(c.has("init")).toBe(true)
    expect(c.has("nope")).toBe(false)
  })
  test("skills keep only what the popup shows (not the skill text)", async () => {
    const c = new CommandCatalog()
    const { client } = fake()
    await c.loadSkills(client, "/d")
    expect(c.skills).toEqual([{ id: "browser", name: "Browser", description: "d" }])
  })
  test("a server without the endpoint keeps the list empty and logs", async () => {
    const c = new CommandCatalog()
    const lines: string[] = []
    const client: any = { command: { list: async () => { throw new Error("404 not found") } } }
    expect(await c.loadCommands(client, "/d", (l) => lines.push(l))).toBe(false)
    expect(c.commands).toEqual([])
    expect(lines[0]).toMatch(/command.list failed/)
  })
})
