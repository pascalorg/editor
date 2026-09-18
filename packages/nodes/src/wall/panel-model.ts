import {
  type AnyNode,
  type AnyNodeId,
  type WallNode,
  type WallTrimProfile,
  buildWallFaceBandCountPatch,
  GROUND_SUPPORT_ID,
  getClampedWallCurveOffset,
  getMaxWallCurveOffset,
  getWallCurveLength,
  getWallFaceBandConfig,
  normalizeWallCurveOffset,
  terrainSupportLift,
  WALL_CHAIR_RAIL_DEFAULT,
  WALL_CROWN_DEFAULT,
  WALL_FACE_BAND_DEFAULT,
  WALL_SKIRTING_DEFAULT,
} from '@pascal-app/core'
import {
  type PanelRow,
  curveReshapeScope,
  triggerSFX,
  useInteractionScope,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { hasWallCurveBlockingChildren } from './curve-eligibility'
import { resolveWallOpeningCeiling } from '../shared/wall-opening-ceiling'

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
  const length = getWallCurveLength(node)
  number('Dimensions', 'wall-length', 'Length', length, 0.1, 1000, 0.05, (next) => {
    if (!length) return
    const ratio = next / length
    update({
      end: [
        node.start[0] + (node.end[0] - node.start[0]) * ratio,
        node.start[1] + (node.end[1] - node.start[1]) * ratio,
      ],
      ...(node.curveOffset ? { curveOffset: getClampedWallCurveOffset(node) * ratio } : {}),
    })
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
  const bands = getWallFaceBandConfig(node, height)
  number(
    'Wall bands',
    'wall-band-count',
    'Bands',
    bands.count,
    1,
    4,
    1,
    (count) => update(buildWallFaceBandCountPatch(node, Math.round(count))),
    '',
  )
  const band = (key: 'lowerHeight' | 'middleHeight' | 'upperHeight', label: string, max: number) =>
    number(
      'Wall bands',
      `wall-band-${key}`,
      label,
      bands[key],
      0,
      Math.max(0, max),
      0.01,
      (value) =>
        update({
          faceBands: {
            ...WALL_FACE_BAND_DEFAULT,
            ...node.faceBands,
            enabled: bands.count > 1,
            count: bands.count,
            [key]: value,
          },
        }),
    )
  if (bands.count >= 2) band('lowerHeight', 'Lower', height)
  if (bands.count >= 3) band('middleHeight', 'Middle', height - bands.lowerHeight)
  if (bands.count >= 4)
    band('upperHeight', 'Upper', height - bands.lowerHeight - bands.middleHeight)
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
    cycle(title, `${key}-sides`, 'Sides', trim.sides, ['interior', 'exterior', 'both'], (sides) =>
      patch({ sides: sides as typeof trim.sides }),
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
