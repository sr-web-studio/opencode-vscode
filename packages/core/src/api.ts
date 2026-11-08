/**
 * Type-only re-exports from the root `@opencode/client` entry. Nothing here exists at runtime,
 * so core and UI code stay free of Node and of the service-lifecycle entry point.
 */
import type { AgentInfo, FormField, FormInfo, ModelRef, OpenCodeClient, OpenCodeEvent, PermissionRequest, SessionInfo, SessionMessageInfo } from "@opencode/client"

export type { AgentInfo, FormField, FormInfo, ModelRef, OpenCodeClient, OpenCodeEvent, PermissionRequest, SessionInfo, SessionMessageInfo }

/** The model list entry the UI needs. The host strips provider settings, headers and keys before it reaches the webview. */
export type SlimModel = {
  id: string
  modelID: string
  providerID: string
  name: string
  enabled: boolean
  status?: string
  variants: ReadonlyArray<{ id: string }>
  /** `capabilities.input` (`text`, `image`, …). Undefined when the server does not report it. */
  input?: ReadonlyArray<string>
}

export type SlimProvider = { id: string; name: string }

export type Defaults = { agent?: string; model?: { id: string; providerID: string; variant?: string } }

/** Loosely typed event envelope. Reducers narrow on `type` and read `data` defensively. */
export type EventEnvelope = {
  id?: string
  type: string
  created?: number
  location?: { directory?: string }
  data?: any
}

export type PermissionDecision = "once" | "always" | "reject"
