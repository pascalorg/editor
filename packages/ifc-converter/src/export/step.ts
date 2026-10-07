/**
 * Minimal ISO-10303-21 (STEP physical file) writer for IFC4.
 *
 * Entities are serialized the moment they are added, so the file order is
 * the insertion order and entity numbers are deterministic for a given
 * input. Attribute values are plain TS values; the wrappers below cover the
 * STEP-specific literals (enums, integers, typed selects, `$` and `*`).
 */

export class StepRef {
  constructor(readonly id: number) {}
}

class StepEnum {
  constructor(readonly value: string) {}
}

class StepInt {
  constructor(readonly value: number) {}
}

class StepTyped {
  constructor(
    readonly type: string,
    readonly value: StepValue,
  ) {}
}

class StepRaw {
  constructor(readonly text: string) {}
}

const DERIVED_TOKEN = Symbol('derived')

export type StepValue =
  | null
  | undefined
  | boolean
  | number
  | string
  | StepRef
  | StepEnum
  | StepInt
  | StepTyped
  | StepRaw
  | typeof DERIVED_TOKEN
  | readonly StepValue[]

/** `*` — attribute re-declared as derived in a subtype. */
export const DERIVED: typeof DERIVED_TOKEN = DERIVED_TOKEN
export const enumValue = (value: string) => new StepEnum(value)
export const int = (value: number) => new StepInt(Math.round(value))
export const typed = (type: string, value: StepValue) => new StepTyped(type, value)
/** Pre-serialized attribute text, for large aggregates built in a tight loop. */
export const raw = (text: string) => new StepRaw(text)

export function formatReal(value: number, decimals = 9): string {
  if (!Number.isFinite(value)) return '0.'
  const scale = 10 ** decimals
  let rounded = Math.round(value * scale) / scale
  if (Object.is(rounded, -0)) rounded = 0
  let text = String(rounded)
  const exponent = text.indexOf('e')
  if (exponent >= 0) {
    const mantissa = text.slice(0, exponent)
    text = `${mantissa.includes('.') ? mantissa : `${mantissa}.`}E${text.slice(exponent + 1)}`
  } else if (!text.includes('.')) {
    text += '.'
  }
  return text
}

/** STEP string literal with ISO 10303-21 escapes for quotes, backslashes and non-ASCII. */
export function formatString(value: string): string {
  let out = "'"
  let wide = ''
  const flushWide = () => {
    if (!wide) return
    out += `\\X2\\${wide}\\X0\\`
    wide = ''
  }
  for (const char of value) {
    const code = char.codePointAt(0)!
    if (code >= 0x20 && code <= 0x7e) {
      flushWide()
      out += char === "'" ? "''" : char === '\\' ? '\\\\' : char
    } else if (code > 0xffff) {
      flushWide()
      out += `\\X4\\${code.toString(16).toUpperCase().padStart(8, '0')}\\X0\\`
    } else {
      wide += code.toString(16).toUpperCase().padStart(4, '0')
    }
  }
  flushWide()
  return `${out}'`
}

export function formatValue(value: StepValue): string {
  if (value === null || value === undefined) return '$'
  if (value === DERIVED_TOKEN) return '*'
  if (typeof value === 'boolean') return value ? '.T.' : '.F.'
  if (typeof value === 'number') return formatReal(value)
  if (typeof value === 'string') return formatString(value)
  if (value instanceof StepRef) return `#${value.id}`
  if (value instanceof StepEnum) return `.${value.value}.`
  if (value instanceof StepInt) return String(value.value)
  if (value instanceof StepRaw) return value.text
  if (value instanceof StepTyped) return `${value.type}(${formatValue(value.value)})`
  return `(${(value as readonly StepValue[]).map(formatValue).join(',')})`
}

export interface StepHeader {
  description: string
  fileName: string
  timestamp: string
  author: string
  organization: string
  preprocessor: string
  originatingSystem: string
  schema: string
}

export class StepWriter {
  private readonly lines: string[] = []
  private readonly shared = new Map<string, StepRef>()
  private nextId = 1
  readonly counts = new Map<string, number>()

  add(type: string, ...args: StepValue[]): StepRef {
    const ref = new StepRef(this.nextId++)
    this.lines.push(`#${ref.id}=${type}(${args.map(formatValue).join(',')});`)
    this.counts.set(type, (this.counts.get(type) ?? 0) + 1)
    return ref
  }

  /** Reuse one entity for identical simple values (points, directions, styles). */
  addShared(type: string, ...args: StepValue[]): StepRef {
    const key = `${type}(${args.map(formatValue).join(',')})`
    const existing = this.shared.get(key)
    if (existing) return existing
    const ref = this.add(type, ...args)
    this.shared.set(key, ref)
    return ref
  }

  serialize(header: StepHeader): string {
    const head = [
      'ISO-10303-21;',
      'HEADER;',
      `FILE_DESCRIPTION((${formatString(header.description)}),'2;1');`,
      `FILE_NAME(${[
        formatString(header.fileName),
        formatString(header.timestamp),
        `(${formatString(header.author)})`,
        `(${formatString(header.organization)})`,
        formatString(header.preprocessor),
        formatString(header.originatingSystem),
        "''",
      ].join(',')});`,
      `FILE_SCHEMA((${formatString(header.schema)}));`,
      'ENDSEC;',
      'DATA;',
    ]
    return `${[...head, ...this.lines, 'ENDSEC;', 'END-ISO-10303-21;'].join('\n')}\n`
  }
}
