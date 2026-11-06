import { describe, expect, test } from "bun:test"
import { LocalDictationSession, type LocalEngine, type LocalSessionOptions, type LocalStream } from "../../src/companion/local-session"
import type { Recorder, SessionUpdate } from "../../src/companion/shared"

const wait = (ms = 5) => new Promise((r) => setTimeout(r, ms))

class FakeRecorder implements Recorder {
  sampleRate = 16000
  started = false
  stopped = false
  released = false
  private waiting: Array<(f: Int16Array) => void> = []
  start() { this.started = true }
  stop() { this.stopped = true }
  release() { this.released = true }
  getSelectedDevice() { return "Fake mic" }
  read(): Promise<Int16Array> { return new Promise((r) => this.waiting.push(r)) }
  frame(samples: number[] | Int16Array = [1000, -1000]) { this.waiting.shift()?.(samples instanceof Int16Array ? samples : new Int16Array(samples)) }
}

/**
 * A scripted recognizer: each accepted frame appends the next word of `words` to the segment text; a word "|" is an
 * endpoint. `offline` returns "<n words>!" so tests can tell streaming text from the re-decoded one.
 */
class FakeStream implements LocalStream {
  text_ = ""
  accepted = 0
  accepts: number[] = []
  finished = false
  resets = 0
  words: string[]
  atEndpoint = false
  constructor(words: string[]) { this.words = [...words] }
  accept(s: Float32Array) {
    this.accepts.push(s.length)
    this.accepted += s.length
    if (s.every((v) => v === 0)) return // silence adds nothing
    const w = this.words.shift()
    if (w === "|") this.atEndpoint = true
    else if (w) this.text_ = this.text_ ? `${this.text_} ${w}` : w
  }
  inputFinished() { this.finished = true }
  decodeReady() {}
  text() { return this.text_ }
  endpoint() { return this.atEndpoint }
  reset() { this.text_ = ""; this.atEndpoint = false; this.resets++ }
}

function setup(words: string[], extra: Partial<LocalSessionOptions> = {}, engineExtra: Partial<LocalEngine> = {}) {
  const rec = new FakeRecorder()
  const stream = new FakeStream(words)
  const updates: SessionUpdate[] = []
  const logs: string[] = []
  const offlineInputs: number[] = []
  let loadNow!: (e: LocalEngine) => void
  let loadFail!: (e: unknown) => void
  const engine: LocalEngine = {
    stream,
    offline: (a) => { offlineInputs.push(a.length); return `${stream.text_.split(" ").length} words!` },
    ...engineExtra,
  }
  const s = new LocalDictationSession({
    recorder: () => rec,
    load: () => new Promise((res, rej) => { loadNow = res; loadFail = rej }),
    emit: (u) => updates.push(u),
    log: (l) => logs.push(l),
    ...extra,
  })
  s.start()
  return { s, rec, stream, updates, logs, offlineInputs, loadNow: () => loadNow(engine), loadFail: (e: unknown) => loadFail(e) }
}

const dones = (u: SessionUpdate[]) => u.filter((x) => x.kind === "done")

describe("LocalDictationSession", () => {
  test("frames recorded while the models load are kept and fed after; `listening` comes only after loading", async () => {
    const { rec, stream, updates, loadNow } = setup(["a", "b"])
    expect(updates).toEqual([])
    rec.frame([500, 500]); await wait()
    rec.frame([500, 500]); await wait()
    expect(stream.accepted).toBe(0)
    loadNow(); await wait()
    expect(updates[0]).toEqual({ kind: "listening", device: "Fake mic" })
    expect(stream.accepts).toEqual([2, 2])
    expect(updates.at(-1)).toEqual({ kind: "heard", final: "", partial: "a b" })
  })

  test("partials stream live; a pause re-decodes the segment offline and appends it to the final text", async () => {
    const { rec, stream, updates, offlineInputs, logs, loadNow } = setup(["এক", "দুই", "|", "তিন"])
    loadNow(); await wait()
    for (let i = 0; i < 4; i++) { rec.frame([800, 800, 800]); await wait() }
    const heard = updates.filter((u) => u.kind === "heard")
    expect(heard.map((u) => u.kind === "heard" && `${u.final}|${u.partial}`)).toEqual(["|এক", "|এক দুই", "2 words!|", "2 words!| তিন"].map((x, i) => (i === 2 ? "2 words!|" : x)))
    expect(offlineInputs).toEqual([9]) // the audio of three frames, kept for the re-decode
    expect(stream.resets).toBe(1)
    expect(logs.join("\n")).toContain("streaming: এক দুই")
    expect(logs.join("\n")).toContain("offline:   2 words!")
  })

  test("stop flushes: silence is fed, the stream is finished, the last segment is re-decoded, exactly one done", async () => {
    const { s, rec, stream, updates, offlineInputs, loadNow } = setup(["আমি", "যাই"], { tailSeconds: 0.5 })
    loadNow(); await wait()
    rec.frame([800, 800]); await wait()
    rec.frame([800, 800]); await wait()
    s.stop(); s.stop()
    expect(rec.stopped).toBe(true)
    expect(stream.accepts.at(-1)).toBe(8000)
    expect(stream.finished).toBe(true)
    expect(offlineInputs).toEqual([4]) // the recorded audio only, not the flush silence
    expect(dones(updates)).toHaveLength(1)
    expect(updates.at(-1)).toMatchObject({ kind: "done", final: "2 words!", error: undefined, stats: { frames: 2, answers: 1 } })
    await wait(60)
    expect(rec.released).toBe(true)
    rec.frame(); s.abort()
    expect(dones(updates)).toHaveLength(1)
  })

  test("stop while the models still load: flushed right after loading, first words not lost", async () => {
    const { s, rec, updates, loadNow } = setup(["hi"])
    rec.frame([900]); await wait()
    s.stop()
    expect(rec.stopped).toBe(true)
    expect(dones(updates)).toHaveLength(0)
    loadNow(); await wait()
    expect(updates.map((u) => u.kind)).toEqual(["listening", "heard", "heard", "done"])
    expect(updates.at(-1)).toMatchObject({ final: "1 words!" })
  })

  test("the offline model failing falls back to the streaming text", async () => {
    const { s, rec, updates, logs, loadNow } = setup(["ক", "খ"], {}, { offline: () => { throw new Error("boom") } })
    loadNow(); await wait()
    rec.frame([700]); await wait(); rec.frame([700]); await wait()
    s.stop()
    expect(updates.at(-1)).toMatchObject({ kind: "done", final: "ক খ", error: undefined })
    expect(logs.join("\n")).toContain("FAILED (boom)")
  })

  test("an empty offline result falls back to the streaming text too", async () => {
    const { s, rec, updates, loadNow } = setup(["ক"], {}, { offline: () => "  " })
    loadNow(); await wait(); rec.frame([700]); await wait()
    s.stop()
    expect(updates.at(-1)).toMatchObject({ final: "ক" })
  })

  test("a segment without words (noise) adds nothing", async () => {
    const { s, rec, updates, loadNow } = setup(["|"])
    loadNow(); await wait()
    rec.frame([700]); await wait()
    s.stop()
    expect(updates.at(-1)).toMatchObject({ kind: "done", final: "" })
    expect(updates.filter((u) => u.kind === "heard")).toHaveLength(0)
  })

  test("a failed load ends with one done, an error and the Show Log fix; the microphone is released", async () => {
    const { updates, rec, loadFail } = setup([])
    loadFail(new Error("the speech engine could not be loaded (dlopen failed)"))
    await wait(60)
    expect(dones(updates)).toHaveLength(1)
    expect(updates[0]).toMatchObject({ kind: "done", final: "", fix: "showLog", error: expect.stringContaining("dlopen failed") })
    expect(rec.stopped).toBe(true)
    expect(rec.released).toBe(true)
  })

  test("a recognizer exception ends with one done and the Show Log fix", async () => {
    const { rec, updates, loadNow } = setup([], {}, { stream: { ...new FakeStream([]), accept() { throw new Error("onnx failure") } } as unknown as LocalStream })
    loadNow(); await wait()
    rec.frame([700]); await wait()
    expect(dones(updates)).toHaveLength(1)
    expect(updates.at(-1)).toMatchObject({ kind: "done", fix: "showLog", error: expect.stringContaining("onnx failure") })
  })

  test("a microphone that cannot open: one done, no loading", () => {
    const updates: SessionUpdate[] = []
    let loaded = false
    new LocalDictationSession({ recorder: () => { throw new Error("no device") }, load: async () => { loaded = true; return {} as LocalEngine }, emit: (u) => updates.push(u) }).start()
    expect(updates).toEqual([{ kind: "done", final: "", error: "Could not open the microphone: no device", stats: { frames: 0, peak: 0, answers: 0, device: undefined } }])
    expect(loaded).toBe(false)
  })

  test("a microphone that sends only zeros is reported within 2 s", async () => {
    const { rec, updates, loadNow } = setup([])
    loadNow(); await wait()
    for (let i = 0; i < 20; i++) { rec.frame([0, 0, 1]); await wait(1) }
    expect(dones(updates)).toHaveLength(1)
    expect(updates.at(-1)).toMatchObject({ kind: "done", final: "", error: expect.stringContaining("not muted") })
    expect(rec.released || rec.stopped).toBe(true)
  })

  test("stops by itself when nothing is heard for idleMs; time spent loading does not count", async () => {
    let t = 0
    const { rec, updates, stream, loadNow } = setup(["x"], { idleMs: 1000, now: () => t })
    t = 5000 // the load took long
    loadNow(); await wait()
    rec.frame([700]); await wait() // hears "x": lastHeard = 5000
    t = 5500
    rec.frame([700]); await wait()
    expect(rec.stopped).toBe(false)
    t = 6500
    rec.frame([700]); await wait()
    expect(rec.stopped).toBe(true)
    expect(stream.finished).toBe(true)
    expect(dones(updates)).toHaveLength(1)
    expect(updates.at(-1)).toMatchObject({ final: "1 words!" })
  })

  test("the hard cap stops a long recording", async () => {
    let t = 0
    const { rec, updates, loadNow } = setup(["a"], { maxMs: 10_000, idleMs: 10 ** 9, now: () => t })
    loadNow(); await wait()
    t = 11_000
    rec.frame([700]); await wait()
    expect(rec.stopped).toBe(true)
    expect(dones(updates)).toHaveLength(1)
  })

  test("audio without any words explains itself instead of ending quietly", async () => {
    let t = 0
    const { s, rec, updates, loadNow } = setup([], { now: () => t })
    loadNow(); await wait()
    for (let i = 0; i < 25; i++) { rec.frame([900, -700]); await wait(1) }
    t = 3000
    s.stop()
    expect(updates.at(-1)).toMatchObject({ kind: "done", final: "", error: expect.stringContaining("No words were heard"), stats: { frames: 25, peak: 900 } })
  })

  test("abort ends once and later events change nothing", async () => {
    const { s, rec, updates, loadNow } = setup(["a"])
    loadNow(); await wait()
    s.abort()
    rec.frame([700]); await wait()
    s.stop()
    expect(dones(updates)).toHaveLength(1)
  })
})
