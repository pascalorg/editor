import { z } from 'zod'
import type { AgentToolContract } from './contract'

/**
 * The inventory behind the one-notation rule (`measurement()`, `roofPitch()`), for every set of
 * contracts that keeps it: core's and each plugin's notation test read their fields through these,
 * so the rule is enforced the same way wherever a tool is declared.
 */

/** The schema a field holds once optional, nullable, defaulted and preprocessed wrappers are off. */
function unwrap(schema: z.ZodType): z.ZodType {
  if (
    schema instanceof z.ZodOptional ||
    schema instanceof z.ZodNullable ||
    schema instanceof z.ZodDefault
  )
    return unwrap(schema.unwrap() as z.ZodType)
  // A nested argument some models send as a JSON string, parsed before it is read.
  if (schema instanceof z.ZodPipe && schema.in instanceof z.ZodTransform)
    return unwrap(schema.out as z.ZodType)
  return schema
}

/** A field of an object, or of the object among a union's options that has it. */
function member(schema: z.ZodType, name: string): z.ZodType | undefined {
  const inner = unwrap(schema)
  if (inner instanceof z.ZodObject) return inner.shape[name] as z.ZodType | undefined
  if (inner instanceof z.ZodUnion)
    for (const option of inner.options as z.ZodType[]) {
      const field = member(option, name)
      if (field) return field
    }
}

/** The schema of one field of a contract, by its path: `patch.thickness`, `walls[].along[]`. */
export function fieldSchema(contract: AgentToolContract, path: string): z.ZodType {
  let schema: z.ZodType = z.object(contract.input)
  for (const step of path.split('.')) {
    const [name, ...arrays] = step.split('[]')
    const field = member(schema, name!)
    if (!field) throw new Error(`${contract.name} has no field ${path}`)
    schema = field
    for (const _ of arrays) schema = (unwrap(schema) as z.ZodArray<z.ZodType>).element
  }
  return schema
}

type JsonSchema = {
  type?: string | string[]
  const?: unknown
  anyOf?: JsonSchema[]
  properties?: Record<string, JsonSchema>
  items?: JsonSchema
  additionalProperties?: JsonSchema | boolean
}

/** The paths of the plain numbers a schema takes by name (not in a list, not whole numbers). */
function namedNumbers(schema: JsonSchema, path: string): string[] {
  if (schema.anyOf) return schema.anyOf.flatMap((branch) => namedNumbers(branch, path))
  const types = [schema.type ?? []].flat()
  if (types.includes('number'))
    return types.includes('string') || schema.const !== undefined ? [] : [path]
  const fields = Object.entries(schema.properties ?? {}).flatMap(([key, field]) =>
    namedNumbers(field, path ? `${path}.${key}` : key),
  )
  const items = schema.items?.properties ? namedNumbers(schema.items, `${path}[]`) : []
  const values =
    typeof schema.additionalProperties === 'object'
      ? namedNumbers(schema.additionalProperties, `${path}{}`)
      : []
  return [...fields, ...items, ...values]
}

/**
 * Every number the contracts take by name as a bare number, as `tool.path`: what is neither a
 * `measurement()` nor a `roofPitch()`. Numbers in a list (points, rectangles, outlines) and whole
 * numbers (counts, pages, pixels) are left out; each path left must be a coordinate, a fraction or
 * a ratio, which a notation test lists.
 */
export function bareNumberPaths(contracts: readonly AgentToolContract[]): string[] {
  return contracts.flatMap((tool) =>
    namedNumbers(z.toJSONSchema(z.object(tool.input), { io: 'input' }) as JsonSchema, '').map(
      (path) => `${tool.name}.${path}`,
    ),
  )
}

/** The defaulted fields of a schema, with their paths. */
function defaults(schema: z.ZodType, path: string): [string, z.ZodDefault][] {
  const own: [string, z.ZodDefault][] = schema instanceof z.ZodDefault ? [[path, schema]] : []
  const inner = unwrap(schema)
  const nested =
    inner instanceof z.ZodObject
      ? Object.entries(inner.shape).flatMap(([key, field]) =>
          defaults(field as z.ZodType, path ? `${path}.${key}` : key),
        )
      : inner instanceof z.ZodArray
        ? defaults(inner.element as z.ZodType, `${path}[]`)
        : inner instanceof z.ZodUnion
          ? (inner.options as z.ZodType[]).flatMap((option) => defaults(option, path))
          : []
  return [...own, ...nested]
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
        if (json.default !== undefined) return false
        const said = json.description ?? ''
        return !/\bdefault\b/i.test(said) || !said.includes(String(field.def.defaultValue))
      })
      .map(([path]) => `${tool.name}.${path}`),
  )
}
