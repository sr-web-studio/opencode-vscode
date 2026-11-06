import { describe, expect, test } from "bun:test"
import { SENTINEL, probeFrame, probeSummary, probeText, verdict, type DeviceProbe } from "../../src/companion/probe"

const blank = (name = "Mic"): DeviceProbe => ({ index: 0, name, frames: 0, untouched: 0, zero: 0, peak: 0, statuses: [] })
const feed = (d: DeviceProbe, n: number, fill: (pcm: Int16Array) => void) => {
  for (let i = 0; i < n; i++) {
    const pcm = new Int16Array(16).fill(SENTINEL)
    fill(pcm)
    probeFrame(d, 0, pcm)
  }
  return d
}

describe("microphone probe", () => {
  test("a buffer the library never wrote is told apart from driver zeros and real audio", () => {
    expect(verdict(feed(blank(), 10, () => {}))).toBe("not-written")
    expect(verdict(feed(blank(), 10, (p) => p.fill(0)))).toBe("driver-zeros")
    expect(verdict(feed(blank(), 10, (p) => p.fill(3)))).toBe("quiet")
    const ok = feed(blank(), 10, (p) => { p.fill(0); p[3] = -1200 })
    expect(verdict(ok)).toBe("works")
    expect(ok.peak).toBe(1200)
  })
  test("the sentinel itself never counts as signal level", () => {
    expect(feed(blank(), 3, () => {}).peak).toBe(0)
  })
  test("summary names the working microphones, or the likely fix", () => {
    const ok = feed(blank("USB Headset"), 10, (p) => p.fill(500))
    const silent = feed(blank("Microphone Array"), 10, (p) => p.fill(0))
    expect(probeSummary({ kind: "probe", runtime: "x", devices: [silent, ok] })).toContain("USB Headset")
    expect(probeSummary({ kind: "probe", runtime: "x", devices: [silent] })).toContain("audio enhancements")
    expect(probeSummary({ kind: "probe", runtime: "x", devices: [feed(blank(), 10, () => {})] })).toContain("does not deliver audio inside VS Code")
    expect(probeText({ kind: "probe", runtime: "node 24", devices: [silent] })).toContain("[0] Microphone Array: the driver delivers exact zeros")
  })
  test("errors and non-success statuses are reported", () => {
    const d = blank()
    probeFrame(d, 3, new Int16Array(4))
    probeFrame(d, 3, new Int16Array(4))
    expect(d.statuses).toEqual([3])
    expect(verdict({ ...blank(), error: "boom" })).toBe("failed")
  })
})
