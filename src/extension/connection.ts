import { OpenCode, type OpenCodeClient } from "@opencode/client"
import { Service, type Endpoint } from "@opencode/client/service"
import { normalizeServerUrl, serverUrlProblem } from "../core/server-url"
import { resolveCli } from "./cli"

export class SetupError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "SetupError"
  }
}

export type Connected = { client: OpenCodeClient; url: string; version?: string; /** The server's own host name (`/api/info`), to tell whether its config is on this machine. */ hostname?: string }

export type ConnectOptions = {
  serverUrl: string
  cliPath: string
  password: string | undefined
}

/** The registered service URL is often `http://0.0.0.0:4096`, which is not connectable on every platform. */
export const connectable = (url: string) => url.replace("//0.0.0.0", "//127.0.0.1")

const basic = (user: string, password: string) => `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`

/**
 * Find or start the OpenCode server and return a client.
 *
 * - `opencode.serverUrl` set: use it (password from SecretStorage, sent as Basic auth).
 * - otherwise: discover the shared local service; if none is running, check the binary exists and let
 *   `Service.ensure()` start it. The service is a detached process shared with every other client, so closing
 *   VS Code never affects it. This extension never stops or restarts it.
 */
export async function connect(opts: ConnectOptions): Promise<Connected> {
  const remote = opts.serverUrl.trim()
  let url: string
  let headers: Record<string, string> | undefined

  if (remote) {
    const problem = serverUrlProblem(remote)
    if (problem) throw new Error(`opencode.serverUrl: ${problem}`)
    url = normalizeServerUrl(remote)
    if (opts.password) headers = { Authorization: basic("opencode", opts.password) }
  } else {
    let endpoint: Endpoint | undefined = await Service.discover()
    if (!endpoint) {
      const cli = resolveCli(opts.cliPath)
      if (!cli) {
        throw new SetupError(
          opts.cliPath.trim()
            ? `No executable found at the configured CLI path: ${opts.cliPath.trim()}`
            : "The opencode command was not found on PATH or in ~/.opencode/bin.",
        )
      }
      endpoint = await Service.ensure({ command: [cli, "serve", "--service"] })
    }
    url = connectable(endpoint.url)
    headers = Service.headers(endpoint)
  }

  const client = OpenCode.make({ baseUrl: url, headers })
  const info = await client.server.info().catch((e: unknown) => {
    const msg = e instanceof Error ? e.message : String(e)
    if (remote && /authentication required|unauthori[sz]ed|\b401\b/i.test(msg)) {
      throw new Error(
        opts.password
          ? `The OpenCode server at ${url} rejected the password. Run “OpenCode: Set Server Password” again.`
          : `The OpenCode server at ${url} needs a password. Run “OpenCode: Set Server Password”.`,
      )
    }
    throw e
  })
  return { client, url, version: info.version, hostname: info.hostname }
}
