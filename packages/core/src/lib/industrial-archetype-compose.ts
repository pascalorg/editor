import {
  findIndustrialArchetype,
  findIndustrialArchetypeByRecipeId,
  type IndustrialArchetypeEntry,
  type IndustrialArchetypeRecipeId,
} from './industrial-archetype-registry'
import { composePartPrimitives, type PartComposeInput } from './part-compose'
import type { PrimitiveGeometryBrief, PrimitiveShapeInput, Vec3 } from './primitive-compose'
import { type RecipeDimensionParams, resolveRecipeDimensions } from './recipe-dimensions'

export interface IndustrialArchetypeComposeInput extends RecipeDimensionParams {
  recipeId?: IndustrialArchetypeRecipeId | string
  name?: string
  color?: string
  primaryColor?: string
  accentColor?: string
  darkColor?: string
  metalColor?: string
  detail?: PartComposeInput['detail'] | string
  highFidelity?: boolean
  enhanceVisualDetails?: boolean
  position?: Vec3
  archetypeId?: string
  archetype?: string
  variant?: string
  style?: string
  params?: IndustrialArchetypeComposeInput
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function industrialComposeParams(
  input: IndustrialArchetypeComposeInput,
): IndustrialArchetypeComposeInput {
  return isRecord(input.params) ? { ...input, ...input.params } : input
}

function textOf(value: unknown): string {
  if (typeof value === 'string') return value.toLowerCase()
  if (Array.isArray(value)) return value.map(textOf).join(' ')
  if (typeof value === 'object' && value !== null) return Object.values(value).map(textOf).join(' ')
  return ''
}

function stringValue(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value
  }
  return undefined
}

function nameFor(input: IndustrialArchetypeComposeInput, fallback: string): string {
  const params = industrialComposeParams(input)
  return stringValue(params.name, input.name, fallback) ?? fallback
}

function colorFor(params: IndustrialArchetypeComposeInput, fallback: string): string {
  return stringValue(params.primaryColor, params.color, fallback) ?? fallback
}

function detailFor(params: IndustrialArchetypeComposeInput): PartComposeInput['detail'] {
  return stringValue(
    params.detail,
    params.highFidelity || params.enhanceVisualDetails ? 'high' : undefined,
  ) as PartComposeInput['detail']
}

function positionFor(
  params: IndustrialArchetypeComposeInput,
  input: IndustrialArchetypeComposeInput,
) {
  return params.position ?? input.position ?? [0, 0, 0]
}

function materialPalette(params: IndustrialArchetypeComposeInput) {
  return {
    body: { properties: { color: colorFor(params, '#64748b'), roughness: 0.46, metalness: 0.42 } },
    dark: {
      properties: {
        color: stringValue(params.darkColor, '#1f2937') ?? '#1f2937',
        roughness: 0.58,
        metalness: 0.25,
      },
    },
    metal: {
      properties: {
        color: stringValue(params.metalColor, '#cbd5e1') ?? '#cbd5e1',
        roughness: 0.32,
        metalness: 0.78,
      },
    },
    accent: {
      properties: {
        color: stringValue(params.accentColor, '#2563eb') ?? '#2563eb',
        roughness: 0.38,
        metalness: 0.2,
      },
    },
    glass: {
      properties: {
        color: '#7dd3fc',
        roughness: 0.12,
        metalness: 0.02,
        opacity: 0.38,
        transparent: true,
      },
    },
  }
}

function resolveEntry(
  recipeId: IndustrialArchetypeRecipeId,
  input: IndustrialArchetypeComposeInput,
) {
  const params = industrialComposeParams(input)
  const explicit = [params.variant, params.style, params.archetypeId, params.archetype]
    .filter(Boolean)
    .join(' ')
  const requestText = textOf([explicit, params.name, input.name])
  return (
    findIndustrialArchetype(requestText) ??
    findIndustrialArchetypeByRecipeId(recipeId) ??
    findIndustrialArchetypeByRecipeId(recipeId)!
  )
}

function dims(recipeId: IndustrialArchetypeRecipeId, input: IndustrialArchetypeComposeInput) {
  return resolveRecipeDimensions(recipeId, industrialComposeParams(input))
}

function tag(
  shapes: PrimitiveShapeInput[],
  entry: IndustrialArchetypeEntry,
): PrimitiveShapeInput[] {
  return shapes.map((shape) => ({
    ...shape,
    industrialArchetype: entry.archetypeId,
    industrialVariant: entry.variant,
  }))
}

function box(
  name: string,
  semanticRole: string,
  position: Vec3,
  length: number,
  width: number,
  height: number,
  material: PrimitiveShapeInput['material'],
  cornerRadius = Math.min(length, width, height) * 0.08,
): PrimitiveShapeInput {
  return {
    kind: 'box',
    name,
    semanticRole,
    position,
    length,
    width,
    height,
    cornerRadius,
    material,
  }
}

function panel(
  name: string,
  semanticRole: string,
  position: Vec3,
  length: number,
  width: number,
  height: number,
  material: PrimitiveShapeInput['material'],
  rotation?: Vec3,
): PrimitiveShapeInput {
  return {
    kind: 'rounded-panel',
    name,
    semanticRole,
    position,
    rotation,
    length,
    width,
    height,
    cornerRadius: Math.min(length, height) * 0.06,
    material,
  }
}

function cylinder(
  name: string,
  semanticRole: string,
  position: Vec3,
  axis: 'x' | 'y' | 'z',
  radius: number,
  height: number,
  material: PrimitiveShapeInput['material'],
): PrimitiveShapeInput {
  return {
    kind: 'cylinder',
    name,
    semanticRole,
    position,
    axis,
    radius,
    height,
    radialSegments: 32,
    material,
  }
}

function latheBed(entry: IndustrialArchetypeEntry, input: IndustrialArchetypeComposeInput) {
  const params = industrialComposeParams(input)
  const { length: L, width: W, height: H } = dims(entry.recipeId, params)
  const m = materialPalette(params)
  const o = positionFor(params, input)
  const name = nameFor(input, entry.label)
  const workY = H * 0.36
  const rolling = entry.variant === 'thread_rolling_machine'
  return [
    box(
      `${name} machine bed`,
      'machine_bed',
      [o[0], o[1] + H * 0.135, o[2]],
      L * 0.72,
      W * 0.32,
      H * 0.13,
      m.body,
    ),
    box(
      `${name} sloped chip tray`,
      'machine_base',
      [o[0], o[1] + H * 0.035, o[2]],
      L * 0.78,
      W * 0.38,
      H * 0.07,
      m.dark,
    ),
    box(
      `${name} headstock`,
      'headstock',
      [o[0] - L * 0.26, o[1] + workY, o[2]],
      L * 0.14,
      W * 0.28,
      H * 0.22,
      m.body,
    ),
    cylinder(
      `${name} ${rolling ? 'rolling spindle' : 'spindle chuck'}`,
      'spindle_chuck',
      [o[0] - L * 0.18, o[1] + workY + H * 0.02, o[2]],
      'x',
      Math.min(W, H) * 0.065,
      L * (rolling ? 0.08 : 0.035),
      m.dark,
    ),
    box(
      `${name} ${rolling ? 'rolling head' : 'tool post'}`,
      'tool_post',
      [o[0] + L * 0.09, o[1] + workY, o[2] + W * 0.015],
      L * 0.09,
      W * 0.14,
      H * 0.09,
      m.metal,
    ),
    box(
      `${name} front linear rail`,
      'linear_rail',
      [o[0], o[1] + H * 0.24, o[2] - W * 0.12],
      L * 0.5,
      W * 0.018,
      H * 0.014,
      m.metal,
      0,
    ),
    box(
      `${name} rear linear rail`,
      'linear_rail',
      [o[0], o[1] + H * 0.24, o[2] + W * 0.12],
      L * 0.5,
      W * 0.018,
      H * 0.014,
      m.metal,
      0,
    ),
    panel(
      `${name} sliding guard window`,
      'transparent_door',
      [o[0] + L * 0.08, o[1] + H * 0.48, o[2] - W * 0.19],
      L * 0.3,
      W * 0.014,
      H * 0.2,
      m.glass,
    ),
    panel(
      `${name} control panel`,
      'control_panel',
      [o[0] + L * 0.35, o[1] + H * 0.42, o[2] - W * 0.23],
      L * 0.08,
      W * 0.02,
      H * 0.23,
      m.accent,
      [0, 0.22, 0],
    ),
  ]
}

interface MachineToolContext {
  entry: IndustrialArchetypeEntry
  params: IndustrialArchetypeComposeInput
  L: number
  W: number
  H: number
  m: ReturnType<typeof materialPalette>
  o: Vec3
  name: string
}

function machineToolContext(
  entry: IndustrialArchetypeEntry,
  input: IndustrialArchetypeComposeInput,
): MachineToolContext {
  const params = industrialComposeParams(input)
  const { length: L, width: W, height: H } = dims(entry.recipeId, params)
  const m = materialPalette(params)
  const o = positionFor(params, input)
  const name = nameFor(input, entry.label)
  return { entry, params, L, W, H, m, o, name }
}

function bedColumnBase(ctx: MachineToolContext): PrimitiveShapeInput[] {
  const { L, W, H, m, o, name } = ctx
  return [
    box(
      `${name} machine base`,
      'machine_base',
      [o[0], o[1] + H * 0.08, o[2]],
      L * 0.72,
      W * 0.62,
      H * 0.16,
      m.body,
    ),
    box(
      `${name} rear column`,
      'machine_column',
      [o[0] - L * 0.17, o[1] + H * 0.5, o[2] + W * 0.16],
      L * 0.18,
      W * 0.22,
      H * 0.7,
      m.body,
    ),
    box(
      `${name} work table`,
      'work_table',
      [o[0] + L * 0.09, o[1] + H * 0.22, o[2]],
      L * 0.36,
      W * 0.28,
      H * 0.04,
      m.metal,
    ),
    box(
      `${name} spindle head`,
      'spindle_head',
      [o[0] - L * 0.08, o[1] + H * 0.55, o[2]],
      L * 0.14,
      W * 0.16,
      H * 0.16,
      m.dark,
    ),
    box(
      `${name} x linear rail`,
      'linear_rail',
      [o[0] + L * 0.06, o[1] + H * 0.28, o[2] - W * 0.18],
      L * 0.42,
      W * 0.012,
      H * 0.012,
      m.metal,
      0,
    ),
    panel(
      `${name} transparent front door`,
      'transparent_door',
      [o[0] + L * 0.08, o[1] + H * 0.45, o[2] - W * 0.33],
      L * 0.42,
      W * 0.014,
      H * 0.34,
      m.glass,
    ),
    panel(
      `${name} side control panel`,
      'control_panel',
      [o[0] + L * 0.35, o[1] + H * 0.42, o[2] - W * 0.28],
      L * 0.1,
      W * 0.016,
      H * 0.24,
      m.accent,
      [0, -0.16, 0],
    ),
  ]
}

function machiningCenterDetails(ctx: MachineToolContext): PrimitiveShapeInput[] {
  const { L, W, H, m, o, name, entry } = ctx
  const tool =
    entry.variant === 'boring_machine'
      ? 'boring bar'
      : entry.variant === 'machining_center'
        ? 'vertical spindle nose'
        : 'vertical spindle'
  return [
    cylinder(
      `${name} ${tool}`,
      'tool_head',
      [o[0] - L * 0.08, o[1] + H * 0.42, o[2]],
      'y',
      Math.min(W, H) * (entry.variant === 'boring_machine' ? 0.018 : 0.022),
      H * 0.11,
      m.metal,
    ),
  ]
}

function millingDetails(ctx: MachineToolContext): PrimitiveShapeInput[] {
  const { L, W, H, m, o, name } = ctx
  return [
    cylinder(
      `${name} vertical milling spindle nose`,
      'tool_head',
      [o[0] - L * 0.08, o[1] + H * 0.45, o[2]],
      'y',
      Math.min(W, H) * 0.026,
      H * 0.09,
      m.metal,
    ),
    cylinder(
      `${name} fluted end mill cutter`,
      'milling_cutter',
      [o[0] - L * 0.08, o[1] + H * 0.365, o[2]],
      'y',
      Math.min(W, H) * 0.018,
      H * 0.08,
      m.dark,
    ),
    ...[-0.09, 0, 0.09].map((zOffset, index) =>
      box(
        `${name} T-slot table groove ${index + 1}`,
        index === 0 ? 't_slot_table' : 'table_slot',
        [o[0] + L * 0.09, o[1] + H * 0.248, o[2] + W * zOffset],
        L * 0.34,
        W * 0.012,
        H * 0.012,
        m.dark,
        0,
      ),
    ),
    cylinder(
      `${name} table feed handwheel`,
      'feed_handwheel',
      [o[0] + L * 0.3, o[1] + H * 0.25, o[2] - W * 0.18],
      'x',
      Math.min(W, H) * 0.035,
      W * 0.018,
      m.metal,
    ),
  ]
}

function drillPressShapes(ctx: MachineToolContext): PrimitiveShapeInput[] {
  const { L, W, H, m, o, name } = ctx
  return [
    box(
      `${name} heavy drill base`,
      'machine_base',
      [o[0], o[1] + H * 0.06, o[2]],
      L * 0.58,
      W * 0.52,
      H * 0.12,
      m.body,
    ),
    cylinder(
      `${name} round vertical column`,
      'machine_column',
      [o[0] - L * 0.13, o[1] + H * 0.48, o[2]],
      'y',
      Math.min(L, W) * 0.045,
      H * 0.76,
      m.metal,
    ),
    box(
      `${name} lifting work table`,
      'work_table',
      [o[0] + L * 0.08, o[1] + H * 0.28, o[2]],
      L * 0.34,
      W * 0.3,
      H * 0.045,
      m.metal,
    ),
    box(
      `${name} crank lift bracket`,
      'lifting_table',
      [o[0] - L * 0.04, o[1] + H * 0.3, o[2]],
      L * 0.16,
      W * 0.08,
      H * 0.07,
      m.dark,
    ),
    box(
      `${name} radial drill arm`,
      'spindle_head',
      [o[0] + L * 0.03, o[1] + H * 0.66, o[2]],
      L * 0.38,
      W * 0.12,
      H * 0.09,
      m.body,
    ),
    box(
      `${name} drill head`,
      'spindle_head',
      [o[0] + L * 0.16, o[1] + H * 0.55, o[2]],
      L * 0.13,
      W * 0.14,
      H * 0.16,
      m.dark,
    ),
    {
      kind: 'cone',
      name: `${name} tapered drill bit`,
      semanticRole: 'drill_bit',
      position: [o[0] + L * 0.16, o[1] + H * 0.42, o[2]],
      axis: 'y',
      radius: Math.min(W, H) * 0.018,
      height: H * 0.15,
      radialSegments: 24,
      material: m.metal,
    },
    panel(
      `${name} side control panel`,
      'control_panel',
      [o[0] + L * 0.29, o[1] + H * 0.48, o[2] - W * 0.22],
      L * 0.09,
      W * 0.016,
      H * 0.2,
      m.accent,
      [0, -0.16, 0],
    ),
  ]
}

function grinderDetails(ctx: MachineToolContext): PrimitiveShapeInput[] {
  const { L, W, H, m, o, name } = ctx
  return [
    box(
      `${name} magnetic chuck table`,
      'magnetic_chuck',
      [o[0] + L * 0.1, o[1] + H * 0.265, o[2]],
      L * 0.48,
      W * 0.34,
      H * 0.035,
      m.dark,
    ),
    cylinder(
      `${name} grinding wheel`,
      'grinding_wheel',
      [o[0] - L * 0.06, o[1] + H * 0.43, o[2]],
      'x',
      Math.min(W, H) * 0.085,
      W * 0.055,
      m.metal,
    ),
    {
      kind: 'half-cylinder',
      name: `${name} half cover wheel guard`,
      semanticRole: 'wheel_guard',
      position: [o[0] - L * 0.06, o[1] + H * 0.45, o[2] - W * 0.005],
      axis: 'x',
      radius: Math.min(W, H) * 0.105,
      height: W * 0.07,
      radialSegments: 24,
      material: m.dark,
    },
    cylinder(
      `${name} coolant nozzle`,
      'coolant_nozzle',
      [o[0] - L * 0.015, o[1] + H * 0.39, o[2] - W * 0.08],
      'z',
      Math.min(W, H) * 0.012,
      W * 0.16,
      m.metal,
    ),
  ]
}

function planerShapes(ctx: MachineToolContext): PrimitiveShapeInput[] {
  const { L, W, H, m, o, name } = ctx
  return [
    box(
      `${name} long planer bed`,
      'machine_base',
      [o[0], o[1] + H * 0.08, o[2]],
      L * 0.86,
      W * 0.42,
      H * 0.16,
      m.body,
    ),
    box(
      `${name} traveling work table`,
      'work_table',
      [o[0] + L * 0.04, o[1] + H * 0.2, o[2]],
      L * 0.62,
      W * 0.34,
      H * 0.055,
      m.metal,
    ),
    box(
      `${name} left upright`,
      'machine_column',
      [o[0] - L * 0.18, o[1] + H * 0.5, o[2] - W * 0.24],
      L * 0.1,
      W * 0.08,
      H * 0.62,
      m.body,
    ),
    box(
      `${name} right upright`,
      'machine_column',
      [o[0] - L * 0.18, o[1] + H * 0.5, o[2] + W * 0.24],
      L * 0.1,
      W * 0.08,
      H * 0.62,
      m.body,
    ),
    box(
      `${name} adjustable cross rail`,
      'cross_rail',
      [o[0] - L * 0.08, o[1] + H * 0.64, o[2]],
      L * 0.18,
      W * 0.62,
      H * 0.08,
      m.dark,
    ),
    box(
      `${name} reciprocating ram`,
      'reciprocating_ram',
      [o[0] + L * 0.1, o[1] + H * 0.55, o[2]],
      L * 0.34,
      W * 0.13,
      H * 0.09,
      m.body,
    ),
    box(
      `${name} single point tool head`,
      'tool_head',
      [o[0] + L * 0.25, o[1] + H * 0.42, o[2]],
      L * 0.055,
      W * 0.08,
      H * 0.16,
      m.metal,
    ),
    panel(
      `${name} pendant control panel`,
      'control_panel',
      [o[0] + L * 0.34, o[1] + H * 0.48, o[2] - W * 0.31],
      L * 0.1,
      W * 0.016,
      H * 0.24,
      m.accent,
      [0, -0.12, 0],
    ),
  ]
}

function shaperShapes(ctx: MachineToolContext): PrimitiveShapeInput[] {
  const { L, W, H, m, o, name } = ctx
  return [
    box(
      `${name} compact shaper base`,
      'machine_base',
      [o[0], o[1] + H * 0.09, o[2]],
      L * 0.66,
      W * 0.5,
      H * 0.18,
      m.body,
    ),
    box(
      `${name} vise work table`,
      'work_table',
      [o[0] + L * 0.14, o[1] + H * 0.29, o[2]],
      L * 0.28,
      W * 0.28,
      H * 0.075,
      m.metal,
    ),
    box(
      `${name} column housing`,
      'machine_column',
      [o[0] - L * 0.18, o[1] + H * 0.45, o[2]],
      L * 0.2,
      W * 0.34,
      H * 0.52,
      m.body,
    ),
    box(
      `${name} reciprocating ram head`,
      'reciprocating_ram',
      [o[0] + L * 0.04, o[1] + H * 0.58, o[2]],
      L * 0.38,
      W * 0.16,
      H * 0.1,
      m.dark,
    ),
    box(
      `${name} clapper box`,
      'clapper_box',
      [o[0] + L * 0.24, o[1] + H * 0.48, o[2]],
      L * 0.07,
      W * 0.1,
      H * 0.11,
      m.metal,
    ),
    box(
      `${name} single point cutting tool`,
      'tool_head',
      [o[0] + L * 0.27, o[1] + H * 0.39, o[2]],
      L * 0.035,
      W * 0.06,
      H * 0.14,
      m.metal,
    ),
    cylinder(
      `${name} ram stroke handwheel`,
      'feed_handwheel',
      [o[0] - L * 0.28, o[1] + H * 0.38, o[2] - W * 0.22],
      'z',
      Math.min(W, H) * 0.045,
      W * 0.02,
      m.metal,
    ),
    panel(
      `${name} control panel`,
      'control_panel',
      [o[0] + L * 0.32, o[1] + H * 0.4, o[2] - W * 0.26],
      L * 0.085,
      W * 0.016,
      H * 0.2,
      m.accent,
      [0, -0.16, 0],
    ),
  ]
}

function bedColumn(entry: IndustrialArchetypeEntry, input: IndustrialArchetypeComposeInput) {
  const ctx = machineToolContext(entry, input)
  if (entry.variant === 'drill_press') return drillPressShapes(ctx)
  if (entry.variant === 'planer') return planerShapes(ctx)
  if (entry.variant === 'shaper') return shaperShapes(ctx)
  const base = bedColumnBase(ctx)
  switch (entry.variant) {
    case 'milling_machine':
      return [...base, ...millingDetails(ctx)]
    case 'grinder':
      return [...base, ...grinderDetails(ctx)]
    default:
      return [...base, ...machiningCenterDetails(ctx)]
  }
}

function gantryTable(entry: IndustrialArchetypeEntry, input: IndustrialArchetypeComposeInput) {
  const params = industrialComposeParams(input)
  const { length: L, width: W, height: H } = dims(entry.recipeId, params)
  const m = materialPalette(params)
  const o = positionFor(params, input)
  const name = nameFor(input, entry.label)
  const head =
    entry.variant === 'plasma_cutter'
      ? 'plasma torch head'
      : entry.variant === 'wire_edm'
        ? 'wire head'
        : 'laser head'
  return [
    box(
      `${name} cutting table`,
      'cutting_table',
      [o[0], o[1] + H * 0.18, o[2]],
      L * 0.82,
      W * 0.72,
      H * 0.12,
      m.body,
    ),
    box(
      `${name} slatted work bed`,
      'work_table',
      [o[0], o[1] + H * 0.26, o[2]],
      L * 0.7,
      W * 0.56,
      H * 0.025,
      m.dark,
      0,
    ),
    box(
      `${name} gantry beam`,
      'gantry_frame',
      [o[0], o[1] + H * 0.62, o[2]],
      L * 0.76,
      W * 0.055,
      H * 0.075,
      m.metal,
    ),
    box(
      `${name} left gantry upright`,
      'gantry_frame',
      [o[0] - L * 0.36, o[1] + H * 0.46, o[2]],
      L * 0.04,
      W * 0.07,
      H * 0.32,
      m.metal,
      0,
    ),
    box(
      `${name} right gantry upright`,
      'gantry_frame',
      [o[0] + L * 0.36, o[1] + H * 0.46, o[2]],
      L * 0.04,
      W * 0.07,
      H * 0.32,
      m.metal,
      0,
    ),
    cylinder(
      `${name} ${head}`,
      'laser_head',
      [o[0] + L * 0.08, o[1] + H * 0.48, o[2]],
      'y',
      Math.min(W, H) * 0.035,
      H * 0.17,
      m.dark,
    ),
    panel(
      `${name} protective lid`,
      'guard_panel',
      [o[0], o[1] + H * 0.42, o[2] - W * 0.39],
      L * 0.72,
      W * 0.014,
      H * 0.27,
      m.glass,
    ),
    panel(
      `${name} control panel`,
      'control_panel',
      [o[0] + L * 0.45, o[1] + H * 0.36, o[2] - W * 0.25],
      L * 0.09,
      W * 0.018,
      H * 0.24,
      m.accent,
    ),
  ]
}

function injectionClamp(entry: IndustrialArchetypeEntry, input: IndustrialArchetypeComposeInput) {
  const params = industrialComposeParams(input)
  const { length: L, width: W, height: H } = dims(entry.recipeId, params)
  const m = materialPalette(params)
  const o = positionFor(params, input)
  const name = nameFor(input, entry.label)
  return [
    box(
      `${name} long machine base`,
      'machine_base',
      [o[0], o[1] + H * 0.08, o[2]],
      L * 0.84,
      W * 0.46,
      H * 0.14,
      m.body,
    ),
    cylinder(
      `${name} injection barrel`,
      'injection_unit',
      [o[0] - L * 0.22, o[1] + H * 0.32, o[2]],
      'x',
      Math.min(W, H) * 0.055,
      L * 0.32,
      m.metal,
    ),
    {
      kind: 'frustum',
      name: `${name} material hopper`,
      semanticRole: 'hopper',
      position: [o[0] - L * 0.32, o[1] + H * 0.54, o[2]],
      axis: 'y',
      radiusTop: Math.min(W, H) * 0.105,
      radiusBottom: Math.min(W, H) * 0.045,
      height: H * 0.18,
      radialSegments: 28,
      material: m.body,
    },
    box(
      `${name} mold clamp frame`,
      'press_frame',
      [o[0] + L * 0.14, o[1] + H * 0.36, o[2]],
      L * 0.2,
      W * 0.36,
      H * 0.34,
      m.dark,
    ),
    box(
      `${name} moving platen`,
      'platen',
      [o[0] + L * 0.04, o[1] + H * 0.36, o[2]],
      L * 0.025,
      W * 0.32,
      H * 0.27,
      m.metal,
      0,
    ),
    box(
      `${name} fixed platen`,
      'platen',
      [o[0] + L * 0.24, o[1] + H * 0.36, o[2]],
      L * 0.025,
      W * 0.32,
      H * 0.27,
      m.metal,
      0,
    ),
    panel(
      `${name} safety guard door`,
      'guard_panel',
      [o[0] + L * 0.14, o[1] + H * 0.36, o[2] - W * 0.25],
      L * 0.22,
      W * 0.018,
      H * 0.28,
      m.glass,
    ),
    panel(
      `${name} control panel`,
      'control_panel',
      [o[0] + L * 0.4, o[1] + H * 0.36, o[2] - W * 0.28],
      L * 0.09,
      W * 0.022,
      H * 0.23,
      m.accent,
    ),
  ] as PrimitiveShapeInput[]
}

function pressFrame(entry: IndustrialArchetypeEntry, input: IndustrialArchetypeComposeInput) {
  const params = industrialComposeParams(input)
  const { length: L, width: W, height: H } = dims(entry.recipeId, params)
  const m = materialPalette(params)
  const o = positionFor(params, input)
  const name = nameFor(input, entry.label)
  const shapes: PrimitiveShapeInput[] = [
    box(
      `${name} lower platen`,
      'press_bed',
      [o[0], o[1] + H * 0.07, o[2]],
      L * 0.68,
      W * 0.62,
      H * 0.07,
      m.dark,
    ),
    box(
      `${name} upper crown`,
      'press_frame',
      [o[0], o[1] + H * 0.86, o[2]],
      L * 0.68,
      W * 0.62,
      H * 0.075,
      m.body,
    ),
    cylinder(
      `${name} hydraulic cylinder`,
      'hydraulic_cylinder',
      [o[0], o[1] + H * 0.75, o[2]],
      'y',
      Math.min(W, H) * 0.075,
      H * 0.2,
      m.metal,
    ),
    box(
      `${name} ram plate`,
      'ram',
      [o[0], o[1] + H * 0.5, o[2]],
      L * 0.36,
      W * 0.38,
      H * 0.04,
      m.metal,
    ),
    panel(
      `${name} control pendant`,
      'control_panel',
      [o[0] + L * 0.43, o[1] + H * 0.48, o[2] - W * 0.35],
      L * 0.12,
      W * 0.025,
      H * 0.18,
      m.accent,
    ),
  ]
  for (const x of [-0.32, 0.32]) {
    for (const z of [-0.28, 0.28]) {
      shapes.push(
        cylinder(
          `${name} press frame column`,
          'press_frame',
          [o[0] + x * L, o[1] + H * 0.47, o[2] + z * W],
          'y',
          Math.min(W, H) * 0.025,
          H * 0.72,
          m.metal,
        ),
      )
    }
  }
  return shapes
}

function conveyor(entry: IndustrialArchetypeEntry, input: IndustrialArchetypeComposeInput) {
  const params = industrialComposeParams(input)
  const { length: L, width: W, height: H } = dims(entry.recipeId, params)
  const isRoller = entry.variant === 'roller_conveyor'
  const shapes = composePartPrimitives({
    name: nameFor(input, entry.label),
    position: params.position ?? input.position,
    detail: detailFor(params) ?? 'medium',
    primaryColor: colorFor(params, '#64748b'),
    metalColor: stringValue(params.metalColor, '#cbd5e1'),
    darkColor: stringValue(params.darkColor, '#1f2937'),
    enhanceVisualDetails: true,
    parts: [
      {
        kind: 'conveyor_frame',
        position: [0, H * 0.38, 0],
        length: L * 0.9,
        width: W * 0.72,
        height: H * 0.68,
        radius: Math.min(W, H) * 0.035,
      },
      {
        kind: 'roller_array',
        position: [0, H * 0.55, 0],
        length: L * 0.82,
        width: W * 0.66,
        radius: Math.min(W, H) * 0.035,
        count: Math.max(isRoller ? 12 : 7, Math.round(L * (isRoller ? 4.2 : 2.4))),
      },
      {
        kind: 'belt_surface',
        position: [0, H * 0.6, 0],
        length: L * 0.86,
        width: W * 0.64,
        height: H * (isRoller ? 0.01 : 0.025),
      },
    ],
  }).map((shape) =>
    shape.sourcePartKind === 'ribbed_motor_body'
      ? { ...shape, semanticRole: 'drive_motor' }
      : shape.sourcePartKind === 'belt_surface'
        ? { ...shape, semanticRole: 'belt_surface' }
        : shape.sourcePartKind === 'roller_array'
          ? { ...shape, semanticRole: 'roller_array' }
          : shape.sourcePartKind === 'conveyor_frame'
            ? { ...shape, semanticRole: 'conveyor_frame' }
            : shape,
  )
  if (entry.archetypeId === 'packaging.inline_machine' || entry.variant.includes('line')) {
    const m = materialPalette(params)
    const o = positionFor(params, input)
    shapes.push(
      box(
        `${entry.label} inline station`,
        'machine_base',
        [o[0], o[1] + H * 0.82, o[2] - W * 0.38],
        L * 0.14,
        W * 0.16,
        H * 0.32,
        m.body,
      ),
      panel(
        `${entry.label} control panel`,
        'control_panel',
        [o[0] + L * 0.26, o[1] + H * 0.76, o[2] - W * 0.42],
        L * 0.08,
        W * 0.016,
        H * 0.22,
        m.accent,
      ),
    )
  }
  return shapes
}

function rotatingMachine(entry: IndustrialArchetypeEntry, input: IndustrialArchetypeComposeInput) {
  const params = industrialComposeParams(input)
  const { length: L, width: W, height: H } = dims(entry.recipeId, params)
  const casingRadius = Math.min(W, H) * (entry.variant === 'compressor' ? 0.19 : 0.24)
  const motorRadius = Math.min(W, H) * 0.17
  return composePartPrimitives({
    name: nameFor(input, entry.label),
    position: params.position ?? input.position,
    detail: detailFor(params) ?? 'high',
    primaryColor: colorFor(params, '#64748b'),
    metalColor: stringValue(params.metalColor, '#cbd5e1'),
    darkColor: stringValue(params.darkColor, '#1f2937'),
    enhanceVisualDetails: true,
    parts: [
      { kind: 'skid_base', length: L * 0.95, width: W * 0.82, height: H * 0.09 },
      {
        kind: 'ribbed_motor_body',
        position: [-L * 0.24, H * 0.48, 0],
        axis: 'x',
        length: L * 0.42,
        radius: motorRadius,
      },
      { kind: 'volute_casing', position: [L * 0.22, H * 0.5, 0], radius: casingRadius },
      {
        kind: 'inlet_port',
        position: [L * 0.22, H * 0.5, W * 0.44],
        axis: 'z',
        radius: Math.min(W, H) * 0.09,
      },
      {
        kind: 'outlet_port',
        position: [L * 0.36, H * 0.72, W * 0.04],
        axis: 'x',
        radius: Math.min(W, H) * 0.075,
      },
      {
        kind: 'flange_ring',
        position: [L * 0.22, H * 0.5, W * 0.62],
        axis: 'z',
        radius: Math.min(W, H) * 0.14,
      },
    ],
  }).map((shape) =>
    shape.sourcePartKind === 'volute_casing'
      ? { ...shape, semanticRole: 'pump_casing' }
      : shape.sourcePartKind === 'ribbed_motor_body'
        ? { ...shape, semanticRole: 'motor_body' }
        : shape.sourcePartKind === 'skid_base'
          ? { ...shape, semanticRole: 'machine_base' }
          : shape,
  )
}

function horizontalCylinder(
  entry: IndustrialArchetypeEntry,
  input: IndustrialArchetypeComposeInput,
) {
  const params = industrialComposeParams(input)
  const { length: L, width: W, height: H } = dims(entry.recipeId, params)
  const shellRadius = Math.min(W, H) * 0.28
  const shapes = composePartPrimitives({
    name: nameFor(input, entry.label),
    position: params.position ?? input.position,
    detail: detailFor(params) ?? 'high',
    primaryColor: colorFor(params, '#64748b'),
    metalColor: stringValue(params.metalColor, '#cbd5e1'),
    darkColor: stringValue(params.darkColor, '#1f2937'),
    enhanceVisualDetails: true,
    parts: [
      { kind: 'heat_exchanger', position: [0, H * 0.48, 0], length: L * 0.82, radius: shellRadius },
    ],
  })
  const o = positionFor(params, input)
  const m = materialPalette(params)
  shapes.push(
    box(
      `${nameFor(input, entry.label)} left saddle support`,
      'saddle_support',
      [o[0] - L * 0.24, o[1] + H * 0.18, o[2]],
      L * 0.08,
      W * 0.26,
      H * 0.16,
      m.dark,
    ),
    box(
      `${nameFor(input, entry.label)} right saddle support`,
      'saddle_support',
      [o[0] + L * 0.24, o[1] + H * 0.18, o[2]],
      L * 0.08,
      W * 0.26,
      H * 0.16,
      m.dark,
    ),
  )
  return shapes.map((shape) => {
    const name = shape.name?.toLowerCase() ?? ''
    if (name.includes('saddle support')) return { ...shape, semanticRole: 'saddle_support' }
    if (name.includes('top nozzle'))
      return { ...shape, semanticRole: 'inlet_port', sourcePartKind: 'inlet_port' }
    if (name.includes('bottom nozzle'))
      return { ...shape, semanticRole: 'outlet_port', sourcePartKind: 'outlet_port' }
    if (name.includes('shell')) return { ...shape, semanticRole: 'heat_exchanger_shell' }
    return shape
  })
}

function verticalVessel(entry: IndustrialArchetypeEntry, input: IndustrialArchetypeComposeInput) {
  const params = industrialComposeParams(input)
  const { length: L, width: W, height: H } = dims(entry.recipeId, params)
  const m = materialPalette(params)
  const o = positionFor(params, input)
  const name = nameFor(input, entry.label)
  const radius = Math.min(L, W) * 0.22
  return [
    cylinder(
      `${name} vertical vessel shell`,
      'vessel_shell',
      [o[0], o[1] + H * 0.48, o[2]],
      'y',
      radius,
      H * 0.72,
      m.body,
    ),
    cylinder(
      `${name} top manway`,
      'inlet_port',
      [o[0], o[1] + H * 0.9, o[2]],
      'y',
      radius * 0.26,
      H * 0.05,
      m.dark,
    ),
    cylinder(
      `${name} side outlet port`,
      'outlet_port',
      [o[0] + radius, o[1] + H * 0.32, o[2]],
      'x',
      radius * 0.15,
      radius * 0.45,
      m.metal,
    ),
    box(
      `${name} support base`,
      'support_base',
      [o[0], o[1] + H * 0.05, o[2]],
      radius * 1.8,
      radius * 1.8,
      H * 0.08,
      m.dark,
    ),
  ]
}

export function resolveIndustrialArchetypeEntry(
  recipeId: IndustrialArchetypeRecipeId,
  input: IndustrialArchetypeComposeInput = {},
): IndustrialArchetypeEntry {
  return resolveEntry(recipeId, input)
}

export function composeIndustrialArchetype(
  recipeId: IndustrialArchetypeRecipeId,
  input: IndustrialArchetypeComposeInput = {},
): PrimitiveShapeInput[] {
  const entry = resolveEntry(recipeId, input)
  const shapes =
    entry.archetypeId === 'machine_tool.lathe_bed'
      ? latheBed(entry, input)
      : entry.archetypeId === 'machine_tool.bed_column'
        ? bedColumn(entry, input)
        : entry.archetypeId === 'machine_tool.gantry_table'
          ? gantryTable(entry, input)
          : entry.archetypeId === 'forming.injection_clamp'
            ? injectionClamp(entry, input)
            : entry.archetypeId === 'forming.press_frame'
              ? pressFrame(entry, input)
              : entry.archetypeId === 'material_handling.conveyor' ||
                  entry.archetypeId === 'packaging.inline_machine'
                ? conveyor(entry, input)
                : entry.archetypeId === 'fluid.rotating_machine'
                  ? rotatingMachine(entry, input)
                  : entry.archetypeId === 'process.horizontal_cylinder'
                    ? horizontalCylinder(entry, input)
                    : entry.archetypeId === 'process.vertical_vessel'
                      ? verticalVessel(entry, input)
                      : []
  return tag(shapes, entry)
}

export function industrialArchetypeBrief(
  entry: IndustrialArchetypeEntry,
  input: IndustrialArchetypeComposeInput,
): PrimitiveGeometryBrief {
  const dimensions = dims(entry.recipeId, input)
  return {
    category: entry.category,
    units: 'm',
    coordinateConvention: '+X length, +Y up, +Z depth/width; y=0 is ground',
    expectedDimensions: dimensions,
    requiredRoles: entry.requiredRoles,
    validationTargets: entry.validationTargets,
    assumptions: [
      'Industrial archetype library: equipment names map to reusable factory-equipment skeletons plus variant modules.',
      'The output is a readable factory-equipment silhouette, not manufacturer-specific geometry.',
      'Dimensions come from an internal real-world reference table and can be overridden by length/width/height params.',
    ],
  }
}
