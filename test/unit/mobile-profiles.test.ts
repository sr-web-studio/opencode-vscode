import { describe, expect, test } from "bun:test"
import { hostOf, ProfileStore, type SecureKV } from "../../apps/mobile/src/lib/profiles"

/** A fake of the Keystore-backed storage. Like the real plugin, `get` gives null for a missing key. */
function fakeKV() {
  const data = new Map<string, string>()
  const kv: SecureKV = {
    get: async (k) => data.get(k) ?? null,
    set: async (k, v) => void data.set(k, v),
    remove: async (k) => void data.delete(k),
  }
  return { kv, data }
}

describe("profile store", () => {
  test("starts empty; a missing or corrupt value is an empty list", async () => {
    const { kv, data } = fakeKV()
    const store = new ProfileStore(kv)
    expect(await store.list()).toEqual([])
    data.set("profiles", "not json")
    expect(await store.list()).toEqual([])
    data.set("profiles", JSON.stringify([{ id: 1 }, { id: "a", name: "n", url: "http://h", password: "p", serverId: "h" }]))
    expect((await store.list()).map((p) => p.id)).toEqual(["a"])
  })

  test("save normalizes the address and defaults serverId to the URL host and the name to the host", async () => {
    const store = new ProfileStore(fakeKV().kv)
    const p = await store.save({ url: "192.168.1.10:4096/", password: "pw" })
    expect(p).toMatchObject({ url: "http://192.168.1.10:4096", serverId: "192.168.1.10", name: "192.168.1.10", password: "pw" })
    const q = await store.save({ url: "https://oc.example.com", password: "x", name: " Home server ", serverId: " my-server " })
    expect(q).toMatchObject({ url: "https://oc.example.com", serverId: "my-server", name: "Home server" })
    expect((await store.list()).map((x) => x.id)).toEqual([p.id, q.id])
  })

  test("several profiles; edit keeps the id and, with an empty password field, the saved password", async () => {
    const store = new ProfileStore(fakeKV().kv)
    const a = await store.save({ url: "http://a:4096", password: "secret-a" })
    const b = await store.save({ url: "http://b:4096", password: "secret-b" })
    const edited = await store.save({ id: a.id, url: "http://a2:4096", password: "", name: "A two" })
    expect(edited).toMatchObject({ id: a.id, url: "http://a2:4096", name: "A two", password: "secret-a", serverId: "a2" })
    const again = await store.save({ id: a.id, url: "http://a2:4096", password: "new" })
    expect(again.password).toBe("new")
    expect((await store.list()).map((p) => [p.id, p.password])).toEqual([
      [a.id, "new"],
      [b.id, "secret-b"],
    ])
  })

  test("an unusable address is refused with a message", async () => {
    const store = new ProfileStore(fakeKV().kv)
    await expect(store.save({ url: "" })).rejects.toThrow(/address/i)
    await expect(store.save({ url: "ftp://h" })).rejects.toThrow(/http/)
    expect(await store.list()).toEqual([])
  })

  test("remove deletes the profile and forgets it as the active one", async () => {
    const store = new ProfileStore(fakeKV().kv)
    const a = await store.save({ url: "http://a:1", password: "1" })
    const b = await store.save({ url: "http://b:1", password: "2" })
    await store.setActive(a.id)
    expect(await store.activeID()).toBe(a.id)
    await store.remove(a.id)
    expect((await store.list()).map((p) => p.id)).toEqual([b.id])
    expect(await store.activeID()).toBeUndefined()
    await store.setActive(b.id)
    await store.remove("nope")
    expect(await store.activeID()).toBe(b.id)
  })

  test("learnHostname stores the server's host name once", async () => {
    const { kv, data } = fakeKV()
    const store = new ProfileStore(kv)
    const a = await store.save({ url: "http://192.168.1.10:4096", password: "1" })
    await store.learnHostname(a.id, "my-server")
    expect((await store.get(a.id))?.hostname).toBe("my-server")
    const before = data.get("profiles")
    await store.learnHostname(a.id, "my-server")
    await store.learnHostname("missing", "x")
    expect(data.get("profiles")).toBe(before)
  })

  test("hostOf", () => {
    expect(hostOf("http://192.168.1.10:4096")).toBe("192.168.1.10")
    expect(hostOf("oc.example.com:8443")).toBe("oc.example.com")
    expect(hostOf("http://[::1]:4096")).toBe("::1")
    expect(hostOf("")).toBe("")
  })
})
