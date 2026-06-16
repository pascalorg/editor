import type { AssemblyComposeInput } from './assembly-compose'
import type { UserGeometryConstraints } from './assembly-constraints'
import { composePartPrimitives, type PartComposePartInput } from './part-compose'
import type { PrimitiveShapeInput } from './primitive-compose'

type TemplateScope = Record<string, number | string | boolean | undefined>

type TemplateValue = string | number | boolean

export type AssemblyTemplatePartSpec = {
  kind: string
  count?: TemplateValue
  fields?: Record<string, TemplateValue>
}

export type AssemblyTemplateStyleVariant = {
  match?: string[]
  lengthScale?: number
  widthRatio?: number
  heightRatio?: number
  values?: Record<string, TemplateValue>
}

export type AssemblyTemplateConfig = {
  family: string
  defaultDimensions: {
    length: number
    widthRatio: number
    heightRatio: number
  }
  defaultStyle: string
  styleVariants?: Record<string, AssemblyTemplateStyleVariant>
  parts: AssemblyTemplatePartSpec[]
}

export const VEHICLE_ASSEMBLY_TEMPLATE: AssemblyTemplateConfig = {
  family: 'vehicle',
  defaultDimensions: {
    length: 4.4,
    widthRatio: 0.42,
    heightRatio: 0.32,
  },
  defaultStyle: 'sedan',
  styleVariants: {
    suv: {
      match: ['suv', 'offroad'],
      heightRatio: 0.38,
      widthRatio: 0.43,
      values: { cabinTopScale: 0.84 },
    },
    truck: {
      match: ['truck', 'pickup'],
      lengthScale: 1.1818181818,
      widthRatio: 0.43,
      values: { cabinTopScale: 0.84 },
    },
    van: {
      match: ['van', 'mpv', 'bus'],
      heightRatio: 0.36,
      values: { cabinTopScale: 0.88 },
    },
    sports: {
      match: ['sport', 'race'],
      heightRatio: 0.26,
      values: { cabinTopScale: 0.7 },
    },
    sedan: {
      values: { cabinTopScale: 0.84 },
    },
  },
  parts: [
    {
      kind: 'body_shell',
      fields: {
        semanticRole: 'vehicle_body',
        vehicleStyle: '$style',
        length: 'length',
        width: 'width',
        height: 'height',
        primaryColor: '$primaryColor',
        cornerRadius: 'min(length, width, height) * 0.08',
        cornerSegments: 8,
        cabinTopScale: 'cabinTopScale',
      },
    },
    { kind: 'wheel_set', fields: { count: 4, semanticRole: 'vehicle_tire' } },
    {
      kind: 'window_strip',
      fields: { semanticRole: 'vehicle_window', variant: 'vehicle_glasshouse' },
    },
    { kind: 'light_pair', fields: { semanticRole: 'headlight' } },
    { kind: 'bar_pair' },
    { kind: 'seam_ring' },
    { kind: 'nameplate' },
  ],
}

const ASSEMBLY_TEMPLATES: Record<string, AssemblyTemplateConfig> = {
  vehicle: VEHICLE_ASSEMBLY_TEMPLATE,
}

export function getAssemblyTemplate(family: string): AssemblyTemplateConfig | undefined {
  return ASSEMBLY_TEMPLATES[family]
}

export function resolveAssemblyTemplateStyle(
  config: AssemblyTemplateConfig,
  input: AssemblyComposeInput,
  constraints: UserGeometryConstraints,
): string {
  const text =
    `${input.family ?? ''} ${input.object ?? ''} ${input.name ?? ''} ${input.variant ?? ''} ${
      input.style ?? ''
    } ${constraints.style ?? ''} ${input.prompt ?? ''}`.toLowerCase()
  for (const [style, variant] of Object.entries(config.styleVariants ?? {})) {
    if (style === config.defaultStyle) continue
    if (variant.match?.some((token) => text.includes(token.toLowerCase()))) return style
  }
  return config.defaultStyle
}

export function composeAssemblyTemplateParts(
  config: AssemblyTemplateConfig,
  input: AssemblyComposeInput,
  constraints: UserGeometryConstraints,
  options: {
    primaryColor: string
    sizeScale: number
  },
): PartComposePartInput[] {
  const style = resolveAssemblyTemplateStyle(config, input, constraints)
  const variant = config.styleVariants?.[style]
  const length =
    constraints.length?.value ??
    numberValue(input.length, input.params?.length) ??
    round(config.defaultDimensions.length * options.sizeScale * (variant?.lengthScale ?? 1))
  const width =
    constraints.width?.value ??
    numberValue(input.width, input.params?.width) ??
    round(length * (variant?.widthRatio ?? config.defaultDimensions.widthRatio))
  const height =
    constraints.height?.value ??
    numberValue(input.height, input.params?.height) ??
    round(length * (variant?.heightRatio ?? config.defaultDimensions.heightRatio))
  const scope: TemplateScope = {
    style,
    length,
    width,
    height,
    primaryColor: options.primaryColor,
    ...(variant?.values ?? {}),
  }

  return config.parts.map((part) => {
    const fields = resolveTemplateFields(part.fields ?? {}, scope)
    return {
      kind: part.kind,
      ...(part.count != null ? { count: numberFromTemplateValue(part.count, scope) } : {}),
      ...fields,
    }
  })
}

export function composeAssemblyFromConfig(
  config: AssemblyTemplateConfig,
  input: AssemblyComposeInput,
  constraints: UserGeometryConstraints,
  options: {
    primaryColor: string
    sizeScale: number
  },
): PrimitiveShapeInput[] {
  return composePartPrimitives({
    name: input.name ?? input.object ?? input.prompt ?? config.family,
    position: input.position,
    detail: 'high',
    primaryColor: options.primaryColor,
    darkColor: input.darkColor ?? '#111827',
    metalColor: input.metalColor ?? '#cbd5e1',
    accentColor: input.secondaryColor ?? '#2563eb',
    enhanceVisualDetails: true,
    parts: composeAssemblyTemplateParts(config, input, constraints, options),
  })
}

function resolveTemplateFields(
  fields: Record<string, TemplateValue>,
  scope: TemplateScope,
): Record<string, string | number | boolean> {
  return Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [key, resolveTemplateValue(value, scope)]),
  )
}

function resolveTemplateValue(
  value: TemplateValue,
  scope: TemplateScope,
): string | number | boolean {
  if (typeof value !== 'string') return value
  if (value.startsWith('$')) return stringFromScope(value.slice(1), scope)
  const numeric = evaluateTemplateExpression(value, scope)
  return numeric ?? value
}

function numberFromTemplateValue(value: TemplateValue, scope: TemplateScope): number | undefined {
  if (typeof value === 'number') return value
  if (typeof value !== 'string') return undefined
  return evaluateTemplateExpression(value, scope)
}

function evaluateTemplateExpression(expression: string, scope: TemplateScope): number | undefined {
  const trimmed = expression.trim()
  if (!trimmed) return undefined
  const literal = Number(trimmed)
  if (Number.isFinite(literal)) return literal
  if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(trimmed)) return numberFromScope(trimmed, scope)

  const multiplyTerms = trimmed.split('*').map((term) => term.trim())
  if (multiplyTerms.length > 1) {
    const values = multiplyTerms.map((term) => evaluateTemplateExpression(term, scope))
    if (values.every((value): value is number => value != null)) {
      return values.reduce((product, value) => product * value, 1)
    }
  }

  const minMatch = trimmed.match(/^min\((.+)\)$/)
  if (minMatch?.[1]) {
    const values = minMatch[1]
      .split(',')
      .map((term) => evaluateTemplateExpression(term.trim(), scope))
    if (values.every((value): value is number => value != null)) return Math.min(...values)
  }

  const maxMatch = trimmed.match(/^max\((.+)\)$/)
  if (maxMatch?.[1]) {
    const values = maxMatch[1]
      .split(',')
      .map((term) => evaluateTemplateExpression(term.trim(), scope))
    if (values.every((value): value is number => value != null)) return Math.max(...values)
  }

  return undefined
}

function numberFromScope(key: string, scope: TemplateScope): number | undefined {
  const value = scope[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function stringFromScope(key: string, scope: TemplateScope): string {
  const value = scope[key]
  return typeof value === 'string' ? value : ''
}

function numberValue(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return value
  }
  return undefined
}

function round(value: number): number {
  return Number(value.toFixed(3))
}
