import type {
  ConstructionNoteNode,
  FloorplanGeometry,
  FloorplanPoint,
  FloorplanStyle,
  GeometryContext,
} from '@pascal-app/core'
import { formatConstructionLength } from '../shared/construction-length'
import { resolveConstructionNoteLeader } from './leader-geometry'
import { resolveConstructionNoteAnchor } from './resolve'

const NOTE_STROKE = '#334155'
const DANGLING_STROKE = '#dc2626'
const SELECTED_STROKE = '#ea580c'
const TEXT_FONT_SIZE = 0.16
const TEXT_LINE_HEIGHT = 0.21
const ARROW_LENGTH = 0.16
const ARROW_HALF_WIDTH = 0.065

export function buildConstructionNoteFloorplan(
  node: ConstructionNoteNode,
  ctx: GeometryContext,
): FloorplanGeometry | null {
  if (node.visible === false) return null

  const resolved = resolveConstructionNoteAnchor(node, (id) => ctx.resolve(id))
  const selected = ctx.viewState?.selected === true || ctx.viewState?.highlighted === true
  const stroke = selected
    ? (ctx.viewState?.palette?.selectedStroke ?? SELECTED_STROKE)
    : resolved.dangling
      ? DANGLING_STROKE
      : NOTE_STROKE
  const leader = resolveConstructionNoteLeader(node, resolved.point)
  const textAnchor = leader.side > 0 ? 'start' : 'end'
  const lines = normalizeNoteLines(node, resolved.dangling, ctx.viewState?.unit ?? 'metric')
  const lineStyle: FloorplanStyle = {
    stroke,
    strokeWidth: selected ? 1.25 : 0.9,
    vectorEffect: 'non-scaling-stroke',
    strokeLinecap: 'butt',
    strokeLinejoin: 'miter',
    pointerEvents: 'none',
  }
  const children: FloorplanGeometry[] = [
    ...buildOverheadOutline(node, resolved.point, stroke, selected),
    ...buildLeader(node, resolved.point, leader, lineStyle),
    ...buildTerminator(
      node.terminator,
      resolved.point,
      node.leaderStyle === 'curved' ? leader.quadraticControlPoint : leader.elbow,
      stroke,
    ),
    ...lines.map(
      (text, index): FloorplanGeometry => ({
        kind: 'text',
        x: node.textPosition[0],
        y: node.textPosition[1] + index * TEXT_LINE_HEIGHT,
        text,
        fontSize: TEXT_FONT_SIZE,
        fill: stroke,
        fontWeight: 500,
        fontFamily: 'Arial, Helvetica, sans-serif',
        textAnchor,
        dominantBaseline: 'alphabetic',
        upright: true,
      }),
    ),
  ]

  const textWidth = Math.max(...lines.map((line) => Math.max(1, line.length))) * 0.092
  children.push({
    kind: 'rect',
    x: leader.side > 0 ? node.textPosition[0] - 0.04 : node.textPosition[0] - textWidth - 0.04,
    y: node.textPosition[1] - TEXT_FONT_SIZE,
    width: textWidth + 0.08,
    height: Math.max(TEXT_LINE_HEIGHT, lines.length * TEXT_LINE_HEIGHT),
    fill: 'transparent',
    pointerEvents: 'all',
  })

  if (ctx.viewState?.selected === true) {
    children.push(
      {
        kind: 'endpoint-handle',
        point: resolved.point,
        state: 'idle',
        affordance: 'move-construction-note-anchor',
        payload: null,
      },
      {
        kind: 'endpoint-handle',
        point: node.textPosition,
        state: 'idle',
        variant: 'curve',
        affordance: 'move-construction-note-text',
        payload: null,
      },
      ...(node.leaderStyle === 'curved'
        ? ([
            {
              kind: 'endpoint-handle',
              point: leader.curveHandlePoint,
              state: 'idle',
              variant: 'curve',
              affordance: 'move-construction-note-curve',
              payload: null,
            },
          ] satisfies FloorplanGeometry[])
        : []),
    )
  }

  return { kind: 'group', children }
}

function buildLeader(
  node: ConstructionNoteNode,
  anchor: FloorplanPoint,
  leader: ReturnType<typeof resolveConstructionNoteLeader>,
  style: FloorplanStyle,
): FloorplanGeometry[] {
  if (node.leaderStyle === 'straight') {
    return [
      {
        kind: 'polyline',
        points: [anchor, leader.elbow, leader.shoulderEnd],
        fill: 'none',
        ...style,
      },
      ...buildHitLines([anchor, leader.elbow, leader.shoulderEnd]),
    ]
  }

  const curvePoints = sampleQuadraticBezier(anchor, leader.quadraticControlPoint, leader.elbow, 10)
  return [
    {
      kind: 'path',
      d: `M ${anchor[0]} ${anchor[1]} Q ${leader.quadraticControlPoint[0]} ${leader.quadraticControlPoint[1]} ${leader.elbow[0]} ${leader.elbow[1]} L ${leader.shoulderEnd[0]} ${leader.shoulderEnd[1]}`,
      fill: 'none',
      ...style,
    },
    ...buildHitLines([...curvePoints, leader.shoulderEnd]),
  ]
}

function buildHitLines(points: FloorplanPoint[]): FloorplanGeometry[] {
  return points.slice(0, -1).map((point, index) => ({
    kind: 'hit-line',
    x1: point[0],
    y1: point[1],
    x2: points[index + 1]?.[0] ?? point[0],
    y2: points[index + 1]?.[1] ?? point[1],
    strokeWidthPx: 12,
  }))
}

function sampleQuadraticBezier(
  start: FloorplanPoint,
  control: FloorplanPoint,
  end: FloorplanPoint,
  segments: number,
): FloorplanPoint[] {
  return Array.from({ length: segments + 1 }, (_, index) => {
    const t = index / segments
    const inverse = 1 - t
    return [
      inverse * inverse * start[0] + 2 * inverse * t * control[0] + t * t * end[0],
      inverse * inverse * start[1] + 2 * inverse * t * control[1] + t * t * end[1],
    ]
  })
}

function normalizeNoteLines(
  node: ConstructionNoteNode,
  dangling: boolean,
  unit: 'metric' | 'imperial',
): string[] {
  const customLines = node.text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  const specialtyLines = buildSpecialtyLines(node, unit)
  const includeCustom = specialtyLines.length === 0 || node.text !== 'CONSTRUCTION NOTE'
  const normalized = [...specialtyLines, ...(includeCustom ? customLines : [])]
  if (normalized.length === 0) normalized.push('CONSTRUCTION NOTE')

  const scopePrefix =
    node.contractScope === 'nic'
      ? 'NIC'
      : node.contractScope === 'owner'
        ? 'OWNER PROVIDED'
        : node.contractScope === 'existing'
          ? 'EXISTING'
          : null
  if (scopePrefix) normalized[0] = `${scopePrefix} · ${normalized[0]}`
  if (node.scopeReference) normalized.push(`SCOPE · ${node.scopeReference.toLocaleUpperCase()}`)
  if (dangling) normalized[0] = `UNLINKED · ${normalized[0]}`
  return normalized
}

function buildSpecialtyLines(node: ConstructionNoteNode, unit: 'metric' | 'imperial'): string[] {
  const specialty = node.specialty
  if (!specialty) return []

  switch (specialty.kind) {
    case 'access':
      return [
        `${displayLabel(specialty.spaceType)} ${displayLabel(specialty.accessType)} ACCESS`,
        `OPENING ${formatConstructionLength(specialty.openingWidth, unit)} x ${formatConstructionLength(specialty.openingHeight, unit)}`,
      ]
    case 'rated-assembly':
      return [
        `${displayLabel(specialty.assemblyType)} · ${specialty.ratingMinutes} MIN`,
        ...(specialty.assemblyReference ? [specialty.assemblyReference.toLocaleUpperCase()] : []),
      ]
    case 'plumbing-fixture':
      return [
        `${displayLabel(specialty.fixtureType)} · ${specialty.material.toLocaleUpperCase()}`,
        `${formatConstructionLength(specialty.width, unit)} x ${formatConstructionLength(specialty.depth, unit)}`,
      ]
    case 'solid-fuel':
      return [
        displayLabel(specialty.applianceType),
        `MIN CLR ${formatConstructionLength(specialty.minimumClearance, unit)}`,
        ...(specialty.requirement ? [specialty.requirement.toLocaleUpperCase()] : []),
      ]
    case 'closet': {
      const shelfLabel = specialty.shelfCount === 1 ? 'SHELF' : 'SHELVES'
      return [
        `${displayLabel(specialty.closetType)} CLOSET`,
        `${specialty.shelfCount} ${shelfLabel} @ ${formatConstructionLength(specialty.shelfDepth, unit)}${specialty.hasPole ? ' + POLE' : ''}`,
      ]
    }
    case 'equipment':
      return [
        `${specialty.identifier.toLocaleUpperCase()} · ${specialty.equipmentType.toLocaleUpperCase()}`,
      ]
    case 'overhead':
      return [
        `${displayLabel(specialty.outlineType)} ABOVE`,
        `${formatConstructionLength(specialty.width, unit)} x ${formatConstructionLength(specialty.depth, unit)}`,
      ]
  }
}

function buildOverheadOutline(
  node: ConstructionNoteNode,
  anchor: FloorplanPoint,
  stroke: string,
  selected: boolean,
): FloorplanGeometry[] {
  const specialty = node.specialty
  if (specialty?.kind !== 'overhead') return []
  const halfWidth = specialty.width / 2
  const halfDepth = specialty.depth / 2
  const cosine = Math.cos(specialty.rotation)
  const sine = Math.sin(specialty.rotation)
  const point = (x: number, y: number): FloorplanPoint => [
    anchor[0] + x * cosine - y * sine,
    anchor[1] + x * sine + y * cosine,
  ]
  return [
    {
      kind: 'polygon',
      points: [
        point(-halfWidth, -halfDepth),
        point(halfWidth, -halfDepth),
        point(halfWidth, halfDepth),
        point(-halfWidth, halfDepth),
      ],
      fill: 'none',
      stroke,
      strokeWidth: selected ? 1.25 : 0.9,
      strokeDasharray: '0.18 0.1',
      vectorEffect: 'non-scaling-stroke',
      pointerEvents: 'none',
      annotationObstacle: 'outline',
    },
  ]
}

function displayLabel(value: string): string {
  return value.replaceAll('-', ' ').toLocaleUpperCase()
}

function buildTerminator(
  terminator: ConstructionNoteNode['terminator'],
  anchor: FloorplanPoint,
  elbow: FloorplanPoint,
  stroke: string,
): FloorplanGeometry[] {
  if (terminator === 'none') return []
  if (terminator === 'dot') {
    return [
      {
        kind: 'circle',
        cx: anchor[0],
        cy: anchor[1],
        r: 0.045,
        fill: stroke,
        pointerEvents: 'none',
      },
    ]
  }

  const dx = elbow[0] - anchor[0]
  const dy = elbow[1] - anchor[1]
  const length = Math.hypot(dx, dy)
  if (length < 1e-9) return []
  const dirX = dx / length
  const dirY = dy / length
  const baseX = anchor[0] + dirX * ARROW_LENGTH
  const baseY = anchor[1] + dirY * ARROW_LENGTH
  const perpX = -dirY * ARROW_HALF_WIDTH
  const perpY = dirX * ARROW_HALF_WIDTH
  const style: FloorplanStyle = {
    stroke,
    strokeWidth: 0.9,
    vectorEffect: 'non-scaling-stroke',
    strokeLinecap: 'butt',
    pointerEvents: 'none',
  }
  return [
    {
      kind: 'line',
      x1: anchor[0],
      y1: anchor[1],
      x2: baseX + perpX,
      y2: baseY + perpY,
      ...style,
    },
    {
      kind: 'line',
      x1: anchor[0],
      y1: anchor[1],
      x2: baseX - perpX,
      y2: baseY - perpY,
      ...style,
    },
  ]
}
