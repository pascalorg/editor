type MessageTree = { [key: string]: string | MessageTree }

let messages: MessageTree = {}

function getNested(obj: MessageTree, path: string): string | undefined {
  const parts = path.split('.')
  let current: string | MessageTree = obj

  for (const part of parts) {
    if (typeof current !== 'object' || current === null || !(part in current)) {
      return undefined
    }
    const next: string | MessageTree | undefined = current[part]
    if (next === undefined) {
      return undefined
    }
    current = next
  }

  return typeof current === 'string' ? current : undefined
}

export type TParams = Record<string, string | number>

export type TOptions = {
  fallback?: string
  params?: TParams
}

export function setMessages(tree: MessageTree): void {
  messages = tree
}

export function t(key: string, fallbackOrOptions?: string | TOptions): string {
  let fallback: string | undefined
  let params: TParams | undefined

  if (typeof fallbackOrOptions === 'string') {
    fallback = fallbackOrOptions
  } else if (fallbackOrOptions) {
    fallback = fallbackOrOptions.fallback
    params = fallbackOrOptions.params
  }

  let text = getNested(messages, key) ?? fallback ?? key

  if (params) {
    for (const [name, value] of Object.entries(params)) {
      text = text.replaceAll(`{${name}}`, String(value))
    }
  }

  return text
}
