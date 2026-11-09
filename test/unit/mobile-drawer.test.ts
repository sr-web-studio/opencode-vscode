import { describe, expect, test } from "bun:test"
import { expandedKey, isExpanded, parseExpanded, setExpanded } from "../../apps/mobile/src/lib/drawer-prefs"
import { backAction } from "../../apps/mobile/src/lib/nav"

describe("drawer expansion memory", () => {
  test("a folder's explicit answer wins over the default", () => {
    const map = setExpanded({}, "/work/app", false)
    expect(isExpanded(map, "/work/app", true)).toBe(false)
    expect(isExpanded(setExpanded(map, "/work/app", true), "/work/app", false)).toBe(true)
    expect(isExpanded(map, "/work/other", true)).toBe(true)
  })

  test("a stale or hand-edited value falls back to the default instead of breaking the drawer", () => {
    expect(parseExpanded("not json")).toEqual({})
    expect(parseExpanded("[]")).toEqual({})
    expect(parseExpanded('{"\/a": true, "\/b": "yes", "\/c": false}')).toEqual({ "/a": true, "/c": false })
    expect(parseExpanded(null)).toEqual({})
  })

  test("the key is per saved server", () => {
    expect(expandedKey("srv-1")).toBe("occ.drawer.expanded.srv-1")
  })
})

describe("Android back order", () => {
  test("a dialog closes first, then the drawer, then Settings, then the top screen", () => {
    expect(backAction({ modal: true, drawer: true, settings: true, canPop: true })).toBe("modal")
    expect(backAction({ modal: false, drawer: true, settings: true, canPop: true })).toBe("drawer")
    expect(backAction({ modal: false, drawer: false, settings: true, canPop: true })).toBe("settings")
    expect(backAction({ modal: false, drawer: false, settings: false, canPop: true })).toBe("pop")
  })

  test("at the bottom, back leaves the app", () => {
    expect(backAction({ modal: false, drawer: false, settings: false, canPop: false })).toBe("exit")
  })
})
