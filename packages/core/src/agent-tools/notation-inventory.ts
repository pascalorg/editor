import { z } from 'zod'
import type { AgentToolContract } from './contract'

/**
 * The inventory behind the one-notation rule (`measurement()`, `roofPitch()`), for every set of
 * contracts that keeps it: core's and each plugin's notation test read their fields through these,
 * so the rule is enforced the same way wherever a tool is declared.
 */

/** The schema inside one optional, nullable, defaulted or preprocessed wrapper, if `schema` is one. */
function inside(schema: z.ZodType): z.ZodType | undefined {
  if (
    schema instanceof z.ZodOptional ||
    schema instanceof z.ZodNullable ||
    schema instanceof z.ZodDefault
  )
    return schema.unwrap() as z.ZodType
  // A nested argument some models send as a JSON string, parsed before it is read.
  if (schema instanceof z.ZodPipe && schema.in instanceof z.ZodTransform)
    return schema.out as z.ZodType
}

/** The schema a field holds once its wrappers are off. */
function unwrap(schema: z.ZodType): z.ZodType {
  const inner = inside(schema)
  return inner ? unwrap(inner) : schema
}

/** The field at the end of `steps`, through whichever option of a union has the whole path. */
function resolve(schema: z.ZodType, steps: string[]): z.ZodType | undefined {
  if (steps.length === 0) return schema
  const inner = unwrap(schema)
  if (inner instanceof z.ZodUnion)
    return (inner.options as z.ZodType[]).reduce<z.ZodType | undefined>(
      (found, option) => found ?? resolve(option, steps),
      undefined,
    )
  if (!(inner instanceof z.ZodObject)) return undefined
  const [step, ...rest] = steps
  const [name, ...arrays] = step!.split('[]')
  let field = inner.shape[name!] as z.ZodType | undefined
  for (const _ of arrays) {
    const list = field && unwrap(field)
    field = list instanceof z.ZodArray ? (list.element as z.ZodType) : undefined
  }
  return field && resolve(field, rest)
}

/** The schema of one field of a contract, by its path: `patch.thickness`, `walls[].along[]`. */
export function fieldSchema(contract: AgentToolContract, path: string): z.ZodType {
  const field = resolve(z.object(contract.input), path.split('.'))
  if (!field) throw new Error(`${contract.name} has no field ${path}`)
  return field
}

type JsonSchema = {
  type?: string | string[]
  const?: unknown
  anyOf?: JsonSchema[]
  oneOf?: JsonSchema[]
  properties?: Record<string, JsonSchema>
  items?: JsonSchema
  additionalProperties?: JsonSchema | boolean
}

/**
 * The paths of the plain numbers a schema takes by name. A number in a list is left out (a point,
 * a rectangle, an outline), not the named numbers of the objects a list holds; whole numbers
 * (counts, pages, pixels) are `integer`, not `number`.
 */
function namedNumbers(schema: JsonSchema, path: string, named: boolean): string[] {
  const options = schema.anyOf ?? schema.oneOf
  if (options) return options.flatMap((option) => namedNumbers(option, path, named))
  const types = [schema.type ?? []].flat()
  if (types.includes('number'))
    return named && !types.includes('string') && schema.const === undefined ? [path] : []
  const fields = Object.entries(schema.properties ?? {}).flatMap(([key, field]) =>
    namedNumbers(field, path ? `${path}.${key}` : key, true),
  )
  const items = schema.items ? namedNumbers(schema.items, `${path}[]`, false) : []
  const values =
    typeof schema.additionalProperties === 'object'
      ? namedNumbers(schema.additionalProperties, `${path}{}`, true)
      : []
  return [...fields, ...items, ...values]
}

/**
 * Every number the contracts take by name as a bare number, as `tool.path`: what is neither a
 * `measurement()` nor a `roofPitch()`. Each must be a coordinate, a fraction or a ratio, which a
 * notation test lists.
 */
export function bareNumberPaths(contracts: readonly AgentToolContract[]): string[] {
  return contracts.flatMap((tool) =>
    namedNumbers(z.toJSONSchema(z.object(tool.input), { io: 'input' }) as JsonSchema, '', true).map(
      (path) => `${tool.name}.${path}`,
    ),
  )
}

/** The defaulted fields of a schema, with their paths, at whatever depth of wrappers. */
function defaults(schema: z.ZodType, path: string): [string, z.ZodDefault][] {
  const own: [string, z.ZodDefault][] = schema instanceof z.ZodDefault ? [[path, schema]] : []
  const wrapped = inside(schema)
  if (wrapped) return [...own, ...defaults(wrapped, path)]
  if (schema instanceof z.ZodObject)
    return Object.entries(schema.shape).flatMap(([key, field]) =>
      defaults(field as z.ZodType, path ? `${path}.${key}` : key),
    )
  if (schema instanceof z.ZodArray) return defaults(schema.element as z.ZodType, `${path}[]`)
  if (schema instanceof z.ZodUnion)
    return (schema.options as z.ZodType[]).flatMap((option) => defaults(option, path))
  return []
}

/** Whether a description states this default: "Default 18 in.", "default: 6:12", "Default []". */
function states(description: string, value: unknown): boolean {
  const said = typeof value === 'object' ? JSON.stringify(value) : String(value)
  const escaped = said.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`\\bdefault:?\\s+${escaped}(?!\\w|\\.\\d)`, 'i').test(description)
}

/**
 * Every defaulted field whose default the model is not shown, as `tool.path`: its input JSON
 * Schema has no `default` (a field that converts loses it) and its description does not state it.
 */
export function unshownDefaultPaths(contracts: readonly AgentToolContract[]): string[] {
  return contracts.flatMap((tool) =>
    defaults(z.object(tool.input), '')
      .filter(([, field]) => {
        const json = z.toJSONSchema(field, { io: 'input' }) as {
          default?: unknown
          description?: string
        }
        return json.default === undefined && !states(json.description ?? '', field.def.defaultValue)
      })
      .map(([path]) => `${tool.name}.${path}`),
  )
}
