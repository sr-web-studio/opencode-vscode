import { describe, expect, test } from "bun:test"
import { DictationSession, type Recorder, type SessionUpdate, type Socket } from "../../src/companion/session"

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
  /** Deliver one frame to the pending read. */
  frame(samples = [1, 2]) { this.waiting.shift()?.(new Int16Array(samples)) }
}

class FakeSocket implements Socket {
  binaryType = ""
  readyState = 0
  sent: Array<string | Uint8Array> = []
  closed = false
  onopen: Socket["onopen"] = null
  onmessage: Socket["onmessage"] = null
  onerror: Socket["onerror"] = null
  onclose: Socket["onclose"] = null
  constructor(readonly url: string, readonly protocols: string[]) {}
  send(d: string | Uint8Array) { this.sent.push(d) }
  close() { this.closed = true }
  open() { this.readyState = 1; this.onopen?.({}) }
  answer(m: unknown) { this.onmessage?.({ data: JSON.stringify(m) }) }
}

function setup(extra: Partial<ConstructorParameters<typeof DictationSession>[0]> = {}) {
  const rec = new FakeRecorder()
  let sock!: FakeSocket
  const updates: SessionUpdate[] = []
  const s = new DictationSession({
    key: "snx_temp_x",
    model: "stt-rt-v6",
    languages: ["bn", "en"],
    recorder: () => rec,
    socket: (url, protocols) => (sock = new FakeSocket(url, protocols)),
    emit: (u) => updates.push(u),
    drainMs: 30,
    ...extra,
  })
  s.start()
  return { s, rec, sock, updates }
}

describe("DictationSession", () => {
  test("frames recorded before the socket opens are sent after the start message", async () => {
    const { rec, sock, updates } = setup()
    expect(sock.protocols).toEqual(["soniox-api-key", "snx_temp_x"])
    expect(updates[0]).toEqual({ kind: "listening", device: "Fake mic" })
    rec.frame([1])
    await wait()
    expect(sock.sent).toEqual([])
    sock.open()
    expect(JSON.parse(sock.sent[0] as string)).toMatchObject({ model: "stt-rt-v6", language_hints: ["bn", "en"] })
    expect([...(sock.sent[1] as Uint8Array)]).toEqual([1, 0])
    rec.frame([2])
    await wait()
    expect([...(sock.sent[2] as Uint8Array)]).toEqual([2, 0])
  })

  test("heard text is emitted; stop ends the stream and waits for finished", async () => {
    const { s, rec, sock, updates } = setup()
    sock.open()
    sock.answer({ tokens: [{ text: "hello", is_final: true }, { text: " wor", is_final: false }] })
    expect(updates.at(-1)).toEqual({ kind: "heard", final: "hello", partial: " wor" })
    s.stop()
    expect(rec.stopped).toBe(true)
    expect(sock.sent.at(-1)).toBe("")
    sock.answer({ tokens: [{ text: " world", is_final: true }] })
    sock.answer({ tokens: [], finished: true })
    expect(updates.at(-1)).toMatchObject({ kind: "done", final: "hello world", error: undefined })
    expect(sock.closed).toBe(true)
    expect(updates.filter((u) => u.kind === "done")).toHaveLength(1)
    await wait(60)
    expect(rec.released).toBe(true)
  })

  test("when Soniox never finishes, the last guess counts after the drain time", async () => {
    const { s, sock, updates } = setup()
    sock.open()
    sock.answer({ tokens: [{ text: "hi", is_final: false }] })
    s.stop()
    await wait(60)
    expect(updates.at(-1)).toMatchObject({ kind: "done", final: "hi", error: undefined })
  })

  test("stopping before the socket opens still ends the stream once it opens", () => {
    const { s, sock } = setup()
    s.stop()
    sock.open()
    expect(sock.sent.at(-1)).toBe("")
  })

  test("a Soniox error ends the session with a readable reason", () => {
    const { sock, updates } = setup()
    sock.open()
    sock.answer({ tokens: [], error_code: 402, error_type: "organization_balance_exhausted", error_message: "x" })
    const done = updates.at(-1)
    expect(done?.kind).toBe("done")
    expect(done && "error" in done && done.error).toContain("balance")
  })

  test("an unexpected close is an error; a microphone failure too", () => {
    const a = setup()
    a.sock.open()
    a.sock.onclose?.({ code: 1011 })
    expect(a.updates.at(-1)).toMatchObject({ kind: "done", error: expect.stringContaining("1011") })

    const updates: SessionUpdate[] = []
    new DictationSession({
      key: "k", model: "m", languages: [],
      recorder: () => { throw new Error("no device") },
      socket: () => { throw new Error("unused") },
      emit: (u) => updates.push(u),
    }).start()
    expect(updates).toHaveLength(1)
    expect(updates[0]).toMatchObject({ kind: "done", final: "", error: "Could not open the microphone: no device" })
  })

  test("stops by itself when nothing is heard for idleMs", async () => {
    let t = 0
    const { rec, sock, updates } = setup({ idleMs: 1000, now: () => t })
    sock.open()
    t = 2000
    rec.frame()
    await wait()
    expect(rec.stopped).toBe(true)
    expect(sock.sent.at(-1)).toBe("")
    sock.answer({ tokens: [], finished: true })
    expect(updates.at(-1)).toMatchObject({ kind: "done" })
  })

  test("a microphone that sends only zeros is reported within 2 s, with the Windows privacy hint", async () => {
    const { rec, sock, updates } = setup()
    sock.open()
    for (let i = 0; i < 20; i++) { rec.frame([0, 0, 1]); await wait(1) }
    const done = updates.at(-1)
    expect(done).toMatchObject({ kind: "done", final: "" })
    expect(done && "error" in done && done.error).toContain("Let desktop apps access your microphone")
    expect(sock.closed).toBe(true)
  })

  test("real audio but no words: a clear reason instead of an empty, silent end", async () => {
    let t = 0
    const { s, rec, sock, updates } = setup({ now: () => t })
    sock.open()
    for (let i = 0; i < 25; i++) { rec.frame([900, -700]); await wait(1) }
    sock.answer({ tokens: [] })
    t = 3000
    s.stop()
    sock.answer({ tokens: [], finished: true })
    const done = updates.at(-1)
    expect(done).toMatchObject({ kind: "done", final: "", stats: { frames: 25, peak: 900, answers: 2 } })
    expect(done && "error" in done && done.error).toContain("No words were heard")
  })
})
