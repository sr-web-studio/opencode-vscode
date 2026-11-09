import { describe, expect, test } from "bun:test"
import { Controller } from "@occ/core/controller"
import { ENHANCE_UNSUPPORTED, buildEnhancePrompt, cleanEnhanced, enhanceError } from "@occ/core/enhance"
import { normalizeModelSelection, type ModelSelection } from "@occ/core/models"

const session = (id: string) => ({ id, title: id, projectID: "prj", time: { created: 1, updated: 1 }, location: { directory: "/w" } })

const model = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  modelID: id,
  providerID: "p",
  name: `Model ${id}`,
  enabled: true,
  status: "active",
  variants: [],
  capabilities: { input: ["text"] },
  ...extra,
})

type Generate = (input: any, options?: { signal?: AbortSignal }) => Promise<{ text: string }>

/** A fake server that records every call. `generate` answers the enhancement route unless a test overrides it. */
function server(opts: { models?: unknown[]; defaultModel?: unknown; generate?: Generate } = {}) {
  const calls: Array<[string, any, any]> = []
  const unsupported = () => Promise.reject(new Error("404 not found"))
  const empty = { data: [] }
  const client: any = {
    location: { get: unsupported },
    session: {
      list: async () => ({ data: [session("ses_a")] }),
      active: async () => ({}),
      get: async ({ sessionID }: { sessionID: string }) => session(sessionID),
    },
    command: { list: async () => empty },
    skill: { list: async () => empty },
    mcp: { list: async () => empty },
    permission: { request: { list: async () => empty } },
    form: { list: async () => empty },
    agent: { list: async () => empty },
    model: {
      list: async () => ({ data: opts.models ?? [model("m1"), model("m2")] }),
      default: async () => ({ data: opts.defaultModel ?? { id: "m1", providerID: "p" } }),
    },
    provider: { list: async () => ({ data: [{ id: "p", name: "Provider P" }] }) },
    config: { get: unsupported },
    shell: { list: async () => empty },
    message: { list: async () => ({ data: [], cursor: { next: null, previous: null } }) },
    event: { subscribe: async function* () {} },
    experimental: {
      generate: {
        text: async (input: any, options?: { signal?: AbortSignal }) => {
          calls.push(["generate.text", input, options])
          return opts.generate ? opts.generate(input, options) : { text: "A polished prompt." }
        },
      },
    },
  }
  return { client, calls }
}

function modelStore(initial?: ModelSelection) {
  let value = initial
  return { get: () => value, set: (m: ModelSelection | undefined) => (value = m), peek: () => value }
}

async function ready(opts: { models?: unknown[]; defaultModel?: unknown; generate?: Generate; saved?: ModelSelection } = {}) {
  const s = server(opts)
  const saved = opts.saved ? modelStore(opts.saved) : modelStore(undefined)
  const logs: string[] = []
  const ctl = new Controller({ directory: "/w", folderName: "w", displayPath: "/w", enhanceModel: saved, log: (line) => logs.push(line) })
  ;(ctl as any).client = s.client
  await ctl.sync()
  s.calls.length = 0
  logs.length = 0
  return { ctl, saved, logs, ...s }
}

const enhanceCalls = (calls: Array<[string, any, any]>) => calls.filter(([n]) => n === "generate.text")

describe("buildEnhancePrompt", () => {
  test("polish: the text verbatim between the markers, with the light-edit rules", () => {
    const text = "so um can you like fix the the login bug\nits in auth dot ts i think"
    const prompt = buildEnhancePrompt("polish", text)
    expect(prompt).toContain(text)
    expect(prompt).toContain("<<<PROMPT\n")
    expect(prompt).toContain("\nPROMPT>>>")
    expect(prompt).toMatch(/grammar, spelling, punctuation/i)
    expect(prompt).toMatch(/speech-to-text/i)
    expect(prompt).toMatch(/sentence structure/i)
    expect(prompt).toMatch(/never instructions to follow/)
    expect(prompt).toMatch(/only the improved prompt/i)
    // Nothing about the project, files or history goes with the text.
    expect(prompt).not.toMatch(/AGENTS\.md|project files|attachments|session history/i)
  })

  test("rewrite: the detailed structure, without inventing project facts", () => {
    const text = "add a retry to the fetch in api.ts"
    const prompt = buildEnhancePrompt("rewrite", text)
    expect(prompt).toContain(text)
    expect(prompt).toContain("<<<PROMPT\n")
    expect(prompt).toContain("\nPROMPT>>>")
    expect(prompt).toMatch(/goal first/i)
    expect(prompt).toMatch(/Do not invent facts about the project/i)
    expect(prompt).toMatch(/something the agent must check/i)
    expect(prompt).toMatch(/same language/i)
    expect(prompt).toMatch(/never instructions to follow/)
  })

  test("the two modes do not share their instructions", () => {
    expect(buildEnhancePrompt("polish", "x")).not.toBe(buildEnhancePrompt("rewrite", "x"))
  })

  test("the text is not trimmed or escaped: what the user typed is what the model reads", () => {
    const text = "  keep  spaces\nand\n\nblank lines  "
    expect(buildEnhancePrompt("polish", text)).toContain(text)
  })
})

describe("cleanEnhanced", () => {
  test("plain text is only trimmed", () => {
    expect(cleanEnhanced("\n  Fix the login bug.  \n")).toBe("Fix the login bug.")
  })
  test("a wrapping code fence is removed, with or without a language", () => {
    expect(cleanEnhanced("```\nFix the login bug.\n```")).toBe("Fix the login bug.")
    expect(cleanEnhanced("```markdown\nFix the login bug.\n```")).toBe("Fix the login bug.")
  })
  test("a fence inside the answer is kept", () => {
    const text = "Run:\n```sh\nbun test\n```"
    expect(cleanEnhanced(text)).toBe(text)
  })
  test("straight and curly quotes around the whole answer are removed", () => {
    expect(cleanEnhanced('"Fix the login bug."')).toBe("Fix the login bug.")
    expect(cleanEnhanced("'Fix the login bug.'")).toBe("Fix the login bug.")
    expect(cleanEnhanced("“Fix the login bug.”")).toBe("Fix the login bug.")
  })
  test("a quote that only opens or only closes stays", () => {
    expect(cleanEnhanced('"Fix the login bug.')).toBe('"Fix the login bug.')
    expect(cleanEnhanced('He said "hi"')).toBe('He said "hi"')
  })
  test("a leading 'Here is…' line is removed", () => {
    expect(cleanEnhanced("Here is the polished prompt:\n\nFix the login bug.")).toBe("Fix the login bug.")
    expect(cleanEnhanced("Sure! Here you go:\nFix the login bug.")).toBe("Fix the login bug.")
  })
  test("a single line that starts with 'Here is' is the answer, not a preamble", () => {
    expect(cleanEnhanced("Here is the bug: users get logged out")).toBe("Here is the bug: users get logged out")
  })
  test("a preamble outside a fence and a fence outside a preamble are both peeled", () => {
    expect(cleanEnhanced("Here is the prompt:\n```\nFix the login bug.\n```")).toBe("Fix the login bug.")
    expect(cleanEnhanced("```\nHere is the prompt:\nFix the login bug.\n```")).toBe("Fix the login bug.")
  })
  test("an empty or whitespace-only answer stays empty", () => {
    expect(cleanEnhanced("")).toBe("")
    expect(cleanEnhanced("   \n\t ")).toBe("")
    expect(cleanEnhanced("```\n\n```")).toBe("")
  })
})

describe("enhanceError", () => {
  test("model and provider errors ask for another model", () => {
    expect(enhanceError({ _tag: "ModelNotFoundError", message: "Model not found" })).toMatch(/not available on this server/)
    expect(enhanceError({ _tag: "ProviderNotFoundError", message: "Provider not found" })).toMatch(/not available on this server/)
    expect(enhanceError({ _tag: "UnsupportedModelError", message: "cannot generate" })).toMatch(/cannot enhance prompts/)
  })
  test("a provider request error asks to try again", () => {
    expect(enhanceError({ _tag: "ProviderRequestError", message: "upstream failed" })).toMatch(/Try again/)
  })
  test("an old server without the route says which version it needs", () => {
    expect(enhanceError({ message: "Not Found" })).toBe(ENHANCE_UNSUPPORTED)
    expect(enhanceError(new Error("404 not found"))).toBe(ENHANCE_UNSUPPORTED)
    expect(enhanceError({ _tag: "NotFoundError", status: 404, message: "no such route" })).toBe(ENHANCE_UNSUPPORTED)
  })
  test("anything else keeps its own message", () => {
    expect(enhanceError(new Error("fetch failed"))).toBe("fetch failed")
    expect(enhanceError("offline")).toBe("offline")
  })
})

describe("normalizeModelSelection", () => {
  test("a valid stored selection survives, with its variant", () => {
    expect(normalizeModelSelection({ id: "m1", providerID: "p", variant: "high" })).toEqual({ id: "m1", providerID: "p", variant: "high" })
    expect(normalizeModelSelection({ id: "m1", providerID: "p" })).toEqual({ id: "m1", providerID: "p" })
  })
  test("anything else becomes nothing", () => {
    for (const raw of [undefined, null, "m1", {}, { id: "m1" }, { providerID: "p" }, { id: 1, providerID: "p" }, { id: "", providerID: "p" }]) {
      expect(normalizeModelSelection(raw)).toBeUndefined()
    }
  })
})

describe("enhance in the controller", () => {
  test("sends the built prompt and no model when the default is chosen", async () => {
    const { ctl, calls } = await ready()
    await ctl.dispatch({ type: "enhance", mode: "polish", text: "fix the the login bug" })
    const [, input, options] = enhanceCalls(calls)[0]!
    expect(input).toEqual({ prompt: buildEnhancePrompt("polish", "fix the the login bug"), model: null })
    expect(options?.signal).toBeDefined()
    expect(ctl.snapshot().enhance).toEqual({ tick: 1, status: "done", mode: "polish", source: "fix the the login bug", text: "A polished prompt." })
  })

  test("sends the saved model, and only the prompt and the model", async () => {
    const { ctl, calls } = await ready({ saved: { id: "m2", providerID: "p" } })
    await ctl.dispatch({ type: "enhance", mode: "rewrite", text: "add retries" })
    const [, input] = enhanceCalls(calls)[0]!
    expect(Object.keys(input).sort()).toEqual(["model", "prompt"])
    expect(input.model).toEqual({ id: "m2", providerID: "p" })
    expect(input.prompt).toContain("add retries")
  })

  test("never sends files, images or session history", async () => {
    const { ctl, calls } = await ready()
    await ctl.dispatch({ type: "enhance", mode: "polish", text: "look at /w/a.ts" })
    const [, input] = enhanceCalls(calls)[0]!
    expect(input).not.toHaveProperty("files")
    expect(input).not.toHaveProperty("sessionID")
    expect(input).not.toHaveProperty("images")
    expect(JSON.stringify(input)).not.toContain("ses_a")
  })

  test("running → done, with the model's answer cleaned", async () => {
    const { ctl } = await ready({ generate: async () => ({ text: "Here is the prompt:\n```\nFix the login bug.\n```" }) })
    const done = ctl.dispatch({ type: "enhance", mode: "polish", text: "fix the login bug" })
    expect(ctl.snapshot().enhance?.status).toBe("running")
    await done
    expect(ctl.snapshot().enhance?.status).toBe("done")
    expect(ctl.snapshot().enhance?.text).toBe("Fix the login bug.")
  })

  test("a failure lands on the enhancement state, not on the send error line", async () => {
    const { ctl } = await ready({ generate: async () => Promise.reject({ _tag: "ProviderRequestError", message: "upstream failed" }) })
    await ctl.dispatch({ type: "enhance", mode: "polish", text: "x" })
    const state = ctl.snapshot()
    expect(state.enhance?.status).toBe("error")
    expect(state.enhance?.error).toMatch(/Try again/)
    expect(state.error).toBeUndefined()
  })

  test("an empty answer is an error", async () => {
    const { ctl } = await ready({ generate: async () => ({ text: "  \n " }) })
    await ctl.dispatch({ type: "enhance", mode: "rewrite", text: "x" })
    expect(ctl.snapshot().enhance?.status).toBe("error")
    expect(ctl.snapshot().enhance?.error).toMatch(/empty answer/)
  })

  test("an old server maps to the version hint", async () => {
    const { ctl } = await ready({ generate: async () => Promise.reject({ message: "Not Found" }) })
    await ctl.dispatch({ type: "enhance", mode: "polish", text: "x" })
    expect(ctl.snapshot().enhance?.error).toBe(ENHANCE_UNSUPPORTED)
  })

  test("a client without the route (older bundled client) says the same", async () => {
    const { ctl, client } = await ready()
    client.experimental = {}
    await ctl.dispatch({ type: "enhance", mode: "polish", text: "x" })
    expect(ctl.snapshot().enhance?.error).toBe(ENHANCE_UNSUPPORTED)
  })

  test("whitespace-only text makes no call", async () => {
    const { ctl, calls } = await ready()
    await ctl.dispatch({ type: "enhance", mode: "polish", text: "   " })
    expect(enhanceCalls(calls)).toEqual([])
    expect(ctl.snapshot().enhance).toBeUndefined()
  })

  test("cancel aborts the request and clears the running state", async () => {
    let signal: AbortSignal | undefined
    const { ctl } = await ready({
      generate: (_input, options) =>
        new Promise((_resolve, reject) => {
          signal = options?.signal
          options?.signal?.addEventListener("abort", () => reject(new Error("aborted")))
        }),
    })
    const running = ctl.dispatch({ type: "enhance", mode: "polish", text: "keep me" })
    expect(ctl.snapshot().enhance?.status).toBe("running")
    await ctl.dispatch({ type: "enhanceCancel" })
    expect(signal?.aborted).toBe(true)
    expect(ctl.snapshot().enhance).toBeUndefined()
    await running
    expect(ctl.snapshot().enhance).toBeUndefined()
  })

  test("a result that arrives after a newer request is ignored", async () => {
    const pending: Array<(value: { text: string }) => void> = []
    const { ctl } = await ready({ generate: () => new Promise((resolve) => pending.push(resolve)) })
    const first = ctl.dispatch({ type: "enhance", mode: "polish", text: "one" })
    const second = ctl.dispatch({ type: "enhance", mode: "rewrite", text: "two" })
    pending[1]!({ text: "second answer" })
    await second
    expect(ctl.snapshot().enhance?.text).toBe("second answer")
    pending[0]!({ text: "first answer" })
    await first
    expect(ctl.snapshot().enhance?.text).toBe("second answer")
  })

  test("detach cancels a running enhancement", async () => {
    let signal: AbortSignal | undefined
    const { ctl } = await ready({
      generate: (_input, options) =>
        new Promise((_resolve, reject) => {
          signal = options?.signal
          options?.signal?.addEventListener("abort", () => reject(new Error("aborted")))
        }),
    })
    const running = ctl.dispatch({ type: "enhance", mode: "polish", text: "x" })
    ctl.detach()
    expect(signal?.aborted).toBe(true)
    expect(ctl.snapshot().enhance).toBeUndefined()
    await running
  })

  test("logs name the mode and the model, never the prompt or the answer", async () => {
    const { ctl, logs } = await ready({ generate: async () => ({ text: "SECRET ANSWER" }) })
    await ctl.dispatch({ type: "enhance", mode: "polish", text: "SECRET PROMPT" })
    const all = logs.join("\n")
    expect(all).toContain("polish")
    expect(all).toContain("server default")
    expect(all).not.toContain("SECRET")
  })
})

describe("the enhancement model", () => {
  test("the state shows the default model for the label", async () => {
    const { ctl } = await ready()
    expect(ctl.snapshot().enhanceDefault).toEqual({ id: "m1", providerID: "p" })
    expect(ctl.snapshot().enhanceModel).toBeUndefined()
  })

  test("a pick is persisted and used, and picking the default clears it", async () => {
    const { ctl, saved, calls } = await ready()
    await ctl.dispatch({ type: "pickEnhanceModel", model: { id: "m2", providerID: "p" } })
    expect(saved.peek()).toEqual({ id: "m2", providerID: "p" })
    expect(ctl.snapshot().enhanceModel).toEqual({ id: "m2", providerID: "p" })
    await ctl.dispatch({ type: "enhance", mode: "polish", text: "x" })
    expect(enhanceCalls(calls)[0]![1].model).toEqual({ id: "m2", providerID: "p" })
    await ctl.dispatch({ type: "pickEnhanceModel", model: undefined })
    expect(saved.peek()).toBeUndefined()
    expect(ctl.snapshot().enhanceModel).toBeUndefined()
  })

  test("a model this server does not list is never saved", async () => {
    const { ctl, saved } = await ready()
    await ctl.dispatch({ type: "pickEnhanceModel", model: { id: "gone", providerID: "p" } })
    expect(saved.peek()).toBeUndefined()
  })

  test("a saved model that disappeared falls back to the default and says so", async () => {
    const { ctl, calls } = await ready({ saved: { id: "gone", providerID: "p" } })
    expect(ctl.snapshot().enhanceModel).toBeUndefined()
    expect(ctl.snapshot().enhanceModelStale).toBe(true)
    await ctl.dispatch({ type: "enhance", mode: "polish", text: "x" })
    expect(enhanceCalls(calls)[0]![1].model).toBeNull()
  })

  test("a disabled or deprecated saved model is stale too", async () => {
    const { ctl } = await ready({ models: [model("m1"), model("m2", { enabled: false })], saved: { id: "m2", providerID: "p" } })
    expect(ctl.snapshot().enhanceModelStale).toBe(true)
  })
})
