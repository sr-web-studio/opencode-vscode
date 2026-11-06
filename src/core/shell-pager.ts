/**
 * Reads the output of a shell command page by page, by byte cursor, until it has exited.
 * Pure: it only needs a small client, so it is tested with a fake one. The extension host feeds the result to a
 * VS Code Pseudoterminal.
 */

export type ShellStatus = "running" | "exited" | "timeout" | "killed"

export type ShellPage = { output: string; cursor: number; size: number; truncated?: boolean }
export type ShellState = { status: ShellStatus; exit?: number }

export type ShellSource = {
  output(input: { cursor: number; limit: number }): Promise<ShellPage>
  state(): Promise<ShellState>
}

export type ShellSink = {
  text(chunk: string): void
  /** The command ended (or was stopped). Called once, after all output was delivered. */
  exit(state: ShellState): void
  /** The server no longer has the shell or answers in an unexpected way. Called once, then the pager stops. */
  unavailable(reason: string): void
}

export type PagerOptions = {
  intervalMs?: number
  /** Bytes per request. Large pages keep multi-byte characters from being cut. */
  pageBytes?: number
  sleep?: (ms: number) => Promise<void>
}

const REPLACEMENT = "\uFFFD"
const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

const notFound = (e: unknown) => /not found/i.test(e instanceof Error ? e.message : String(e)) || (e as { name?: string } | undefined)?.name === "ShellNotFoundError"

export class ShellPager {
  private stopped = false
  private cursor: number
  /** Characters already emitted. Only used when the server reports no byte cursor (a version-dependent fallback). */
  private emittedChars = 0

  constructor(
    private readonly source: ShellSource,
    private readonly sink: ShellSink,
    private readonly options: PagerOptions = {},
    startCursor = 0,
  ) {
    this.cursor = startCursor
  }

  stop(): void {
    this.stopped = true
  }

  /** Run until the shell has exited (all output delivered), `stop()` is called, or the shell disappears. */
  async run(): Promise<void> {
    const interval = this.options.intervalMs ?? 300
    const sleep = this.options.sleep ?? defaultSleep
    try {
      while (!this.stopped) {
        // Ask for the state first, then drain: output written between the two calls is still read.
        const state = await this.source.state()
        await this.drain()
        if (this.stopped) return
        if (state.status !== "running") {
          this.sink.exit(state)
          return
        }
        await sleep(interval)
      }
    } catch (e) {
      if (this.stopped) return
      this.sink.unavailable(notFound(e) ? "The command is no longer available on the server." : `Could not read the command output: ${e instanceof Error ? e.message : "unknown error"}`)
    }
  }

  private async drain(): Promise<void> {
    const limit = this.options.pageBytes ?? 64 * 1024
    for (let guard = 0; guard < 10_000 && !this.stopped; guard++) {
      const page = await this.source.output({ cursor: this.cursor, limit })
      if (typeof page.cursor !== "number" || typeof page.size !== "number") {
        // Older servers: no byte cursor. Re-read the output and emit only what is new.
        const fresh = page.output.slice(this.emittedChars)
        this.emittedChars = page.output.length
        if (fresh) this.sink.text(fresh)
        return
      }
      let text = page.output
      let next = page.cursor
      // A page can end inside a multi-byte character; the server then decodes the partial bytes as U+FFFD.
      if (next < page.size && text.endsWith(REPLACEMENT)) {
        const back = await this.cutBytes(next)
        if (back > 0 && next - back > this.cursor) {
          text = text.slice(0, -1)
          next -= back
        }
      }
      if (text) this.sink.text(text)
      if (next <= this.cursor) return
      this.cursor = next
      if (this.cursor >= page.size) return
    }
  }

  /**
   * How many bytes of a character lie before `cursor`, when `cursor` falls inside that character; otherwise 0.
   * Probes backwards for a clean character start and checks that this character is long enough to span `cursor`,
   * so a genuinely invalid byte is never mistaken for a cut.
   */
  private async cutBytes(cursor: number): Promise<number> {
    for (let back = 1; back <= 3 && cursor - back >= 0; back++) {
      const probe = await this.source.output({ cursor: cursor - back, limit: 4 })
      const first = probe.output ? String.fromCodePoint(probe.output.codePointAt(0)!) : ""
      if (!first || first === REPLACEMENT) continue
      return new TextEncoder().encode(first).length > back ? back : 0
    }
    return 0
  }
}
