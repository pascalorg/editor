import type {
  AnyNode,
  DoorNode,
  FloorplanGeometry,
  LevelNode,
  WallNode,
  WindowNode,
} from '@pascal-app/core'
import { type FloorplanSchedule, withFloorplanGeometryMetadata } from '@pascal-app/editor'
import {
  type ConstructionLengthProfile,
  type ConstructionLinearUnit,
  formatConstructionLength,
} from './construction-length'

type OpeningNode = DoorNode | WindowNode
type OpeningKind = OpeningNode['type']

export type OpeningConstructionType = 'framed' | 'masonry'
export type OpeningDimensionReference =
  | 'nominal'
  | 'rough-opening'
  | 'masonry-opening'
  | 'finish-opening'

export type OpeningDimensionDocumentation = {
  constructionType: OpeningConstructionType
  reference: OpeningDimensionReference
  locationPolicy: 'centerline' | 'edge-to-edge'
  width: number | null
  height: number | null
  prefix: string
  verified: boolean
}

export type OpeningFloorplanLevelData = {
  markById: ReadonlyMap<string, string>
}

type MarkResolution = OpeningFloorplanLevelData & {
  issues: readonly string[]
}

export function computeDoorFloorplanLevelData(args: {
  siblings: ReadonlyArray<DoorNode>
  nodes: Record<string, AnyNode>
}): OpeningFloorplanLevelData {
  return resolveOpeningMarks(args.siblings, args.nodes, 'door')
}

export function computeWindowFloorplanLevelData(args: {
  siblings: ReadonlyArray<WindowNode>
  nodes: Record<string, AnyNode>
}): OpeningFloorplanLevelData {
  return resolveOpeningMarks(args.siblings, args.nodes, 'window')
}

export function buildDoorFloorplanSchedule(args: {
  siblings: ReadonlyArray<DoorNode>
  nodes: Readonly<Record<string, AnyNode>>
  levelId: string
  unit: ConstructionLinearUnit
  profile?: ConstructionLengthProfile
}): FloorplanSchedule | null {
  if (args.siblings.length === 0) return null
  const marks = resolveOpeningMarks(args.siblings, args.nodes, 'door', args.levelId)
  return {
    id: 'doors',
    title: 'DOOR SCHEDULE',
    columns: [
      { key: 'mark', label: 'MARK', weight: 0.65 },
      { key: 'type', label: 'TYPE', weight: 1.25 },
      { key: 'size', label: 'NOMINAL SIZE', weight: 1.35 },
      { key: 'roughOpening', label: 'ROUGH OPENING', weight: 1.35 },
      { key: 'operation', label: 'OPERATION', weight: 1.35 },
      { key: 'frame', label: 'FRAME T / D', weight: 1.25 },
      { key: 'hardware', label: 'HARDWARE', weight: 1.35 },
    ],
    rows: args.siblings.map((door) => ({
      id: door.id,
      cells: {
        mark: marks.markById.get(door.id) ?? '—',
        type: door.openingKind === 'opening' ? 'Opening' : titleCase(door.doorType),
        size: formatSize(door.width, door.height, args.unit, args.profile ?? 'document'),
        roughOpening: formatRoughOpening(door, args.unit, args.profile ?? 'document'),
        operation: doorOperation(door),
        frame: `${formatConstructionLength(door.frameThickness, args.unit, args.profile ?? 'document')} / ${formatConstructionLength(door.frameDepth, args.unit, args.profile ?? 'document')}`,
        hardware: doorHardware(door),
      },
    })),
    issues: marks.issues,
  }
}

export function buildWindowFloorplanSchedule(args: {
  siblings: ReadonlyArray<WindowNode>
  nodes: Readonly<Record<string, AnyNode>>
  levelId: string
  unit: ConstructionLinearUnit
  profile?: ConstructionLengthProfile
}): FloorplanSchedule | null {
  if (args.siblings.length === 0) return null
  const marks = resolveOpeningMarks(args.siblings, args.nodes, 'window', args.levelId)
  return {
    id: 'windows',
    title: 'WINDOW SCHEDULE',
    columns: [
      { key: 'mark', label: 'MARK', weight: 0.65 },
      { key: 'type', label: 'TYPE', weight: 1.2 },
      { key: 'size', label: 'NOMINAL SIZE', weight: 1.35 },
      { key: 'roughOpening', label: 'ROUGH OPENING', weight: 1.35 },
      { key: 'sill', label: 'SILL', weight: 0.9 },
      { key: 'head', label: 'HEAD', weight: 0.9 },
      { key: 'operation', label: 'OPERATION', weight: 1.35 },
    ],
    rows: args.siblings.map((window) => ({
      id: window.id,
      cells: {
        mark: marks.markById.get(window.id) ?? '—',
        type: window.openingKind === 'opening' ? 'Opening' : titleCase(window.windowType),
        size: formatSize(window.width, window.height, args.unit, args.profile ?? 'document'),
        roughOpening: formatRoughOpening(window, args.unit, args.profile ?? 'document'),
        sill: formatConstructionLength(
          Math.max(0, window.position[1] - window.height / 2),
          args.unit,
          args.profile ?? 'document',
        ),
        head: formatConstructionLength(
          window.position[1] + window.height / 2,
          args.unit,
          args.profile ?? 'document',
        ),
        operation: windowOperation(window),
      },
    })),
    issues: marks.issues,
  }
}

export function buildOpeningMarkAnnotation(
  opening: OpeningNode,
  wall: WallNode,
  levelData: OpeningFloorplanLevelData | undefined,
  {
    preferredSide = -1,
    stroke = '#334155',
  }: {
    preferredSide?: -1 | 1
    stroke?: string
  } = {},
): FloorplanGeometry | null {
  const dx = wall.end[0] - wall.start[0]
  const dz = wall.end[1] - wall.start[1]
  const wallLength = Math.hypot(dx, dz)
  if (wallLength < 1e-6) return null

  const dirX = dx / wallLength
  const dirZ = dz / wallLength
  const normalX = -dirZ
  const normalZ = dirX
  const side = interiorSide(wall, preferredSide)
  const openingCenterX = wall.start[0] + dirX * opening.position[0]
  const openingCenterZ = wall.start[1] + dirZ * opening.position[0]
  const halfDepth = (wall.thickness ?? 0.1) / 2
  const bubbleOffset = halfDepth + 0.5
  const bubbleX = openingCenterX + normalX * bubbleOffset * side
  const bubbleZ = openingCenterZ + normalZ * bubbleOffset * side
  const explicitMark = opening.mark?.trim()
  const mark = levelData?.markById.get(opening.id) ?? (explicitMark || fallbackMark(opening))
  const bubbleWidth = Math.max(0.38, mark.length * 0.105 + 0.18)
  const bubbleHeight = 0.32
  const leaderEndOffset = bubbleOffset - bubbleHeight / 2

  return withFloorplanGeometryMetadata(
    {
      kind: 'group',
      children: [
        {
          kind: 'line',
          x1: openingCenterX + normalX * halfDepth * side,
          y1: openingCenterZ + normalZ * halfDepth * side,
          x2: openingCenterX + normalX * leaderEndOffset * side,
          y2: openingCenterZ + normalZ * leaderEndOffset * side,
          stroke,
          strokeWidth: 0.018,
        },
        {
          kind: 'rect',
          x: bubbleX - bubbleWidth / 2,
          y: bubbleZ - bubbleHeight / 2,
          width: bubbleWidth,
          height: bubbleHeight,
          rx: bubbleHeight / 2,
          ry: bubbleHeight / 2,
          fill: '#ffffff',
          stroke,
          strokeWidth: 0.02,
        },
        {
          kind: 'text',
          x: bubbleX,
          y: bubbleZ,
          text: mark,
          fontSize: 0.15,
          fill: stroke,
          fontWeight: 700,
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          textAnchor: 'middle',
          dominantBaseline: 'middle',
          upright: true,
        },
      ],
    },
    { annotationRole: 'opening-mark' },
  )
}

export function resolveOpeningDimensionDocumentation(
  opening: OpeningNode,
): OpeningDimensionDocumentation {
  const constructionType = opening.constructionType ?? 'framed'
  const requestedReference =
    constructionType === 'masonry' &&
    opening.dimensionReference === 'nominal' &&
    opening.masonryOpeningWidth !== undefined
      ? 'masonry-opening'
      : (opening.dimensionReference ?? 'nominal')

  const dimensions = openingDocumentationDimensions(opening, requestedReference)

  return {
    constructionType,
    reference: requestedReference,
    locationPolicy: constructionType === 'masonry' ? 'edge-to-edge' : 'centerline',
    width: dimensions.width,
    height: dimensions.height,
    prefix: openingDimensionPrefix(requestedReference),
    verified: requestedReference === 'nominal' || dimensions.width !== null,
  }
}

function resolveOpeningMarks<T extends OpeningNode>(
  openings: ReadonlyArray<T>,
  nodes: Readonly<Record<string, AnyNode>>,
  kind: OpeningKind,
  explicitLevelId?: string,
): MarkResolution {
  const markById = new Map<string, string>()
  const explicitMarks = new Map<string, string[]>()
  const used = new Set<string>()

  for (const opening of openings) {
    const mark = opening.mark?.trim()
    if (!mark) continue
    markById.set(opening.id, mark)
    used.add(mark.toLocaleUpperCase())
    const normalized = mark.toLocaleUpperCase()
    const ids = explicitMarks.get(normalized)
    if (ids) ids.push(opening.id)
    else explicitMarks.set(normalized, [opening.id])
  }

  const level = resolveLevel(openings[0], nodes, explicitLevelId)
  let sequence = 1
  for (const opening of openings) {
    if (markById.has(opening.id)) continue
    let candidate = automaticMark(kind, level?.level ?? 0, sequence)
    while (used.has(candidate.toLocaleUpperCase())) {
      sequence++
      candidate = automaticMark(kind, level?.level ?? 0, sequence)
    }
    markById.set(opening.id, candidate)
    used.add(candidate.toLocaleUpperCase())
    sequence++
  }

  const issues = [...explicitMarks.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([mark, ids]) => `Duplicate ${kind} mark ${mark} (${ids.length} instances)`)

  return { markById, issues }
}

function resolveLevel(
  opening: OpeningNode | undefined,
  nodes: Readonly<Record<string, AnyNode>>,
  explicitLevelId?: string,
): LevelNode | undefined {
  const explicit = explicitLevelId ? nodes[explicitLevelId] : undefined
  if (explicit?.type === 'level') return explicit

  let current: AnyNode | undefined = opening
  const visited = new Set<string>()
  while (current?.parentId && !visited.has(current.parentId)) {
    visited.add(current.parentId)
    current = nodes[current.parentId]
    if (current?.type === 'level') return current
  }
  return undefined
}

function automaticMark(kind: OpeningKind, level: number, sequence: number): string {
  if (kind === 'door') return String((Math.max(0, level) + 1) * 100 + sequence)
  return `W${String(sequence).padStart(2, '0')}`
}

function fallbackMark(opening: OpeningNode): string {
  return opening.type === 'door' ? 'D?' : 'W?'
}

function interiorSide(wall: WallNode, fallback: -1 | 1): -1 | 1 {
  if (wall.frontSide === 'exterior' && wall.backSide !== 'exterior') return -1
  if (wall.backSide === 'exterior' && wall.frontSide !== 'exterior') return 1
  return fallback
}

function formatSize(
  width: number,
  height: number,
  unit: ConstructionLinearUnit,
  profile: ConstructionLengthProfile,
): string {
  return `${formatConstructionLength(width, unit, profile)} x ${formatConstructionLength(height, unit, profile)}`
}

function formatRoughOpening(
  opening: OpeningNode,
  unit: ConstructionLinearUnit,
  profile: ConstructionLengthProfile,
): string {
  if (opening.roughOpeningWidth === undefined || opening.roughOpeningHeight === undefined) {
    return 'VERIFY'
  }
  return formatSize(opening.roughOpeningWidth, opening.roughOpeningHeight, unit, profile)
}

function openingDocumentationDimensions(
  opening: OpeningNode,
  reference: OpeningDimensionReference,
): { width: number | null; height: number | null } {
  switch (reference) {
    case 'nominal':
      return { width: opening.width, height: opening.height }
    case 'rough-opening':
      return {
        width: opening.roughOpeningWidth ?? null,
        height: opening.roughOpeningHeight ?? null,
      }
    case 'masonry-opening':
      return {
        width: opening.masonryOpeningWidth ?? null,
        height: opening.masonryOpeningHeight ?? null,
      }
    case 'finish-opening':
      return {
        width: opening.finishOpeningWidth ?? null,
        height: opening.finishOpeningHeight ?? null,
      }
  }
}

function openingDimensionPrefix(reference: OpeningDimensionReference): string {
  switch (reference) {
    case 'nominal':
      return ''
    case 'rough-opening':
      return 'RO'
    case 'masonry-opening':
      return 'MO'
    case 'finish-opening':
      return 'FO'
  }
}

function doorOperation(door: DoorNode): string {
  if (door.openingKind === 'opening') return 'None'
  if (door.doorType === 'hinged')
    return `${titleCase(door.hingesSide)} / ${titleCase(door.swingDirection)}`
  if (door.doorType === 'sliding' || door.doorType === 'pocket' || door.doorType === 'barn') {
    return `Slide ${titleCase(door.slideDirection)}`
  }
  return titleCase(door.doorType)
}

function doorHardware(door: DoorNode): string {
  if (door.openingKind === 'opening') return 'None'
  const hardware = []
  if (door.doorCloser) hardware.push('Closer')
  if (door.panicBar) hardware.push('Panic bar')
  if (door.threshold) hardware.push('Threshold')
  return hardware.length > 0 ? hardware.join(', ') : 'Standard'
}

function windowOperation(window: WindowNode): string {
  if (window.openingKind === 'opening') return 'None'
  if (window.windowType === 'fixed') return 'Fixed'
  if (window.windowType === 'casement') {
    return window.casementStyle === 'french'
      ? 'French casement'
      : `${titleCase(window.hingesSide)} hinge`
  }
  if (window.windowType === 'awning' || window.windowType === 'hopper') {
    return titleCase(window.awningDirection)
  }
  return titleCase(window.windowType)
}

function titleCase(value: string): string {
  return value
    .split('-')
    .map((part) => part.charAt(0).toLocaleUpperCase() + part.slice(1))
    .join(' ')
}
