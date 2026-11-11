import { describe, expect, test } from "bun:test"
import { chooseLanding, lastUsedKey, parseLastUsed } from "../../apps/mobile/src/lib/landing"
import { buildOverview, emptyOverview, toOverviewSession, type OverviewData } from "../../apps/mobile/src/lib/overview"
import type { ProjectLike } from "../../apps/mobile/src/lib/projects"
import type { SessionInfo } from "@occ/core/api"

const project = (id: string, canonical: string, updated: number): ProjectLike => ({ id, canonical, time: { created: 1, updated, active: updated } })

const session = (id: string, directory: string, updated: number): SessionInfo => ({ id, projectID: "p", title: id, location: { directory }, time: { created: updated, updated } }) as SessionInfo

const groupsOf = (over: Partial<OverviewData>) => buildOverview({ ...emptyOverview(), ...over })

describe("landing after connecting", () => {
  test("the chat last used on that server wins over everything else", () => {
    const groups = groupsOf({ projects: [project("a", "/a", 1), project("b", "/b", 50)], sessions: [session("s1", "/a", 1), session("s2", "/b", 50)].map(toOverviewSession) })
    expect(chooseLanding(groups, { directory: "/a", sessionID: "s1" })).toEqual({ kind: "chat", directory: "/a", sessionID: "s1", title: "s1" })
  })

  test("a session without a name leaves the header to the folder, not the drawer's placeholder", () => {
    const groups = groupsOf({ projects: [project("a", "/a", 1)], sessions: [{ ...session("s1", "/a", 1), title: "  " } as SessionInfo].map(toOverviewSession) })
    expect(chooseLanding(groups, { directory: "/a", sessionID: "s1" })).toEqual({ kind: "chat", directory: "/a", sessionID: "s1", title: undefined })
  })

  test("a remembered session that no longer exists opens its folder's newest session instead", () => {
    const groups = groupsOf({ projects: [project("a", "/a", 1)], sessions: [session("s1", "/a", 1)].map(toOverviewSession) })
    expect(chooseLanding(groups, { directory: "/a", sessionID: "gone" })).toEqual({ kind: "chat", directory: "/a", sessionID: undefined })
  })

  test("a remembered folder opens even when the project list is unavailable, so a failed snapshot is not a dead end", () => {
    expect(chooseLanding([], { directory: "/gone" })).toEqual({ kind: "chat", directory: "/gone", sessionID: undefined })
  })

  test("without a remembered chat, the first project with a session wins, then any project, then the empty state", () => {
    const withSession = groupsOf({ projects: [project("a", "/empty", 99), project("b", "/full", 1)], sessions: [session("s1", "/full", 1)].map(toOverviewSession) })
    expect(chooseLanding(withSession)).toEqual({ kind: "chat", directory: "/full", sessionID: undefined })
    const onlyEmpty = groupsOf({ projects: [project("a", "/empty", 99)] })
    expect(chooseLanding(onlyEmpty)).toEqual({ kind: "chat", directory: "/empty", sessionID: undefined })
    expect(chooseLanding([])).toEqual({ kind: "empty" })
  })
})

describe("remembered chat", () => {
  test("the key is per saved server", () => {
    expect(lastUsedKey("srv-1")).toBe("occ.last.srv-1")
  })

  test("anything that is not a folder path is ignored", () => {
    expect(parseLastUsed(undefined)).toBeUndefined()
    expect(parseLastUsed("nope")).toBeUndefined()
    expect(parseLastUsed({})).toBeUndefined()
    expect(parseLastUsed({ directory: "" })).toBeUndefined()
    expect(parseLastUsed({ directory: "/a", sessionID: 7 })).toEqual({ directory: "/a", sessionID: undefined })
    expect(parseLastUsed({ directory: "/a", sessionID: "ses_1" })).toEqual({ directory: "/a", sessionID: "ses_1" })
  })
})
