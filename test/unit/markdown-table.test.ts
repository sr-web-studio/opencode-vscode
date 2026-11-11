import { describe, expect, test } from "bun:test"
import { marked } from "marked"
import { wrapTables } from "@occ/ui/markdown-tables"

const html = (text: string) => marked.parse(text, { async: false }) as string
const count = (text: string, part: string) => text.split(part).length - 1

describe("markdown table wrapper", () => {
  test("a table is wrapped in its own scroll box", () => {
    expect(wrapTables("<table><tr><td>a</td></tr></table>")).toBe('<div class="oc-table"><table><tr><td>a</td></tr></table></div>')
  })

  test("a rendered GFM table gets the wrapper around the table element", () => {
    const out = wrapTables(html("| a | b |\n| --- | --- |\n| 1 | 2 |"))
    expect(out).toContain('<div class="oc-table"><table>')
    expect(out).toContain("</table></div>")
  })

  test("every table is wrapped and the text between them is unchanged", () => {
    const source = html("before\n\n| a |\n| --- |\n| 1 |\n\nmiddle\n\n| b |\n| --- |\n| 2 |\n\nafter")
    const out = wrapTables(source)
    expect(count(out, '<div class="oc-table"><table')).toBe(2)
    expect(count(out, "</table></div>")).toBe(2)
    expect(out.startsWith("<p>before</p>")).toBe(true)
    expect(out).toContain("<p>middle</p>")
    expect(out.endsWith("<p>after</p>\n")).toBe(true)
    expect(out.replaceAll('<div class="oc-table">', "").replaceAll("</div>", "")).toBe(source)
  })

  test("content without a table is returned as is", () => {
    const source = html("# Title\n\nA paragraph with `code` and a [link](https://example.com).\n\n- one\n- two\n\n```ts\nconst a = 1\n```")
    expect(wrapTables(source)).toBe(source)
  })

  test("a table written as text in a code block is not wrapped", () => {
    const source = html("```html\n<table><tr><td>a</td></tr></table>\n```")
    expect(wrapTables(source)).toBe(source)
  })

  test("nested tables are wrapped once, by the outer table", () => {
    const source = "<table><tr><td><table><tr><td>inner</td></tr></table></td></tr></table>"
    const out = wrapTables(source)
    expect(count(out, '<div class="oc-table">')).toBe(1)
    expect(out).toBe(`<div class="oc-table">${source}</div>`)
  })

  test("a quoted attribute containing > does not end the tag early", () => {
    const source = '<table><tr><td><span title="a > b">x</span></td></tr></table>'
    expect(wrapTables(source)).toBe(`<div class="oc-table">${source}</div>`)
  })

  test("an unclosed table is left alone rather than leaving a stray wrapper", () => {
    expect(wrapTables("<table><tr><td>a")).toBe("<table><tr><td>a")
  })
})
