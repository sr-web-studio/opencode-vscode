/** The microphone probe (`OpenCode Voice: Test Microphone`): pure bookkeeping and the verdict, unit-tested. */

/** Written into every buffer before the native read. Real audio essentially never equals it in all 1600 samples. */
export const SENTINEL = 0x4242

export type DeviceProbe = {
  /** pvrecorder device index; -1 = system default. */
  index: number
  name: string
  selected?: string
  sampleRate?: number
  frames: number
  /** Frames the native read left exactly as filled: the library did not write into the buffer. */
  untouched: number
  /** Frames of exact zeros: the driver delivered digital silence. */
  zero: number
  peak: number
  /** Non-success status codes seen (each once). */
  statuses: number[]
  error?: string
}

export type ProbeReport = { kind: "probe"; runtime: string; devices: DeviceProbe[]; error?: string }

/** Account one native read. `pcm` was filled with `SENTINEL` before the read. */
export function probeFrame(r: DeviceProbe, status: number, pcm: Int16Array): void {
  r.frames++
  if (status !== 0 && !r.statuses.includes(status)) r.statuses.push(status)
  let untouched = true
  let zero = true
  for (let i = 0; i < pcm.length; i++) {
    const v = pcm[i]!
    if (v !== SENTINEL) untouched = false
    if (v !== 0) zero = false
    const a = Math.abs(v)
    if (v !== SENTINEL && a > r.peak) r.peak = a
  }
  if (untouched) r.untouched++
  else if (zero) r.zero++
}

export type Verdict = "works" | "not-written" | "driver-zeros" | "quiet" | "failed"

export function verdict(d: DeviceProbe): Verdict {
  if (d.error || d.frames === 0) return "failed"
  if (d.untouched >= d.frames / 2) return "not-written"
  if (d.zero >= d.frames - 1) return "driver-zeros"
  if (d.peak < 8) return "quiet"
  return "works"
}

const VERDICT_TEXT: Record<Verdict, string> = {
  works: "audio arrives",
  "not-written": "the recorder library never wrote audio into the buffer",
  "driver-zeros": "the driver delivers exact zeros",
  quiet: "almost silent",
  failed: "could not record",
}

/** Multi-line report for the output channel. */
export function probeText(p: ProbeReport): string {
  const lines = [`Microphone test (${p.runtime})${p.error ? `: ${p.error}` : ""}`]
  for (const d of p.devices) {
    const v = verdict(d)
    lines.push(
      `  [${d.index}] ${d.name}${d.selected && d.selected !== d.name ? ` → ${d.selected}` : ""}: ${VERDICT_TEXT[v]}` +
        ` (frames ${d.frames}, untouched ${d.untouched}, zero ${d.zero}, peak ${d.peak}/32767${d.sampleRate ? `, ${d.sampleRate} Hz` : ""}` +
        `${d.statuses.length ? `, status ${d.statuses.join("/")}` : ""}${d.error ? `, error: ${d.error}` : ""})`,
    )
  }
  return lines.join("\n")
}

/** One sentence for the notification. */
export function probeSummary(p: ProbeReport): string {
  if (p.error) return `The microphone test failed: ${p.error}`
  const vs = p.devices.map(verdict)
  const ok = p.devices.filter((_, i) => vs[i] === "works").map((d) => d.name)
  if (vs.some((v) => v === "not-written")) return "The recorder library does not deliver audio inside VS Code on this computer. Please send the “OpenCode Voice” output to the developer."
  if (ok.length) return `Audio arrives from: ${ok.join(", ")}. Speak during the test; if your microphone is not listed, choose one of these.`
  if (vs.every((v) => v === "driver-zeros" || v === "quiet")) return "Every microphone delivers silence. In Windows Sound settings open the microphone's properties and turn off audio enhancements (Voice clarity / device effects), then test again."
  return "No microphone could record. See the “OpenCode Voice” output for details."
}
