/**
 * SDK Control Types — inferred from Zod schemas in controlSchemas.ts / coreSchemas.ts.
 *
 * These types define the control protocol between the CLI bridge and the server.
 * Used by bridge/transport layer, remote session manager, and CLI print/IO paths.
 */
import type { z } from 'zod'
import type {
  SDKControlRequestSchema,
  SDKControlResponseSchema,
  SDKControlInitializeRequestSchema,
  SDKControlInitializeResponseSchema,
  SDKControlMcpSetServersResponseSchema,
  SDKControlReloadPluginsResponseSchema,
  SDKControlPermissionRequestSchema,
  SDKControlCancelRequestSchema,
  SDKControlRequestInnerSchema,
  StdoutMessageSchema,
  StdinMessageSchema,
} from './controlSchemas.js'
import type { SDKPartialAssistantMessageSchema } from './coreSchemas.js'
import type { HookInput } from './coreTypes.js'

type SDKControlRequestInnerRaw = z.infer<
  ReturnType<typeof SDKControlRequestInnerSchema>
>

type SDKControlRequestRaw = z.infer<ReturnType<typeof SDKControlRequestSchema>>

type SDKControlResponseRaw = z.infer<
  ReturnType<typeof SDKControlResponseSchema>
>

type SDKControlRequestWithHookInput<T> = T extends {
  subtype: 'hook_callback'
}
  ? Omit<T, 'input'> & { input: HookInput }
  : T

type SDKControlResponsePayloadWithHookInput<T> = T extends {
  subtype: 'error'
}
  ? Omit<T, 'pending_permission_requests'> & {
      pending_permission_requests?: SDKControlRequest[]
    }
  : T

type NonControlMessage<T> = T extends {
  type: 'control_request' | 'control_response'
}
  ? never
  : T

export type SDKControlRequestInner =
  SDKControlRequestWithHookInput<SDKControlRequestInnerRaw>

export type SDKControlRequest = Omit<SDKControlRequestRaw, 'request'> & {
  request: SDKControlRequestInner
}
export type SDKControlResponse = Omit<SDKControlResponseRaw, 'response'> & {
  response: SDKControlResponsePayloadWithHookInput<
    SDKControlResponseRaw['response']
  >
}
export type StdoutMessage =
  | NonControlMessage<z.infer<ReturnType<typeof StdoutMessageSchema>>>
  | SDKControlRequest
  | SDKControlResponse
export type SDKControlInitializeRequest = z.infer<
  ReturnType<typeof SDKControlInitializeRequestSchema>
>
export type SDKControlInitializeResponse = z.infer<
  ReturnType<typeof SDKControlInitializeResponseSchema>
>
export type SDKControlMcpSetServersResponse = z.infer<
  ReturnType<typeof SDKControlMcpSetServersResponseSchema>
>
export type SDKControlReloadPluginsResponse = z.infer<
  ReturnType<typeof SDKControlReloadPluginsResponseSchema>
>
export type StdinMessage =
  | NonControlMessage<z.infer<ReturnType<typeof StdinMessageSchema>>>
  | SDKControlRequest
  | SDKControlResponse
export type SDKPartialAssistantMessage = z.infer<
  ReturnType<typeof SDKPartialAssistantMessageSchema>
>
export type SDKControlPermissionRequest = z.infer<
  ReturnType<typeof SDKControlPermissionRequestSchema>
>
export type SDKControlCancelRequest = z.infer<
  ReturnType<typeof SDKControlCancelRequestSchema>
>
