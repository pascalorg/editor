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
 * `*Edge`, `*EdgeRange`, any non-id `host*`) of any type are candidates too:
 * they must be listed as `dependents` of the reference they follow.
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
/**
 * Host-derived fields beside a host reference: side, face, station, UV, edge,
 * and any other `host*` field that is not itself an id.
 */
const DEPENDENT =
  /^(?:side|wallT|offset)$|[a-z]Face$|UV$|[a-z]Edge$|EdgeRange$|^host(?!.*Ids?$)[A-Z]/
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
