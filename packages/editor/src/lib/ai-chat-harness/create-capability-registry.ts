import {
  CORE_COMPONENT_PART_CAPABILITIES,
  type CoreComponentPartCapability,
  coreComponentPartKinds,
} from '@pascal-app/core/lib/part-taxonomy'
import type { CreateIntent } from './geometry-intent'

export type CreateCapabilityPlan = {
  tool: 'compose_parts' | 'compose_assembly' | 'compose_recipe' | 'compose_primitive'
  args: Record<string, unknown>
  issues: string[]
  metadata?: Record<string, unknown>
}

export type CreateCapabilityDefinition = {
  id: string
  supports: (intent: CreateIntent) => boolean
  compile: (intent: CreateIntent) => CreateCapabilityPlan
}

export type CreateCapabilityRegistry = CreateCapabilityDefinition[]

const CORE_COMPONENT_PART_KIND_SET = new Set(coreComponentPartKinds())

const COMPONENT_DEFAULT_CONSTRAINTS: Record<string, Record<string, number | string | boolean>> = {
  'window.generic': { length: 0.42, height: 0.24, thickness: 0.012 },
  'window.vehicle': { length: 0.42, height: 0.24, thickness: 0.012 },
  'engine.generic': { length: 0.55, radius: 0.18 },
  'engine.aircraft': { count: 1, length: 0.32, radius: 0.08 },
  'propeller.generic': { count: 3, bladeShape: 'airfoil', bladeRadius: 0.42 },
  'blade.generic': { count: 1, length: 0.52 },
}

function normalizeToken(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim()
    ? value
        .trim()
        .replace(/[\s-]+/g, '_')
        .toLowerCase()
    : undefined
}

function normalizedFamily(value: unknown): string {
  const family = normalizeToken(value)
  if (family === 'bicycle' || family === 'bike' || family === 'cycle') return 'bicycle'
  if (
    family === 'aircraft' ||
    family === 'airplane' ||
    family === 'airliner' ||
    family === 'plane' ||
    family === 'jet'
  ) {
    return 'generic'
  }
  if (
    family === 'vehicle' ||
    family === 'car' ||
    family === 'auto' ||
    family === 'automobile' ||
    family === 'sedan' ||
    family === 'suv' ||
    family === 'truck' ||
    family === 'van'
  ) {
    return 'vehicle'
  }
  return 'generic'
}

function normalizedComponent(value: unknown): string | undefined {
  const component = normalizeToken(value)
  switch (component) {
    case 'tire':
    case 'tyre':
    case 'rim':
      return 'wheel'
    case 'windshield':
    case 'glass':
    case 'vehicle_window':
      return 'window'
    case 'rear_view_mirror':
    case 'rearview_mirror':
    case 'side_mirror':
      return 'mirror'
    case 'motor':
    case 'nacelle':
      return 'engine'
    case 'airscrew':
      return 'propeller'
    case 'fan_blade':
    case 'airfoil':
      return 'blade'
    default:
      return component
  }
}

function isWheelComponentIntent(intent: CreateIntent) {
  return normalizedComponent(intent.component) === 'wheel'
}

function numberConstraint(intent: CreateIntent, key: string): number | undefined {
  const value = intent.constraints?.[key]
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined
}

function quantityFor(intent: CreateIntent) {
  if (intent.quantity != null) return intent.quantity
  if (intent.arrangement === 'pair') return 2
  return 1
}

function componentId(component: string, quantity: number) {
  return quantity === 1 ? component : `${component}s`
}

function coreCapabilityCategory(capability: CoreComponentPartCapability, family: string) {
  return `${family}_${capability.component}_component`
}

function coreCapabilityDefaults(capability: CoreComponentPartCapability) {
  return (
    COMPONENT_DEFAULT_CONSTRAINTS[`${capability.component}.${capability.family ?? 'generic'}`] ?? {}
  )
}

function coreCapabilityFor(intent: CreateIntent) {
  const component = normalizedComponent(intent.component)
  if (!component) return undefined
  const family = normalizedFamily(intent.family)
  return (
    CORE_COMPONENT_PART_CAPABILITIES.find(
      (entry) => entry.component === component && entry.family === family,
    ) ??
    CORE_COMPONENT_PART_CAPABILITIES.find((entry) => entry.component === component && !entry.family)
  )
}

function compileCorePartComponent(intent: CreateIntent, capability: CoreComponentPartCapability) {
  const quantity = quantityFor(intent)
  const family = capability.family ?? normalizedFamily(intent.family)
  if (!CORE_COMPONENT_PART_KIND_SET.has(capability.partKind)) {
    return {
      tool: 'compose_parts' as const,
      args: {},
      issues: [`core_component_part_kind_not_registered:${capability.partKind}`],
      metadata: { capability: capability.id, family, quantity },
    }
  }
  return {
    tool: 'compose_parts' as const,
    args: {
      geometryBrief: {
        category: coreCapabilityCategory(capability, family),
        scope: 'component',
        family,
        component: capability.component,
        requiredRoles: capability.requiredRoles,
      },
      parts: [
        {
          id: componentId(capability.component, quantity),
          kind: capability.partKind,
          ...(capability.semanticRole ? { semanticRole: capability.semanticRole } : {}),
          ...(quantity > 1 && capability.partKind !== 'propeller_blade_set'
            ? { count: quantity }
            : {}),
          ...coreCapabilityDefaults(capability),
          ...intent.constraints,
        },
      ],
    },
    issues: [],
    metadata: {
      capability: capability.id,
      family,
      quantity,
    },
  }
}

function compileDoorComponent(intent: CreateIntent) {
  const quantity = quantityFor(intent)
  const family = normalizeToken(intent.family) ?? 'generic'
  const semanticRole = family === 'vehicle' ? 'vehicle_door' : 'door_panel'
  return {
    tool: 'compose_primitive' as const,
    args: {
      geometryBrief: {
        category: `${family}_door_component`,
        scope: 'component',
        family,
        component: 'door',
        requiredRoles: [semanticRole],
      },
      shapes: [
        {
          kind: 'rounded-panel',
          name: quantity === 1 ? 'door panel' : 'door panels',
          semanticRole,
          length: numberConstraint(intent, 'width') ?? 0.72,
          width: numberConstraint(intent, 'height') ?? 1.15,
          thickness: numberConstraint(intent, 'thickness') ?? 0.045,
          cornerRadius: 0.045,
          material: { properties: { color: '#64748b', roughness: 0.42, metalness: 0.18 } },
        },
      ],
    },
    issues: [],
    metadata: { capability: 'door.component', family, quantity },
  }
}

function compileMirrorComponent(intent: CreateIntent) {
  const quantity = quantityFor(intent)
  const family = normalizeToken(intent.family) ?? 'generic'
  return {
    tool: 'compose_primitive' as const,
    args: {
      geometryBrief: {
        category: `${family}_mirror_component`,
        scope: 'component',
        family,
        component: 'mirror',
        requiredRoles: ['mirror_glass'],
      },
      shapes: [
        {
          kind: 'rounded-panel',
          name: quantity === 1 ? 'mirror glass' : 'mirror glasses',
          semanticRole: 'mirror_glass',
          length: numberConstraint(intent, 'width') ?? 0.34,
          width: numberConstraint(intent, 'height') ?? 0.18,
          thickness: numberConstraint(intent, 'thickness') ?? 0.018,
          cornerRadius: 0.045,
          material: {
            properties: {
              color: '#93c5fd',
              roughness: 0.08,
              metalness: 0.65,
              opacity: 0.62,
              transparent: true,
            },
          },
        },
        {
          kind: 'cylinder',
          name: 'mirror mounting stem',
          semanticRole: 'mirror_stem',
          axis: 'x',
          radius: 0.018,
          height: 0.22,
          position: [0, 0.09, -0.08],
          material: { properties: { color: '#111827', roughness: 0.35, metalness: 0.55 } },
        },
      ],
    },
    issues: [],
    metadata: { capability: 'mirror.component', family, quantity },
  }
}

function compileEngineComponent(intent: CreateIntent) {
  const quantity = quantityFor(intent)
  const family = normalizeToken(intent.family) ?? 'generic'
  if (family === 'aircraft') {
    return {
      tool: 'compose_primitive' as const,
      args: {
        geometryBrief: {
          category: 'aircraft_engine_component',
          scope: 'component',
          family,
          component: 'engine',
          requiredRoles: ['engine_nacelle', 'engine_fan', 'engine_intake'],
        },
        shapes: [
          {
            kind: 'hollow-cylinder',
            name: 'aircraft engine nacelle',
            semanticRole: 'engine_nacelle',
            axis: 'x',
            radius: numberConstraint(intent, 'radius') ?? 0.12,
            height: numberConstraint(intent, 'length') ?? 0.34,
            wallThickness: 0.018,
            material: { properties: { color: '#64748b', roughness: 0.34, metalness: 0.56 } },
          },
          {
            kind: 'cylinder',
            name: 'engine intake fan',
            semanticRole: 'engine_fan',
            axis: 'x',
            radius: 0.085,
            height: 0.014,
            position: [0.18, 0.085, 0],
            material: { properties: { color: '#cbd5e1', roughness: 0.3, metalness: 0.65 } },
          },
          {
            kind: 'torus',
            name: 'engine intake lip',
            semanticRole: 'engine_intake',
            axis: 'x',
            majorRadius: 0.105,
            tubeRadius: 0.012,
            position: [0.18, 0.105, 0],
            material: { properties: { color: '#111827', roughness: 0.42, metalness: 0.2 } },
          },
        ],
      },
      issues: [],
      metadata: { capability: 'engine.component', family, quantity },
    }
  }

  const capability = coreCapabilityFor(intent)
  if (!capability) {
    return {
      tool: 'compose_parts' as const,
      args: {},
      issues: ['planner_no_mapping'],
      metadata: { capability: 'engine.component', family, quantity },
    }
  }
  return compileCorePartComponent(intent, capability)
}

export const createCapabilityRegistry: CreateCapabilityRegistry = [
  {
    id: 'wheel.component',
    supports: isWheelComponentIntent,
    compile: (intent) => {
      const capability = coreCapabilityFor(intent)
      if (!capability) {
        return {
          tool: 'compose_parts',
          args: {},
          issues: ['planner_no_mapping'],
          metadata: { fallbackReason: 'planner_no_mapping', component: 'wheel' },
        }
      }
      const quantity = quantityFor(intent)
      const diameter = numberConstraint(intent, 'diameter')
      const radius =
        numberConstraint(intent, 'radius') ?? (diameter != null ? diameter / 2 : undefined)
      const width = numberConstraint(intent, 'width')
      const plan = compileCorePartComponent(intent, capability)
      const [part] = (plan.args.parts as Record<string, unknown>[] | undefined) ?? []
      if (part) {
        part.id =
          quantity === 1
            ? `${capability.family ?? 'generic'}_wheel`
            : `${capability.family ?? 'generic'}_wheels`
        part.count = quantity
        if (radius != null) part.radius = radius
        if (width != null) part.wheelWidth = width
      }
      return plan
    },
  },
  ...CORE_COMPONENT_PART_CAPABILITIES.filter(
    (capability) => !['wheel', 'engine'].includes(capability.component),
  ).map((capability) => ({
    id: capability.id,
    supports: (intent: CreateIntent) =>
      normalizedComponent(intent.component) === capability.component,
    compile: (intent: CreateIntent) => {
      const resolved = coreCapabilityFor(intent)
      if (!resolved || resolved.component !== capability.component) {
        return {
          tool: 'compose_parts' as const,
          args: {},
          issues: ['planner_no_mapping'],
          metadata: { fallbackReason: 'planner_no_mapping', component: capability.component },
        }
      }
      return compileCorePartComponent(intent, resolved)
    },
  })),
  {
    id: 'engine.component',
    supports: (intent) => normalizedComponent(intent.component) === 'engine',
    compile: compileEngineComponent,
  },
  {
    id: 'door.component',
    supports: (intent) => normalizedComponent(intent.component) === 'door',
    compile: compileDoorComponent,
  },
  {
    id: 'mirror.component',
    supports: (intent) => normalizedComponent(intent.component) === 'mirror',
    compile: compileMirrorComponent,
  },
]

export function planCreateGeometry(
  intent: CreateIntent,
  registry: CreateCapabilityRegistry = createCapabilityRegistry,
): CreateCapabilityPlan {
  const definition = registry.find((entry) => entry.supports(intent))
  if (!definition) {
    return {
      tool: 'compose_parts',
      args: {},
      issues: ['planner_no_mapping'],
      metadata: {
        fallbackReason: 'planner_no_mapping',
        family: normalizeToken(intent.family),
        component: normalizeToken(intent.component),
      },
    }
  }
  return definition.compile(intent)
}
