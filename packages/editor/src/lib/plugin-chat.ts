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
 * What a plugin's start screen does through the host's chat, before anything is said. `send` sends
 * a message now, its pictures by reference (a host-stored image), and `attach` puts files on the
 * next message, in the composer: both at the level that runs the plugin's tools. `requirePro` only
 * asks whether the person's plan includes that level ("Pro" is the hosted product's name for it):
 * it answers false after offering the upgrade, and changes nothing in the chat.
 */
export type ChatStartProps = {
  send(text: string, images?: readonly { url: string; name: string }[]): void
  attach(files: readonly File[]): void
  requirePro(): boolean
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
  /** What the chat shows while its thread is empty, loaded lazily. */
  start?: () => Promise<{ default: ComponentType<ChatStartProps> }>
}
