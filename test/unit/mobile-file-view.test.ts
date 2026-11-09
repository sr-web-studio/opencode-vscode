import { describe, expect, test } from "bun:test"
import { classifyFile, fileReadInput, humanSize, leaf } from "../../apps/mobile/src/lib/files"

/** The first bytes of a PNG; enough for the image rule, which runs before the binary check. */
const PNG_HEADER = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d])

describe("the file viewer's read input", () => {
  test("an absolute path inside the project is read in the project instance", () => {
    expect(fileReadInput("/home/me/project/src/a.ts", "/home/me/project")).toEqual({ path: "/home/me/project/src/a.ts", location: { directory: "/home/me/project" } })
  })

  test("an absolute path outside the project is read in its own folder", () => {
    expect(fileReadInput("/tmp/opencode/occ-test/pic.png", "/home/me/project")).toEqual({
      path: "/tmp/opencode/occ-test/pic.png",
      location: { directory: "/tmp/opencode/occ-test" },
    })
    expect(fileReadInput("/etc/hostname", "/home/me/project")).toEqual({ path: "/etc/hostname", location: { directory: "/etc" } })
  })

  test("a Windows absolute path keeps its spelling and root", () => {
    expect(fileReadInput("C:\\work\\shots\\pic.png", "D:\\project")).toEqual({ path: "C:\\work\\shots\\pic.png", location: { directory: "C:\\work\\shots" } })
    expect(fileReadInput("C:\\pic.png", "D:\\project")).toEqual({ path: "C:\\pic.png", location: { directory: "C:\\" } })
    expect(fileReadInput("D:\\project\\src\\a.ts", "D:\\project")).toEqual({ path: "D:\\project\\src\\a.ts", location: { directory: "D:\\project" } })
  })

  test("a relative path is resolved against the project", () => {
    expect(fileReadInput("src/a.ts", "/home/me/project")).toEqual({ path: "src/a.ts", location: { directory: "/home/me/project" } })
    expect(fileReadInput("shots/pic.png", "/home/me/project")).toEqual({ path: "shots/pic.png", location: { directory: "/home/me/project" } })
  })
})

describe("classifyFile", () => {
  test("a png is an image by name, even before looking at the bytes", () => {
    expect(classifyFile("/tmp/opencode/occ-test/pic.png", PNG_HEADER)).toEqual({ kind: "image", mime: "image/png" })
    expect(classifyFile("PIC.PNG", PNG_HEADER)).toEqual({ kind: "image", mime: "image/png" })
  })

  test("jpeg, webp, gif, avif and svg are images", () => {
    for (const [name, mime] of [
      ["a.jpg", "image/jpeg"],
      ["a.jpeg", "image/jpeg"],
      ["a.webp", "image/webp"],
      ["a.gif", "image/gif"],
      ["a.avif", "image/avif"],
      ["a.svg", "image/svg+xml"],
    ] as const) {
      expect(classifyFile(name, PNG_HEADER)).toEqual({ kind: "image", mime })
    }
  })

  test("text wraps its lines and drops the empty line of a trailing newline", () => {
    const text = classifyFile("a.txt", new TextEncoder().encode("one\ntwo\n"))
    expect(text).toEqual({ kind: "text", text: "one\ntwo", lines: 2, truncated: false })
  })

  test("a binary file is named as such instead of shown as text", () => {
    expect(classifyFile("a.bin", new Uint8Array([1, 0, 2]))).toEqual({ kind: "binary", size: 3 })
    expect(classifyFile("a.pdf", new TextEncoder().encode("%PDF-1.7"))).toEqual({ kind: "binary", size: 8 })
  })
})

describe("file names", () => {
  test("leaf and size", () => {
    expect(leaf("/tmp/opencode/occ-test/pic.png")).toBe("pic.png")
    expect(leaf("C:\\work\\pic.png")).toBe("pic.png")
    expect(humanSize(512)).toBe("512 B")
    expect(humanSize(2048)).toBe("2.0 KB")
  })
})
