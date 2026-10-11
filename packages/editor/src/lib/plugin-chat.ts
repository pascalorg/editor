import type { ComponentType } from 'react'

/**
 * What a plugin's tool answers in a chat. Images travel by reference (a host-stored asset), never
 * as bytes, so a transcript stays small; a refusal is `error` with its stable `code`.
 */
export type ChatToolOutput = {
  text?: string
  data?: Record<string, unknown>
  images?: readonly { ref: string; alt?: string }[]
  error?: string
  code?: string
}

/**
 * What a plugin's card renders for one of its tool calls, from the persisted call alone. `actions`
 * are the host's: open one of the editor's views, select nodes, send a prompt to the chat.
 */
export type ChatToolCardProps = {
  toolName: string
  input: unknown
  output: ChatToolOutput | undefined
  state: 'running' | 'done' | 'error' | 'cancelled'
  actions: {
    openView(viewId: string, options?: { beside?: boolean }): void
    select(nodeIds: readonly string[]): void
    send(prompt: string): void
  }
}

/**
 * A plugin's contribution to a host's chat, exported from its browser entry beside its panels and
 * views; its tool contracts are its `./agent-tools` export. Which tools a turn offers, and to whom,
 * is the host's decision.
 */
export type PluginChatExtension = {
  pluginId: string
  /** Runs the plugin's `runsIn: 'editor'` tools in the editor tab. */
  execute?: (
    name: string,
    input: unknown,
    context: { projectId: string; signal: AbortSignal },
  ) => Promise<ChatToolOutput>
  /** A card per tool name, loaded lazily; a tool without one shows as a plain tool row. */
  cards?: Readonly<Record<string, () => Promise<{ default: ComponentType<ChatToolCardProps> }>>>
  /** Entries for the composer's `/` menu: picking one sends `prompt`. */
  actions?: readonly { id: string; label: string; hint: string; prompt: string }[]
  /** File extensions or MIME types the plugin's tools read, which the composer then accepts. */
  accepts?: readonly string[]
}
