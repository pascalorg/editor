import type { z } from 'zod'

/**
 * Walks a zod schema's AST and returns every persisted path that could hold a
 * reference (R3 coverage). A candidate is a leaf whose field name ends in
 * `Id`/`Ids`, is `id` below the root, `children` or `members`, or names a URL,
 * `src`, thumbnail or material preset; any typed-id (`template_literal`) or `custom`
 * leaf; every record key; and every string-like record value. The inventory
 * must classify each candidate as a reference or a declared non-reference, so
 * a new id-like field cannot land without a policy. Beside a field ending in
 * `Id`, host-derived siblings (`side`, `wallT`, `offset`, `*Face`, `*UV`,
 * `*Edge`, `*EdgeRange`) of any type are candidates too: they must be listed
 * as `dependents` of the reference they follow.
 *
 * Paths use the `ReferencePath` grammar: tuple and array elements are `[]`,
 * record values `*`, record keys `@key`; union branches merge.
 */
export function discoverReferenceCandidates(schema: z.ZodType): string[] {
  const found = new Set<string>()
  walk(schema, '', '', found, new Set())
  return [...found].sort()
}

type Def = {
  type: string
  innerType?: z.ZodType
  in?: z.ZodType
  getter?: () => z.ZodType
  shape?: Record<string, z.ZodType>
  element?: z.ZodType
  items?: z.ZodType[]
  rest?: z.ZodType | null
  keyType?: z.ZodType
  valueType?: z.ZodType
  options?: z.ZodType[]
  left?: z.ZodType
  right?: z.ZodType
}

const defOf = (schema: z.ZodType): Def => (schema as unknown as { _zod: { def: Def } })._zod.def

const WRAPPERS = new Set([
  'optional',
  'default',
  'prefault',
  'nullable',
  'readonly',
  'nonoptional',
  'catch',
])
const STRING_LIKE = new Set(['string', 'template_literal', 'custom', 'unknown', 'any'])
/** A field naming another node, whose siblings may be host-derived (`wallId`). */
const HOST_REFERENCE = /[a-z]Id$/
/** Host-derived fields beside a host reference: side, face, station, UV, edge. */
const DEPENDENT = /^(?:side|wallT|offset)$|[a-z]Face$|UV$|[a-z]Edge$|EdgeRange$/
const NAMED =
  /(^|[a-z])Ids?$|^children$|^members$|^url$|Url$|^src$|^thumbnail$|^materialPreset$|MaterialPreset$/

function walk(
  schema: z.ZodType,
  path: string,
  field: string,
  found: Set<string>,
  seen: Set<z.ZodType>,
): void {
  const def = defOf(schema)
  if (WRAPPERS.has(def.type)) {
    walk(def.innerType!, path, field, found, seen)
    return
  }
  switch (def.type) {
    case 'pipe':
      walk(def.in!, path, field, found, seen)
      return
    case 'lazy':
      if (seen.has(schema)) return
      seen.add(schema)
      walk(def.getter!(), path, field, found, seen)
      return
    case 'object': {
      const keys = Object.keys(def.shape!)
      const hostsReference = keys.some((key) => HOST_REFERENCE.test(key))
      for (const [key, value] of Object.entries(def.shape!)) {
        const child = path ? `${path}.${key}` : key
        if (hostsReference && DEPENDENT.test(key)) found.add(child)
        else walk(value, child, key, found, seen)
      }
      return
    }
    case 'array':
      walk(def.element!, `${path}[]`, field, found, seen)
      return
    case 'tuple':
      for (const item of def.items!) walk(item, `${path}[]`, field, found, seen)
      if (def.rest) walk(def.rest, `${path}[]`, field, found, seen)
      return
    case 'record':
      found.add(`${path}.@key`)
      walk(def.valueType!, `${path}.*`, '*', found, seen)
      return
    case 'union':
      for (const option of def.options!) walk(option, path, field, found, seen)
      return
    case 'intersection':
      walk(def.left!, path, field, found, seen)
      walk(def.right!, path, field, found, seen)
      return
  }
  if (!STRING_LIKE.has(def.type)) return
  const nested = path.includes('.') || path.includes('[')
  if (
    def.type === 'template_literal' ||
    def.type === 'custom' ||
    field === '*' ||
    NAMED.test(field) ||
    (field === 'id' && nested)
  ) {
    found.add(path)
  }
}

/** Index of the bracket closing the one at `open`, or -1. */
function closing(text: string, open: number): number {
  let level = 0
  for (let i = open; i < text.length; i++) {
    const c = text[i]
    if (c === '{' || c === '[' || c === '(') level++
    else if (c === '}' || c === ']' || c === ')') {
      level--
      if (level === 0) return i
    }
  }
  return -1
}

const ARRAY_METHODS = /^(?:length|map|filter|some|every|find|includes|forEach|entries|keys|values)$/

/**
 * Metadata keys a source file reads or writes (R3 coverage for `metadata.*`,
 * which the schema types as an open record). Static and conservative:
 * - reads: `metadata.a.b`, `metadata?.a`, `(x.metadata as T)?.a`,
 *   `metadataRecord(x.metadata).a`, `metadata[CONST]`, `metadata['a']`;
 * - writes: object literals after `metadata:` / `metadata =`, object-literal
 *   arguments of a call there, literals returned by a function whose name
 *   contains `metadata`, and literals bound to a shorthand or identifier
 *   value, recursively (`a.b` paths);
 * - computed keys resolve through same-file `const NAME = 'key'`.
 * Every key found must be classified, so an unclassified metadata reference
 * cannot land unnoticed.
 */
export function discoverMetadataKeys(source: string): string[] {
  const text = source.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (m) => ' '.repeat(m.length))
  const constants = new Map<string, string>()
  for (const m of text.matchAll(/\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*['"]([^'"]+)['"]/g))
    constants.set(m[1]!, m[2]!)
  const found = new Set<string>()

  const readAt = (index: number) => {
    let i = index
    const path: string[] = []
    for (;;) {
      const rest = text.slice(i, i + 200)
      const cast = rest.match(/^\s+as\s+[^)\n;]*\)/) ?? rest.match(/^\s*\)/)
      if (cast && path.length === 0) {
        i += cast[0].length
        continue
      }
      const dot = rest.match(/^\s*\??\.\s*([A-Za-z_$][\w$]*)/)
      const bracket = rest.match(
        /^\s*(?:\?\.)?\[\s*(?:'([^']+)'|"([^"]+)"|([A-Za-z_$][\w$]*))\s*\]/,
      )
      if (dot && !ARRAY_METHODS.test(dot[1]!)) {
        path.push(dot[1]!)
        i += dot[0].length
      } else if (bracket) {
        const key = bracket[1] ?? bracket[2] ?? constants.get(bracket[3]!)
        if (!key) break
        path.push(key)
        i += bracket[0].length
      } else break
    }
    if (path.length > 0) found.add(path.join('.'))
  }

  const literalAt = (open: number, prefix: string, depth: number) => {
    const end = closing(text, open)
    if (end < 0 || depth > 4) return
    let level = 0
    for (let i = open; i < end; i++) {
      const c = text[i]
      if (c === '{' || c === '[' || c === '(') level++
      else if (c === '}' || c === ']' || c === ')') level--
      if (!(level === 1 && (c === '{' || c === ','))) continue
      const spread = text.slice(i + 1, i + 40).match(/^\s*\.\.\.\s*\(/)
      if (spread) {
        const group = i + 1 + spread[0].length - 1
        const groupEnd = closing(text, group)
        for (let j = group + 1, inner = 0; j < groupEnd; j++) {
          const d = text[j]
          if (inner === 0 && d === '{') literalAt(j, prefix, depth + 1)
          if (d === '{' || d === '(' || d === '[') inner++
          else if (d === '}' || d === ')' || d === ']') inner--
        }
        continue
      }
      const entry = text
        .slice(i + 1, end + 1)
        .match(
          /^\s*(?:\[\s*([A-Za-z_$][\w$]*)\s*\]|'([^']+)'|"([^"]+)"|([A-Za-z_$][\w$]*))\s*(:|,|\})/,
        )
      if (!entry) continue
      const key = entry[1] ? constants.get(entry[1]) : (entry[2] ?? entry[3] ?? entry[4])
      if (!key) continue
      const path = prefix ? `${prefix}.${key}` : key
      found.add(path)
      const after = i + 1 + entry[0].length
      if (entry[5] !== ':') {
        boundLiteral(key, path, depth + 1)
        continue
      }
      const value = text.slice(after, end).match(/^\s*(\{|[A-Za-z_$][\w$]*)(\s*[,}\n])?/)
      if (value?.[1] === '{') literalAt(after + value[0].indexOf('{'), path, depth + 1)
      else if (value?.[1] && value[2]) boundLiteral(value[1], path, depth + 1)
    }
  }

  const boundLiteral = (name: string, prefix: string, depth: number) => {
    const decl = new RegExp(
      `\\b(?:const|let)\\s+${name.replace(/\$/g, '\\$')}\\s*(?::[^=]+)?=`,
    ).exec(text)
    if (!decl) return
    const start = decl.index + decl[0].length
    const init = text.slice(start, start + 400)
    const stop = init.search(/;|\n\s*\n|\n\s*(?:const|let|return|if)\b/)
    const body = stop < 0 ? init : init.slice(0, stop)
    const brace = body.indexOf('{')
    // A literal, possibly behind a condition; never the argument of a call.
    if (brace >= 0 && !/[A-Za-z_$][\w$]*\s*\(|=>|\bfunction\b|\bnew\b/.test(body.slice(0, brace)))
      literalAt(start + brace, prefix, depth)
  }

  const callArguments = (open: number) => {
    const end = closing(text, open)
    let level = 0
    for (let i = open; i < end; i++) {
      const c = text[i]
      if (level === 1 && c === '{') literalAt(i, '', 0)
      if (c === '{' || c === '[' || c === '(') level++
      else if (c === '}' || c === ']' || c === ')') level--
    }
  }

  // Blank string contents so prose that says "metadata" is not a read.
  const code = text.replace(
    /'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|`(?:\\.|[^`\\])*`/g,
    (m) => m[0] + ' '.repeat(m.length - 2) + m[0],
  )
  for (const m of code.matchAll(/\bmetadata\b/g)) {
    const index = m.index! + m[0].length
    readAt(index)
    const write = text.slice(index, index + 200).match(/^\??\s*(?::|=(?![=>]))\s*/)
    if (!write) continue
    const at = index + write[0].length
    if (text[at] === '{') literalAt(at, '', 0)
    else if (write[0].includes(':')) {
      const call = text.slice(at, at + 120).match(/^[A-Za-z_$][\w$.]*\s*\(/)
      if (call) callArguments(at + call[0].length - 1)
    }
  }
  for (const m of text.matchAll(/function\s+\w*[Mm]etadata\w*\s*\(/g)) {
    const params = closing(text, m.index! + m[0].length - 1)
    const body = text.indexOf('{', params)
    const bodyEnd = closing(text, body)
    let level = 0
    for (let i = body; i < bodyEnd; i++) {
      const c = text[i]
      if (c === '{' || c === '(' || c === '[') level++
      else if (c === '}' || c === ')' || c === ']') level--
      else if (level === 1 && text.startsWith('return', i)) {
        const r = text.slice(i, i + 40).match(/^return\s*\{/)
        if (r) literalAt(i + r[0].length - 1, '', 0)
      }
    }
  }
  return [...found].sort()
}
