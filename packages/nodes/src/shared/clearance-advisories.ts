import {
  type AnyNode,
  type CabinetModuleNode,
  type CabinetNode,
  type DoorNode,
  type ItemNode,
  resolveStairTotalRise,
  type StairNode,
  type StairSegmentNode,
  type ZoneNode,
} from '@pascal-app/core'
import { formatConstructionLength } from './construction-length'

export type ClearanceAdvisoryCategory =
  | 'circulation'
  | 'entry'
  | 'door-approach'
  | 'fixture'
  | 'cabinet'
  | 'appliance'
  | 'closet'
  | 'stair'

export type ClearanceAdvisorySeverity = 'info' | 'warning'

export type ClearanceRuleSource = {
  title: string
  edition: string
  section: string
  url?: string
  note?: string
}

export type ClearanceRule = {
  id: string
  category: ClearanceAdvisoryCategory
  label: string
  measurement:
    | 'clear-width'
    | 'clear-depth'
    | 'clear-floor-width'
    | 'clear-floor-depth'
    | 'front-clearance'
    | 'stair-width'
    | 'tread-depth'
    | 'riser-height'
  minValue: number
  source: ClearanceRuleSource
}

export type ClearanceProfile = {
  id: string
  label: string
  jurisdiction?: string
  enabled: boolean
  rules: readonly ClearanceRule[]
}

export type ClearanceEvidence = Readonly<
  Record<string, Partial<Record<ClearanceRule['id'], number>>>
>

export type BuildClearanceAdvisoriesOptions = {
  profiles?: readonly ClearanceProfile[]
  includeDisabled?: boolean
  evidence?: ClearanceEvidence
}

export type ClearanceAdvisory = {
  id: string
  nodeId: string
  nodeType: string
  profileId: string
  profileLabel: string
  category: ClearanceAdvisoryCategory
  ruleId: string
  label: string
  measured: number | null
  required: number
  severity: ClearanceAdvisorySeverity
  source: ClearanceRuleSource
  message: string
}

type ClearanceTarget = {
  nodeId: string
  nodeType: string
  category: ClearanceAdvisoryCategory
  measurements: Partial<Record<ClearanceRule['measurement'], number>>
}

const ADA_2010: Pick<ClearanceRuleSource, 'title' | 'edition' | 'url'> = {
  title: '2010 ADA Standards for Accessible Design',
  edition: '2010',
  url: 'https://www.access-board.gov/ada/',
}

const OFFICE_STANDARD: Pick<ClearanceRuleSource, 'title' | 'edition'> = {
  title: 'Pascal construction-document advisory profile',
  edition: '2026-07-21',
}

export const DEFAULT_CLEARANCE_PROFILES: readonly ClearanceProfile[] = [
  {
    id: 'us-ada-2010-advisory',
    label: 'U.S. ADA 2010 advisory checks',
    jurisdiction: 'US',
    enabled: false,
    rules: [
      {
        id: 'ada-accessible-route-clear-width',
        category: 'circulation',
        label: 'accessible route clear width',
        measurement: 'clear-width',
        minValue: 36 * 0.0254,
        source: {
          ...ADA_2010,
          section: '403.5.1',
          note: 'Accessible routes generally require 36 inches minimum clear width.',
        },
      },
      {
        id: 'ada-entry-clear-width',
        category: 'entry',
        label: 'entry clear width',
        measurement: 'clear-width',
        minValue: 36 * 0.0254,
        source: {
          ...ADA_2010,
          section: '403.5.1',
          note: 'Entries serving an accessible route are checked against the route clear width.',
        },
      },
      {
        id: 'ada-door-clear-opening',
        category: 'door-approach',
        label: 'door clear opening',
        measurement: 'clear-width',
        minValue: 32 * 0.0254,
        source: {
          ...ADA_2010,
          section: '404.2.3',
          note: 'Door openings on accessible routes require 32 inches minimum clear width.',
        },
      },
      {
        id: 'ada-fixture-clear-floor-width',
        category: 'fixture',
        label: 'fixture clear floor space width',
        measurement: 'clear-floor-width',
        minValue: 30 * 0.0254,
        source: {
          ...ADA_2010,
          section: '305.3',
          note: 'Clear floor or ground space is 30 inches minimum by 48 inches minimum.',
        },
      },
      {
        id: 'ada-fixture-clear-floor-depth',
        category: 'fixture',
        label: 'fixture clear floor space depth',
        measurement: 'clear-floor-depth',
        minValue: 48 * 0.0254,
        source: {
          ...ADA_2010,
          section: '305.3',
          note: 'Clear floor or ground space is 30 inches minimum by 48 inches minimum.',
        },
      },
    ],
  },
  {
    id: 'office-residential-advisory',
    label: 'Office residential advisory checks',
    enabled: false,
    rules: [
      {
        id: 'office-cabinet-front-clearance',
        category: 'cabinet',
        label: 'cabinet front working clearance',
        measurement: 'front-clearance',
        minValue: 0.9,
        source: {
          ...OFFICE_STANDARD,
          section: 'Kitchen working clearances',
          note: 'Office drafting convention for cabinet and drawer operation clearance.',
        },
      },
      {
        id: 'office-appliance-front-clearance',
        category: 'appliance',
        label: 'appliance front working clearance',
        measurement: 'front-clearance',
        minValue: 0.9,
        source: {
          ...OFFICE_STANDARD,
          section: 'Kitchen appliance clearances',
          note: 'Office drafting convention for appliance door and working clearance.',
        },
      },
      {
        id: 'office-closet-depth',
        category: 'closet',
        label: 'closet clear depth',
        measurement: 'clear-depth',
        minValue: 0.6,
        source: {
          ...OFFICE_STANDARD,
          section: 'Storage clearances',
          note: 'Office drafting convention for reach-in closet depth.',
        },
      },
      {
        id: 'office-stair-width',
        category: 'stair',
        label: 'stair clear width',
        measurement: 'stair-width',
        minValue: 0.9,
        source: {
          ...OFFICE_STANDARD,
          section: 'Residential stair geometry',
          note: 'Office drafting convention; verify against local stair code before permit use.',
        },
      },
      {
        id: 'office-stair-tread-depth',
        category: 'stair',
        label: 'stair tread depth',
        measurement: 'tread-depth',
        minValue: 0.25,
        source: {
          ...OFFICE_STANDARD,
          section: 'Residential stair geometry',
          note: 'Office drafting convention; verify against local stair code before permit use.',
        },
      },
      {
        id: 'office-stair-riser-height',
        category: 'stair',
        label: 'stair riser height',
        measurement: 'riser-height',
        minValue: -0.2,
        source: {
          ...OFFICE_STANDARD,
          section: 'Residential stair geometry',
          note: 'Negative minValue means measured riser height must be less than or equal to the absolute value.',
        },
      },
    ],
  },
] as const

export function buildClearanceAdvisories(
  nodes: Readonly<Record<string, AnyNode>>,
  options: BuildClearanceAdvisoriesOptions = {},
): ClearanceAdvisory[] {
  const profiles = (options.profiles ?? DEFAULT_CLEARANCE_PROFILES).filter(
    (profile) => options.includeDisabled === true || profile.enabled,
  )
  if (profiles.length === 0) return []

  const targets = Object.values(nodes).flatMap((node) => clearanceTargets(node, nodes))
  const advisories: ClearanceAdvisory[] = []

  for (const target of targets) {
    for (const profile of profiles) {
      for (const rule of profile.rules) {
        if (rule.category !== target.category) continue
        const measured =
          target.measurements[rule.measurement] ?? options.evidence?.[target.nodeId]?.[rule.id]
        if (measured === undefined) {
          advisories.push(clearanceAdvisory({ target, profile, rule, measured: null }))
          continue
        }
        if (violatesClearanceRule(measured, rule)) {
          advisories.push(clearanceAdvisory({ target, profile, rule, measured }))
        }
      }
    }
  }

  return advisories.sort((left, right) => left.id.localeCompare(right.id))
}

function clearanceTargets(
  node: AnyNode,
  nodes: Readonly<Record<string, AnyNode>>,
): ClearanceTarget[] {
  if (node.type === 'zone') return zoneTargets(node)
  if (node.type === 'door') return doorTargets(node)
  if (node.type === 'item') return itemTargets(node)
  if (node.type === 'cabinet' || node.type === 'cabinet-module') return cabinetTargets(node)
  if (node.type === 'stair') return stairTargets(node, nodes)
  if (node.type === 'stair-segment') return stairSegmentTargets(node)
  return []
}

function zoneTargets(zone: ZoneNode): ClearanceTarget[] {
  const role = normalizedText([zone.name, zone.occupancy, String(zone.metadata ?? '')])
  const dimensions = zoneClearDimensions(zone)
  const targets: ClearanceTarget[] = []

  if (containsAny(role, ['hall', 'hallway', 'corridor', 'passage', 'circulation'])) {
    targets.push({
      nodeId: zone.id,
      nodeType: zone.type,
      category: 'circulation',
      measurements: { 'clear-width': dimensions.minSpan },
    })
  }

  if (containsAny(role, ['entry', 'entrance', 'vestibule', 'foyer'])) {
    targets.push({
      nodeId: zone.id,
      nodeType: zone.type,
      category: 'entry',
      measurements: { 'clear-width': dimensions.minSpan },
    })
  }

  if (containsAny(role, ['closet', 'wardrobe'])) {
    targets.push({
      nodeId: zone.id,
      nodeType: zone.type,
      category: 'closet',
      measurements: { 'clear-depth': dimensions.minSpan },
    })
  }

  return targets
}

function doorTargets(door: DoorNode): ClearanceTarget[] {
  return [
    {
      nodeId: door.id,
      nodeType: door.type,
      category: 'door-approach',
      measurements: { 'clear-width': door.width },
    },
  ]
}

function itemTargets(item: ItemNode): ClearanceTarget[] {
  const text = normalizedText([
    item.asset.name,
    item.asset.category,
    ...(item.asset.tags ?? []),
    ...(item.asset.functionTags ?? []),
  ])
  const targets: ClearanceTarget[] = []

  if (containsAny(text, ['toilet', 'lavatory', 'sink', 'fixture', 'tub', 'shower', 'wc'])) {
    targets.push({
      nodeId: item.id,
      nodeType: item.type,
      category: 'fixture',
      measurements: {},
    })
  }

  if (containsAny(text, ['appliance', 'fridge', 'refrigerator', 'oven', 'range', 'dishwasher'])) {
    targets.push({
      nodeId: item.id,
      nodeType: item.type,
      category: 'appliance',
      measurements: {},
    })
  }

  return targets
}

function cabinetTargets(cabinet: CabinetNode | CabinetModuleNode): ClearanceTarget[] {
  const targets: ClearanceTarget[] = [
    {
      nodeId: cabinet.id,
      nodeType: cabinet.type,
      category: 'cabinet',
      measurements: {},
    },
  ]

  if ((cabinet.stack ?? []).some((compartment) => isApplianceCompartment(compartment.type))) {
    targets.push({
      nodeId: cabinet.id,
      nodeType: cabinet.type,
      category: 'appliance',
      measurements: {},
    })
  }

  if ((cabinet.stack ?? []).some((compartment) => compartment.type === 'sink')) {
    targets.push({
      nodeId: cabinet.id,
      nodeType: cabinet.type,
      category: 'fixture',
      measurements: {},
    })
  }

  return targets
}

function stairTargets(
  stair: StairNode,
  nodes: Readonly<Record<string, AnyNode>>,
): ClearanceTarget[] {
  const measurements: ClearanceTarget['measurements'] = { 'stair-width': stair.width }
  const totalRise = resolveStairTotalRise(stair, nodes as Record<string, AnyNode>)
  if (stair.stepCount > 0 && totalRise > 0) {
    measurements['riser-height'] = totalRise / stair.stepCount
  }

  return [
    {
      nodeId: stair.id,
      nodeType: stair.type,
      category: 'stair',
      measurements,
    },
  ]
}

function stairSegmentTargets(segment: StairSegmentNode): ClearanceTarget[] {
  const measurements: ClearanceTarget['measurements'] = { 'stair-width': segment.width }
  if (segment.segmentType === 'stair' && segment.stepCount > 0) {
    measurements['tread-depth'] = segment.length / segment.stepCount
    if (segment.height > 0) measurements['riser-height'] = segment.height / segment.stepCount
  }

  return [
    {
      nodeId: segment.id,
      nodeType: segment.type,
      category: 'stair',
      measurements,
    },
  ]
}

function clearanceAdvisory(args: {
  target: ClearanceTarget
  profile: ClearanceProfile
  rule: ClearanceRule
  measured: number | null
}): ClearanceAdvisory {
  const { target, profile, rule, measured } = args
  const measuredLabel =
    measured === null ? 'not verified' : formatConstructionLength(measured, 'metric')
  const requiredLabel = formatConstructionLength(Math.abs(rule.minValue), 'metric')
  const comparator = rule.minValue < 0 ? 'at most' : 'at least'

  return {
    id: ['clearance', profile.id, target.nodeId, rule.id].join(':'),
    nodeId: target.nodeId,
    nodeType: target.nodeType,
    profileId: profile.id,
    profileLabel: profile.label,
    category: rule.category,
    ruleId: rule.id,
    label: rule.label,
    measured,
    required: Math.abs(rule.minValue),
    severity: measured === null ? 'info' : 'warning',
    source: rule.source,
    message:
      measured === null
        ? `${titleCase(target.nodeType)} ${target.nodeId} requires ${rule.label} verification (${comparator} ${requiredLabel}) per ${rule.source.title} ${rule.source.edition} ${rule.source.section}.`
        : `${titleCase(target.nodeType)} ${target.nodeId} ${rule.label} ${measuredLabel} is below ${requiredLabel} per ${rule.source.title} ${rule.source.edition} ${rule.source.section}.`,
  }
}

function violatesClearanceRule(measured: number, rule: ClearanceRule): boolean {
  if (!Number.isFinite(measured)) return true
  if (rule.minValue < 0) return measured > Math.abs(rule.minValue)
  return measured < rule.minValue
}

function zoneClearDimensions(zone: ZoneNode): { minSpan: number } {
  const xs = zone.polygon.map((point) => point[0])
  const zs = zone.polygon.map((point) => point[1])
  if (xs.length === 0 || zs.length === 0) return { minSpan: 0 }
  return {
    minSpan: Math.min(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs)),
  }
}

function normalizedText(parts: readonly string[]): string {
  return parts.join(' ').toLowerCase()
}

function containsAny(text: string, needles: readonly string[]): boolean {
  return needles.some((needle) => text.includes(needle))
}

function isApplianceCompartment(type: string): boolean {
  return [
    'oven',
    'microwave',
    'dishwasher',
    'cooktop-gas',
    'cooktop-induction',
    'fridge-single',
    'fridge-double',
    'fridge-top-freezer',
    'fridge-bottom-freezer',
  ].includes(type)
}

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}
