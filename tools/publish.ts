// Publish the packaged vsix to the VS Code Marketplace and/or Open VSX.
//
//   bun run package
//   bun tools/publish.ts marketplace|openvsx|all
//
// Tokens come from `.env` (VSCE_PAT, OVSX_PAT) or the environment. They are never printed: all child output is scrubbed.
// See docs/PUBLISHING.md.
import { existsSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { spawnSync } from "node:child_process"

const root = resolve(import.meta.dir, "..")
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"))
// The companion goes first: the main extension installs it, so it must exist in the store before users update.
const packages = [
  { id: `${pkg.publisher}.opencode-voice@${pkg.version}`, vsix: join(root, "opencode-voice.vsix") },
  { id: `${pkg.publisher}.${pkg.name}@${pkg.version}`, vsix: join(root, "opencode-vscode.vsix") },
]
function readToken(name: string, minLength: number): string {
  let value = process.env[name]?.trim()
  const envPath = join(root, ".env")
  if (!value && existsSync(envPath)) {
    const m = readFileSync(envPath, "utf8").match(new RegExp(`^\\s*${name}\\s*=\\s*(.+)$`, "m"))
    value = m?.[1]?.trim().replace(/^["']|["']$/g, "")
  }
  if (!value || value.length < minLength) {
    console.error(`${name} is missing or too short. Add it to .env (see .env.example).`)
    process.exit(1)
  }
  return value
}

// The token goes through the environment (VSCE_PAT / OVSX_PAT), never the command line, so it can't show up in `ps`.
function run(args: string[], env: Record<string, string>, secret: string): void {
  const scrub = (s: string) => s.split(secret).join("***")
  const r = spawnSync("bunx", args, { cwd: root, encoding: "utf8", maxBuffer: 20 * 1024 * 1024, env: { ...process.env, ...env } })
  if (r.stdout) process.stdout.write(scrub(r.stdout))
  if (r.stderr) process.stderr.write(scrub(r.stderr))
  if (r.status !== 0) process.exit(r.status ?? 1)
}

function checkVsix(vsix: string): void {
  if (!existsSync(vsix)) {
    console.error(`${vsix} not found. Run \`bun run package\` first.`)
    process.exit(1)
  }
  const r = spawnSync("unzip", ["-Z1", vsix], { encoding: "utf8" })
  const bad = (r.stdout ?? "").split("\n").filter((f) => /(^|\/)\.env($|\.)|\.pem$|id_rsa/.test(f))
  if (bad.length > 0) {
    console.error(`Refusing to publish: the vsix contains secret-looking files: ${bad.join(", ")}`)
    process.exit(1)
  }
}

const target = process.argv[2] ?? "all"
if (!["marketplace", "openvsx", "all"].includes(target)) {
  console.error("usage: bun tools/publish.ts marketplace|openvsx|all")
  process.exit(1)
}
for (const p of packages) checkVsix(p.vsix)
for (const p of packages) {
  if (target === "marketplace" || target === "all") {
    const pat = readToken("VSCE_PAT", 20)
    console.log(`Publishing ${p.id} to the VS Code Marketplace…`)
    run(["@vscode/vsce", "publish", "--packagePath", p.vsix], { VSCE_PAT: pat }, pat)
  }
  if (target === "openvsx" || target === "all") {
    const pat = readToken("OVSX_PAT", 10)
    console.log(`Publishing ${p.id} to Open VSX…`)
    run(["ovsx", "publish", p.vsix], { OVSX_PAT: pat }, pat)
  }
}
