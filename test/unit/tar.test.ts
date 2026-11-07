import { describe, expect, test } from "bun:test"
import { gzipSync, gunzipSync } from "node:zlib"
import { parseTar, safeRelativePath, stripTopFolder } from "@occ/core/tar"

const enc = new TextEncoder()

/** One tar entry (ustar). `type` "0" file, "5" dir, "L" GNU long name, "x" pax, "2" symlink. */
function entry(name: string, data: Uint8Array | string, type = "0", mode = 0o644, prefix = ""): Uint8Array {
  const body = typeof data === "string" ? enc.encode(data) : data
  const h = new Uint8Array(512)
  const put = (at: number, s: string) => h.set(enc.encode(s), at)
  put(0, name.slice(0, 100))
  put(100, mode.toString(8).padStart(7, "0"))
  put(124, body.length.toString(8).padStart(11, "0"))
  put(156, type)
  put(257, "ustar")
  put(345, prefix)
  const padded = new Uint8Array(Math.ceil(body.length / 512) * 512)
  padded.set(body)
  return Uint8Array.from([...h, ...padded])
}

const archive = (...parts: Uint8Array[]): Uint8Array => Uint8Array.from([...parts.flatMap((p) => [...p]), ...new Uint8Array(1024)])

describe("parseTar", () => {
  test("reads files and directories from a gzipped tarball", () => {
    const tgz = gzipSync(archive(entry("package/", "", "5", 0o755), entry("package/index.js", "module.exports = 1"), entry("package/lib/a.so", new Uint8Array([1, 2, 3]), "0", 0o755)))
    const entries = parseTar(gunzipSync(tgz))
    expect(entries.map((e) => [e.path, e.type])).toEqual([["package", "dir"], ["package/index.js", "file"], ["package/lib/a.so", "file"]])
    expect(new TextDecoder().decode(entries[1]!.data)).toBe("module.exports = 1")
    expect([...entries[2]!.data]).toEqual([1, 2, 3])
    expect(entries[2]!.mode).toBe(0o755)
  })

  test("a file larger than one block and an empty file", () => {
    const big = new Uint8Array(1300).map((_, i) => i % 251)
    const entries = parseTar(archive(entry("package/big.bin", big), entry("package/empty", "")))
    expect(entries[0]!.data).toEqual(big)
    expect(entries[1]!.data.length).toBe(0)
  })

  test("ustar prefix, GNU long names and pax paths", () => {
    const long = "package/" + "d/".repeat(60) + "file.txt"
    const pax = (() => {
      const rec = " path=package/pax.txt\n"
      let n = rec.length + 2
      if (String(n).length !== 2) n = rec.length + String(n).length
      return `${n}${rec}`
    })()
    const entries = parseTar(
      archive(
        entry("file.txt", "p", "0", 0o644, "package/some/dir"),
        entry("././@LongLink", long + "\0", "L"),
        entry("truncated-name", "long"),
        entry("PaxHeader", pax, "x"),
        entry("short-name", "pax"),
      ),
    )
    expect(entries.map((e) => e.path)).toEqual(["package/some/dir/file.txt", long, "package/pax.txt"])
  })

  test("refuses unsafe paths, links and truncated archives", () => {
    expect(() => parseTar(archive(entry("package/../../etc/passwd", "x")))).toThrow(/unsafe/)
    expect(() => parseTar(archive(entry("/etc/passwd", "x")))).toThrow(/unsafe/)
    expect(() => parseTar(archive(entry("C:/Windows/x", "x")))).toThrow(/unsafe/)
    expect(() => parseTar(archive(entry("package\\evil", "x")))).toThrow(/unsafe/)
    expect(() => parseTar(archive(entry("package/link", "", "2")))).toThrow(/unsupported entry type/)
    expect(() => parseTar(archive(entry("././@LongLink", "../../x\0", "L"), entry("a", "x")))).toThrow(/unsafe/)
    expect(() => parseTar(archive(entry("package/a", "hello")).subarray(0, 515))).toThrow(/truncated/)
  })
})

describe("paths", () => {
  test("safeRelativePath cleans harmless paths and rejects the rest", () => {
    expect(safeRelativePath("./package//a/./b")).toBe("package/a/b")
    for (const bad of ["", "..", "a/../b", "/abs", "c:\\x", "D:x", "a\\b", "a\0b", "./", "."]) expect(() => safeRelativePath(bad)).toThrow()
  })
  test("stripTopFolder drops npm's package/ folder", () => {
    expect(stripTopFolder("package/sherpa-onnx.node")).toBe("sherpa-onnx.node")
    expect(stripTopFolder("package/lib/x")).toBe("lib/x")
    expect(stripTopFolder("package")).toBeUndefined()
  })
})
