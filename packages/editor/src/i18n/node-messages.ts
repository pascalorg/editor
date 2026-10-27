import type { MessageDescriptor, PascalI18n } from '@pascal-app/core'

/**
 * Display copy that node definitions carry (presentation labels, tool hints)
 * stays English in the definition, because MCP, agents and exports read it.
 * The editor translates it at display time through IDs derived from the kind
 * and the English text. `scripts/i18n-node-messages.ts` generates the matching
 * descriptors for every built-in kind so they are extracted and translated; a
 * plugin kind can ship the same IDs with `registerMessages`, and otherwise
 * shows its own English.
 */

/** Lower-camel slug of up to six words, used in generated message IDs. */
export function messageSlug(text: string): string {
  const words = text
    .replace(/\{(\w+)[^}]*\}/g, ' $1 ')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .match(/[A-Za-z0-9]+/g)
  if (!words?.length) return 'symbol'
  const slug = words
    .slice(0, 6)
    .map((word, index) => {
      const lower = word.toLowerCase()
      return index === 0 ? lower : lower.charAt(0).toUpperCase() + lower.slice(1)
    })
    .join('')
  return /^[0-9]/.test(slug) ? `n${slug}` : slug
}

/** Definition copy is literal text; braces must not read as ICU arguments. */
function literal(text: string): string {
  return text.replace(/[{}]/g, (brace) => `'${brace}'`)
}

/** `roof-segment` → `roofSegment`. */
export function nodeKindKey(kind: string): string {
  return kind.replace(/[-_](\w)/g, (_, letter: string) => letter.toUpperCase())
}

export function nodeLabelDescriptor(kind: string, english: string): MessageDescriptor {
  return { id: `node.${nodeKindKey(kind)}.label`, message: literal(english) }
}

export function nodeDescriptionDescriptor(kind: string, english: string): MessageDescriptor {
  return { id: `node.${nodeKindKey(kind)}.description`, message: literal(english) }
}

/**
 * Short FNV-1a hash of the whole message. Hint IDs end with it, so two hints
 * whose first six words agree (a plugin's and a built-in's) never share an ID
 * and so never share a translation.
 */
function messageHash(message: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < message.length; index += 1) {
    hash ^= message.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(36)
}

function hintMessage(message: string): MessageDescriptor {
  return { id: `editor.toolHint.${messageSlug(message)}.${messageHash(message)}`, message }
}

export function toolHintDescriptor(english: string): MessageDescriptor {
  return hintMessage(literal(english))
}

/**
 * A chip label for one chip value. Labels that spell out a numeric value
 * ("Cuts: 3, even") share one message with the number as `{value}`.
 */
export function toolHintChipDescriptor(
  value: string,
  label: string,
): { descriptor: MessageDescriptor; values?: { value: string } } {
  if (/^\d+$/.test(value) && new RegExp(`\\b${value}\\b`).test(label)) {
    const message = literal(label).replace(new RegExp(`\\b${value}\\b`), '{value}')
    return { descriptor: hintMessage(message), values: { value } }
  }
  return { descriptor: toolHintDescriptor(label) }
}

export function toolHintChipLabel(value: string, label: string, i18n: PascalI18n): string {
  const { descriptor, values } = toolHintChipDescriptor(value, label)
  return i18n._({ ...descriptor, values })
}

/**
 * Gesture and key names the HUD and shortcut tokens print, beyond those the
 * built-in definitions name themselves.
 */
export const HINT_KEY_NAMES = [
  'Backspace',
  'Click',
  'Command',
  'Control',
  'Delete',
  'Double click',
  'Drag',
  'Enter',
  'Hover',
  'Left click',
  'Middle click',
  'Right click',
  'Scroll',
  'Scroll wheel',
  'Space',
  'Tab',
] as const

/** Key or gesture names with words in them ("Left click", "Scroll"); bare keys stay as written. */
export function toolHintKeyDescriptor(key: string): MessageDescriptor | undefined {
  if (!/\p{L}{2}/u.test(key) || /^(?:Alt|Ctrl|Cmd|Esc|Shift)$/.test(key)) {
    return undefined
  }
  const message = literal(key)
  return { id: `editor.toolHint.key.${messageSlug(key)}.${messageHash(message)}`, message }
}

export function nodeLabel(kind: string, english: string, i18n: PascalI18n): string {
  return i18n._(nodeLabelDescriptor(kind, english))
}

export function toolHintLabel(english: string, i18n: PascalI18n): string {
  return i18n._(toolHintDescriptor(english))
}

export function toolHintKey(key: string, i18n: PascalI18n): string {
  const descriptor = toolHintKeyDescriptor(key)
  return descriptor ? i18n._(descriptor) : key
}

/** Hint text from a descriptor (editor copy) or English definition copy. */
export function hintText(value: MessageDescriptor | string, i18n: PascalI18n): string {
  return typeof value === 'string' ? toolHintLabel(value, i18n) : i18n._(value)
}
