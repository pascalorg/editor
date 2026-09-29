import {
  type AnyNode,
  type AnyNodeId,
  faceOnLine,
  GROUND_SUPPORT_ID,
  getClampedWallCurveOffset,
  getMaxWallCurveOffset,
  getWallCurveLength,
  justificationForFaceOnLine,
  normalizeWallCurveOffset,
  planWallJustification,
  roomSideFaces,
  terrainSupportLift,
  useScene,
  WALL_CHAIR_RAIL_DEFAULT,
  WALL_CROWN_DEFAULT,
  WALL_SKIRTING_DEFAULT,
  type WallNode,
  type WallTrimProfile,
} from '@pascal-app/core'
import {
  curveReshapeScope,
  type PanelRow,
  triggerSFX,
  useInteractionScope,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { resolveWallOpeningCeiling } from '../shared/wall-opening-ceiling'
import { hasWallCurveBlockingChildren } from './curve-eligibility'
import { buildWallLengthPatch } from './length-patch'

type TrimKey = 'skirting' | 'crown' | 'chairRail'
const profiles: Record<TrimKey, readonly WallTrimProfile[]> = {
  skirting: ['flat', 'base-modern', 'base-colonial', 'base-shoe', 'base-ogee'],
  crown: ['flat', 'crown-cove', 'crown-ogee', 'crown-craftsman', 'crown-layered'],
  chairRail: ['flat', 'rail-rounded', 'rail-ogee', 'rail-picture', 'rail-stepped'],
}
const pretty = (value: string) =>
  value
    .replace(/^(base|crown|rail)-/, '')
    .replace(/(^|[- ])\w/g, (s) => s.replace('-', ' ').toUpperCase())

export type WallReferenceValue = 'outside' | 'center' | 'inside' | 'left' | 'right'
export type WallReferenceOption = { label: string; value: WallReferenceValue }

const ROOM_REFERENCE_OPTIONS: WallReferenceOption[] = [
  { label: 'Outside face', value: 'outside' },
  { label: 'Center', value: 'center' },
  { label: 'Inside face', value: 'inside' },
]
const DIRECTION_REFERENCE_OPTIONS: WallReferenceOption[] = [
  { label: 'Left', value: 'left' },
  { label: 'Center', value: 'center' },
  { label: 'Right', value: 'right' },
]

/** Faces a wall's reference choices name: its room sides when a room is on exactly one side. */
function referenceFaces(wall: WallNode, nodes: Record<AnyNodeId, AnyNode>) {
  const sides = roomSideFaces(nodes, wall.id)
  return sides.inside && sides.outside
    ? ({ kind: 'room', outside: sides.outside, inside: sides.inside } as const)
    : ({ kind: 'direction' } as const)
}

/**
 * The Reference control for one or more walls. The drawn line never moves; the
 * choice picks which face sits on it. Walls with a room on exactly one side read
 * Outside face / Center / Inside face; otherwise Left / Center / Right along the
 * drawing direction (left is face a). A selection shows the room labels only
 * when every wall has them, applies each choice to each wall's own faces, and
 * shows no active option when the walls disagree.
 */
export function wallReferenceModel(walls: readonly WallNode[], nodes: Record<AnyNodeId, AnyNode>) {
  const faces = walls.map((wall) => referenceFaces(wall, nodes))
  const room = faces.length > 0 && faces.every((entry) => entry.kind === 'room')
  const options = room ? ROOM_REFERENCE_OPTIONS : DIRECTION_REFERENCE_OPTIONS
  const faceFor = (index: number, value: WallReferenceValue): 'a' | 'b' | 'center' => {
    if (value === 'center') return 'center'
    if (value === 'left') return 'a'
    if (value === 'right') return 'b'
    const entry = faces[index]!
    return entry.kind === 'room' ? entry[value] : 'center'
  }
  const current = walls.map((wall, index): WallReferenceValue => {
    const face = faceOnLine(wall)
    if (face === 'center') return 'center'
    const entry = faces[index]!
    if (room && entry.kind === 'room') return face === entry.outside ? 'outside' : 'inside'
    return face === 'a' ? 'left' : 'right'
  })
  const value = current.every((entry) => entry === current[0]) ? (current[0] ?? null) : null
  return {
    options,
    value,
    apply: (next: WallReferenceValue) => {
      const scene = useScene.getState()
      const updates = walls.flatMap((wall, index) =>
        planWallJustification(
          scene.nodes,
          wall.id,
          justificationForFaceOnLine(faceFor(index, next)),
        ),
      )
      if (updates.length > 0) scene.updateNodes(updates)
    },
  }
}

export function wallSettings(
  node: WallNode,
  nodes: Record<AnyNodeId, AnyNode>,
  update: (patch: Partial<WallNode>) => void,
  reshape: () => void = () => {
    triggerSFX('sfx:item-pick')
    useInteractionScope.getState().begin(curveReshapeScope(node.id))
    useViewer.getState().setSelection({ selectedIds: [] })
  },
): PanelRow[] {
  const rows: PanelRow[] = []
  const height = resolveWallOpeningCeiling(node, nodes)
  const repairBase = () => ({
    supportOffset: undefined,
    ...(node.supportSlabId === GROUND_SUPPORT_ID &&
    !(node.parentId && terrainSupportLift(nodes, node.parentId, ...node.start) != null)
      ? { supportSlabId: undefined }
      : {}),
  })
  const number = (
    section: string,
    id: string,
    label: string,
    value: number,
    min: number,
    max: number,
    step: number,
    onChange: (value: number) => void,
    unit: string | undefined = 'm',
  ) =>
    rows.push({
      section,
      id,
      kind: 'stepper',
      label,
      value,
      min,
      max,
      step,
      unit,
      onChange: (next) => onChange(Math.max(min, Math.min(max, next))),
    })
  const choice = (
    section: string,
    id: string,
    label: string,
    value: string,
    onSelect?: () => void,
  ) => rows.push({ section, id, kind: 'choice', label, value, onSelect })
  const cycle = (
    section: string,
    id: string,
    label: string,
    value: string,
    values: readonly string[],
    onChange: (value: string) => void,
  ) => {
    const change = (direction: number) =>
      onChange(
        values[(Math.max(0, values.indexOf(value)) + direction + values.length) % values.length]!,
      )
    rows.push({
      section,
      id,
      kind: 'cycle',
      label,
      value: pretty(value),
      next: () => change(1),
      previous: () => change(-1),
    })
  }
  const reference = wallReferenceModel([node], nodes)
  const step = (by: number) => {
    const index = reference.options.findIndex((option) => option.value === reference.value)
    reference.apply(reference.options[(index + by + 3) % 3]!.value)
  }
  rows.push({
    section: 'Dimensions',
    id: 'wall-reference',
    kind: 'cycle',
    label: 'Reference',
    value: reference.options.find((option) => option.value === reference.value)?.label ?? 'Mixed',
    next: () => step(1),
    previous: () => step(-1),
  })
  const length = getWallCurveLength(node)
  number('Dimensions', 'wall-length', 'Length', length, 0.1, 1000, 0.05, (next) => {
    update(buildWallLengthPatch(node, next))
  })
  choice(
    'Dimensions',
    'wall-top',
    'Top',
    node.height == null ? 'Follows level' : 'Custom height',
    () =>
      update(
        node.height == null
          ? { height: Math.max(0.1, height) }
          : { height: undefined, ...repairBase() },
      ),
  )
  if (node.height == null)
    choice('Dimensions', 'wall-height-auto', 'Current height', `${Number(height.toFixed(3))} m`)
  else
    number('Dimensions', 'height', 'Height', node.height, 0.1, 1000, 0.05, (height) =>
      update({ height }),
    )
  choice(
    'Dimensions',
    'wall-bottom',
    'Bottom',
    node.fillToTerrain ? 'Fill to terrain' : 'Auto',
    () =>
      update(
        node.fillToTerrain
          ? { fillToTerrain: undefined, ...repairBase() }
          : { fillToTerrain: true },
      ),
  )
  number(
    'Dimensions',
    'thickness',
    'Thickness',
    node.thickness ?? 0.1,
    0.05,
    1000,
    0.01,
    (thickness) => update({ thickness }),
  )
  const blockedCurve = hasWallCurveBlockingChildren(
    (node.children ?? []).flatMap((id) =>
      nodes[id as AnyNodeId] ? [nodes[id as AnyNodeId]!] : [],
    ),
  )
  if (!blockedCurve) {
    const limit = Math.max(0.01, getMaxWallCurveOffset(node))
    number(
      'Dimensions',
      'curveOffset',
      'Curve',
      getClampedWallCurveOffset(node),
      -limit,
      limit,
      0.05,
      (next) => update({ curveOffset: normalizeWallCurveOffset(node, next) }),
    )
    if (reshape)
      rows.push({
        section: 'Dimensions',
        id: 'wall-reshape',
        kind: 'action',
        label: 'Reshape curve in scene',
        onSelect: reshape,
      })
  }
  for (const [key, title, defaults] of [
    ['skirting', 'Skirting', WALL_SKIRTING_DEFAULT],
    ['crown', 'Crown molding', WALL_CROWN_DEFAULT],
    ['chairRail', 'Chair rail', WALL_CHAIR_RAIL_DEFAULT],
  ] as const) {
    const trim = { ...defaults, ...node[key] }
    const patch = (value: Partial<typeof trim>) => update({ [key]: { ...trim, ...value } })
    choice(title, `${key}-enabled`, title, trim.enabled ? 'On' : 'Off', () =>
      patch({ enabled: !trim.enabled }),
    )
    if (!trim.enabled) continue
    const sides = trim.sides === 'interior' ? 'a' : trim.sides === 'exterior' ? 'b' : trim.sides
    cycle(title, `${key}-sides`, 'Sides', sides, ['a', 'b', 'both'], (next) =>
      patch({ sides: next as typeof trim.sides }),
    )
    cycle(title, `${key}-profile`, 'Profile', trim.profile, profiles[key], (profile) =>
      patch({ profile: profile as WallTrimProfile }),
    )
    number(
      title,
      `${key}-height`,
      'Height',
      trim.height,
      0.01,
      Math.max(0.05, height),
      0.01,
      (height) => patch({ height }),
    )
    number(title, `${key}-proud`, 'Projection', trim.proud, 0.001, 0.2, 0.005, (proud) =>
      patch({ proud }),
    )
    if (key === 'chairRail')
      number(
        title,
        `${key}-offset`,
        'Offset',
        trim.offsetY ?? 0,
        0,
        Math.max(0.05, height - trim.height),
        0.01,
        (offsetY) => patch({ offsetY }),
      )
  }
  return rows
}
