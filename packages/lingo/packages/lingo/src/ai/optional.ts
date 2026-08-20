import { createField, type LingoField } from './standard-schema'

/**
 * Make a lingo field nullable for strict tool-argument schemas. `null` and
 * `undefined` validate to `null`; all other values delegate to the wrapped
 * field. Inside `lingoObject()`, the key remains required while its type
 * admits `null`.
 * @example
 * ```ts
 * import { lingoObject, optional, quantityField } from '@pascal-app/lingo/ai'
 * const args = lingoObject({ weight: optional(quantityField({ kind: 'mass', unit: 'kg' })) })
 * args.parse({}) // { weight: null }
 * args.parse({ weight: '2 lbs' }).weight // 0.90718474
 * ```
 */
export function optional<Output>(field: LingoField<Output>): LingoField<Output | null> {
  return createField<Output | null>(
    (value) => {
      if (value === null || value === undefined) {
        return { value: null }
      }
      return field.safeParse(value)
    },
    {
      input: (options) => nullableSchema(field['~standard'].jsonSchema.input(options)),
      output: (options) => nullableSchema(field['~standard'].jsonSchema.output(options)),
    },
  )
}

function nullableSchema(base: Record<string, unknown>): Record<string, unknown> {
  if (typeof base.type === 'string' && isScalarType(base.type) && !isStructuredSchema(base)) {
    return { ...base, type: [base.type, 'null'] }
  }
  const schema: Record<string, unknown> = {
    anyOf: [base, { type: 'null' }],
  }
  if (typeof base.description === 'string') {
    schema.description = base.description
  }
  return schema
}

function isStructuredSchema(base: Record<string, unknown>): boolean {
  return 'properties' in base || 'items' in base || 'anyOf' in base
}

function isScalarType(type: string): boolean {
  return type === 'string' || type === 'number' || type === 'integer' || type === 'boolean'
}
