/** Minimal ANSI SGR → styled spans. Colors are theme tokens, so the UI maps them to `--vscode-terminal-ansi*`. */

export type AnsiColor = { kind: "named"; name: string } | { kind: "rgb"; r: number; g: number; b: number }

export type AnsiSpan = {
  text: string
  fg?: AnsiColor
  bg?: AnsiColor
  bold?: boolean
  dim?: boolean
  italic?: boolean
  underline?: boolean
}

const NAMES = ["Black", "Red", "Green", "Yellow", "Blue", "Magenta", "Cyan", "White"]
const named = (i: number): AnsiColor => ({ kind: "named", name: i < 8 ? `ansi${NAMES[i]}` : `ansiBright${NAMES[i - 8]}` })

/** xterm 256-color palette. 0–15 are theme colors, the rest fixed RGB. */
function color256(n: number): AnsiColor {
  if (n < 16) return named(n)
  if (n >= 232) {
    const v = 8 + (n - 232) * 10
    return { kind: "rgb", r: v, g: v, b: v }
  }
  const i = n - 16
  const level = (x: number) => (x === 0 ? 0 : 55 + x * 40)
  return { kind: "rgb", r: level(Math.floor(i / 36)), g: level(Math.floor(i / 6) % 6), b: level(i % 6) }
}

type Style = Omit<AnsiSpan, "text">

function applySgr(style: Style, params: number[]): Style {
  let s = { ...style }
  for (let i = 0; i < params.length; i++) {
    const p = params[i]!
    if (p === 0) s = {}
    else if (p === 1) s.bold = true
    else if (p === 2) s.dim = true
    else if (p === 3) s.italic = true
    else if (p === 4) s.underline = true
    else if (p === 22) {
      s.bold = undefined
      s.dim = undefined
    } else if (p === 23) s.italic = undefined
    else if (p === 24) s.underline = undefined
    else if (p >= 30 && p <= 37) s.fg = named(p - 30)
    else if (p >= 90 && p <= 97) s.fg = named(p - 90 + 8)
    else if (p >= 40 && p <= 47) s.bg = named(p - 40)
    else if (p >= 100 && p <= 107) s.bg = named(p - 100 + 8)
    else if (p === 39) s.fg = undefined
    else if (p === 49) s.bg = undefined
    else if (p === 38 || p === 48) {
      const target = p === 38 ? "fg" : "bg"
      const mode = params[i + 1]
      if (mode === 5 && params[i + 2] !== undefined) {
        s[target] = color256(params[i + 2]!)
        i += 2
      } else if (mode === 2 && params[i + 4] !== undefined) {
        s[target] = { kind: "rgb", r: params[i + 2]!, g: params[i + 3]!, b: params[i + 4]! }
        i += 4
      } else break
    }
  }
  return Object.fromEntries(Object.entries(s).filter(([, v]) => v !== undefined)) as Style
}

// CSI (ESC [ … final), OSC (ESC ] … BEL or ESC \), and lone two-character escapes.
const ESCAPE = /\u001b(?:\[([0-9;:?]*)([\u0020-\u002f]*[\u0040-\u007e])|\][^\u0007\u001b]*(?:\u0007|\u001b\\)|[\u0040-\u005f])/g

/** Split text into spans. Non-color escape sequences are dropped, `\r\n` becomes `\n`, a bare `\r` is kept out. */
export function ansiToSpans(input: string): AnsiSpan[] {
  const text = input.replace(/\r\n/g, "\n")
  const spans: AnsiSpan[] = []
  let style: Style = {}
  let last = 0
  const push = (chunk: string) => {
    const clean = chunk.replace(/\r/g, "")
    if (clean) spans.push({ text: clean, ...style })
  }
  for (const m of text.matchAll(ESCAPE)) {
    push(text.slice(last, m.index))
    last = m.index + m[0].length
    if (m[2] === "m") {
      const params = (m[1] ?? "").split(/[;:]/).map((x) => (x === "" ? 0 : Number(x)))
      style = applySgr(style, params.some(Number.isNaN) ? [] : params)
    }
  }
  push(text.slice(last))
  return spans
}

/** Plain text without any escape sequences. */
export const stripAnsi = (input: string): string => input.replace(ESCAPE, "")

/** CSS color for a span color. Named colors come from the terminal theme with a safe fallback. */
export function cssColor(c: AnsiColor): string {
  return c.kind === "rgb" ? `rgb(${c.r}, ${c.g}, ${c.b})` : `var(--vscode-terminal-${c.name})`
}
