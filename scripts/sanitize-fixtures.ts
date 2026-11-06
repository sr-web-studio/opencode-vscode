// Turns raw API captures (from /tmp/opencode/capture*/) into committed test fixtures.
// Removes anything that is not needed by the reducer tests: instruction hashes, usage noise,
// model settings, and any string that looks like a secret.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs"

const [src, name] = process.argv.slice(2)
if (!src || !name) throw new Error("usage: bun scripts/sanitize-fixtures.ts <capture-dir> <name>")
mkdirSync("test/fixtures", { recursive: true })

const SECRET = /(sk-[A-Za-z0-9_-]{8,}|Bearer\s+\S+|password"?\s*[:=]\s*"[^"]+")/g
const clean = (v: unknown): unknown => {
  if (typeof v === "string") return v.replace(SECRET, "***")
  if (Array.isArray(v)) return v.map(clean)
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, clean(x)]))
  return v
}
const DROP = new Set(["session.instructions.updated", "session.usage.updated", "session.inbox.delivery.changed"])
const events = (JSON.parse(readFileSync(`${src}/events.json`, "utf8")) as any[]).filter((e) => !DROP.has(e.type))
const messages = JSON.parse(readFileSync(`${src}/messages.json`, "utf8"))
for (const e of events) { delete e.durable; delete e.metadata }
const out = { events: clean(events), messages: clean(messages.data) }
writeFileSync(`test/fixtures/${name}.json`, JSON.stringify(out, null, 1) + "\n")
console.log(name, "events", events.length, "messages", messages.data.length)
