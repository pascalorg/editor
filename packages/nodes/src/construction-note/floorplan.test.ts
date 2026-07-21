import { describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  ConstructionNoteNode,
  type FloorplanGeometry,
  type GeometryContext,
  WallNode,
} from '@pascal-app/core'
import { buildConstructionNoteFloorplan } from './floorplan'

const palette = {
  selectedStroke: '#2563eb',
  selectedFill: '#dbeafe',
  selectedHatch: '#93c5fd',
  wallHoverStroke: '#60a5fa',
  endpointHandleFill: '#f97316',
  endpointHandleStroke: '#ffffff',
  endpointHandleHoverStroke: '#fdba74',
  endpointHandleActiveFill: '#ea580c',
  endpointHandleActiveStroke: '#ffffff',
  curveHandleFill: '#14b8a6',
  curveHandleStroke: '#ffffff',
  curveHandleHoverStroke: '#5eead4',
  measurementStroke: '#0f766e',
  measurementLabelBackground: '#ffffff',
  measurementLabelText: '#0f172a',
}

function context(
  nodes: Record<string, AnyNode> = {},
  selected = false,
  unit: 'metric' | 'imperial' = 'imperial',
): GeometryContext {
  return {
    resolve: (id) => nodes[id],
    children: [],
    siblings: [],
    parent: null,
    viewState: {
      selected,
      unit,
      highlighted: false,
      hovered: false,
      moving: false,
      palette,
    },
  }
}

function flatten(geometry: FloorplanGeometry): FloorplanGeometry[] {
  return geometry.kind === 'group' ? [geometry, ...geometry.children.flatMap(flatten)] : [geometry]
}

describe('buildConstructionNoteFloorplan', () => {
  test('builds a straight leader, arrow terminator, shoulder, and multiline text', () => {
    const note = ConstructionNoteNode.parse({
      id: 'construction-note_multiline',
      type: 'construction-note',
      anchor: [1, 1],
      textPosition: [4, 2],
      text: '8x8 BLOCK COLUMN\nGROUT SOLID',
    })

    const geometry = buildConstructionNoteFloorplan(note, context())
    expect(geometry?.kind).toBe('group')
    if (!geometry) return
    const entries = flatten(geometry)
    const leader = entries.find((entry) => entry.kind === 'polyline')
    expect(leader?.kind).toBe('polyline')
    if (leader?.kind === 'polyline') {
      expect(leader.points[0]).toEqual([1, 1])
      expect(leader.points[1]?.[0]).toBeCloseTo(3.35)
      expect(leader.points[1]?.[1]).toBe(2)
      expect(leader.points[2]).toEqual([3.9, 2])
    }
    expect(entries.filter((entry) => entry.kind === 'line')).toHaveLength(2)
    expect(entries.filter((entry) => entry.kind === 'text').map((entry) => entry.text)).toEqual([
      '8x8 BLOCK COLUMN',
      'GROUT SOLID',
    ])
    expect(entries.some((entry) => entry.kind === 'rect' && entry.pointerEvents === 'all')).toBe(
      true,
    )
  })

  test('follows an attached wall and preserves a fallback when the target disappears', () => {
    const wall = WallNode.parse({
      id: 'wall_target',
      parentId: 'level_main',
      start: [0, 0],
      end: [4, 0],
    })
    const note = ConstructionNoteNode.parse({
      id: 'construction-note_attached',
      type: 'construction-note',
      anchor: [2, 0],
      targetId: wall.id,
      targetOffset: [0.25, 0.5],
      textPosition: [5, 2],
      text: 'WALL NOTE',
    })

    const attached = buildConstructionNoteFloorplan(note, context({ [wall.id]: wall }))
    const movedWall = WallNode.parse({ ...wall, start: [2, 1], end: [6, 1] })
    const moved = buildConstructionNoteFloorplan(note, context({ [wall.id]: movedWall }))
    const dangling = buildConstructionNoteFloorplan(note, context())
    const attachedLeader = attached && flatten(attached).find((entry) => entry.kind === 'polyline')
    const movedLeader = moved && flatten(moved).find((entry) => entry.kind === 'polyline')

    expect(attachedLeader).toMatchObject({
      points: [[2.25, 0.5], expect.anything(), expect.anything()],
    })
    expect(movedLeader).toMatchObject({
      points: [[4.25, 1.5], expect.anything(), expect.anything()],
    })
    expect(dangling && flatten(dangling).find((entry) => entry.kind === 'polyline')).toMatchObject({
      points: [[2, 0], expect.anything(), expect.anything()],
      stroke: '#dc2626',
    })
    expect(dangling && flatten(dangling).find((entry) => entry.kind === 'text')).toMatchObject({
      text: 'UNLINKED · WALL NOTE',
    })
  })

  test('shows independent anchor and text handles only while selected', () => {
    const note = ConstructionNoteNode.parse({
      id: 'construction-note_selected',
      type: 'construction-note',
    })
    const idle = buildConstructionNoteFloorplan(note, context())
    const selected = buildConstructionNoteFloorplan(note, context({}, true))

    expect(idle && flatten(idle).filter((entry) => entry.kind === 'endpoint-handle')).toHaveLength(
      0,
    )
    expect(
      selected && flatten(selected).filter((entry) => entry.kind === 'endpoint-handle'),
    ).toHaveLength(2)
  })

  test('builds an editable quadratic curved leader with a tangent arrow', () => {
    const note = ConstructionNoteNode.parse({
      id: 'construction-note_curved',
      type: 'construction-note',
      anchor: [0, 0],
      textPosition: [4, 0],
      leaderStyle: 'curved',
      curveControl: [0.5, 0.5],
    })

    const geometry = buildConstructionNoteFloorplan(note, context({}, true))
    const entries = geometry ? flatten(geometry) : []
    const leader = entries.find((entry) => entry.kind === 'path')
    const handles = entries.filter((entry) => entry.kind === 'endpoint-handle')

    expect(leader?.kind).toBe('path')
    if (leader?.kind === 'path') {
      expect(leader.d).toMatch(/^M 0 0 Q /)
      expect(leader.d).toContain('L 3.9 0')
    }
    expect(entries.filter((entry) => entry.kind === 'hit-line')).toHaveLength(11)
    expect(handles).toHaveLength(3)
    expect(handles).toContainEqual(
      expect.objectContaining({ affordance: 'move-construction-note-curve' }),
    )
    expect(entries.filter((entry) => entry.kind === 'line')).toHaveLength(2)
  })

  test('derives standardized text for every specialty-note category', () => {
    const cases = [
      {
        specialty: { kind: 'access', spaceType: 'attic', openingWidth: 0.6, openingHeight: 0.75 },
        expected: ['ATTIC SCUTTLE ACCESS', 'OPENING 0.6m x 0.75m'],
      },
      {
        specialty: { kind: 'rated-assembly', ratingMinutes: 90, assemblyReference: 'UL U305' },
        expected: ['FIREWALL · 90 MIN', 'UL U305'],
      },
      {
        specialty: { kind: 'plumbing-fixture', fixtureType: 'tub', width: 1.5, depth: 0.75 },
        expected: ['TUB · ACRYLIC', '1.5m x 0.75m'],
      },
      {
        specialty: { kind: 'solid-fuel', applianceType: 'wood-stove', minimumClearance: 0.45 },
        expected: ['WOOD STOVE', 'MIN CLR 0.45m', 'INSTALL PER LISTING'],
      },
      {
        specialty: { kind: 'closet', closetType: 'walk-in', shelfCount: 3, hasPole: true },
        expected: ['WALK IN CLOSET', '3 SHELVES @ 0.35m + POLE'],
      },
      {
        specialty: { kind: 'equipment', identifier: 'WH-1', equipmentType: 'water heater' },
        expected: ['WH-1 · WATER HEATER'],
      },
      {
        specialty: { kind: 'overhead', outlineType: 'balcony', width: 4, depth: 1.5 },
        expected: ['BALCONY ABOVE', '4m x 1.5m'],
      },
    ] as const

    for (const [index, fixture] of cases.entries()) {
      const note = ConstructionNoteNode.parse({
        id: `construction-note_specialty-${index}`,
        type: 'construction-note',
        specialty: fixture.specialty,
      })
      const geometry = buildConstructionNoteFloorplan(note, context({}, false, 'metric'))
      const lines = geometry
        ? flatten(geometry)
            .filter((entry) => entry.kind === 'text')
            .map((entry) => entry.text)
        : []
      expect(lines).toEqual(fixture.expected)
    }
  })

  test('renders contract scope and a dashed rotated overhead outline', () => {
    const note = ConstructionNoteNode.parse({
      id: 'construction-note_balcony-above',
      type: 'construction-note',
      anchor: [2, 3],
      specialty: {
        kind: 'overhead',
        outlineType: 'balcony',
        width: 4,
        depth: 2,
        rotation: Math.PI / 2,
      },
      contractScope: 'nic',
      scopeReference: 'BY OWNER',
    })
    const geometry = buildConstructionNoteFloorplan(note, context({}, false, 'metric'))
    const entries = geometry ? flatten(geometry) : []
    const outline = entries.find(
      (entry) => entry.kind === 'polygon' && entry.strokeDasharray === '0.18 0.1',
    )

    expect(entries.filter((entry) => entry.kind === 'text').map((entry) => entry.text)).toEqual([
      'NIC · BALCONY ABOVE',
      '4m x 2m',
      'SCOPE · BY OWNER',
    ])
    expect(outline).toMatchObject({
      kind: 'polygon',
      fill: 'none',
      annotationObstacle: 'outline',
      annotationRole: 'overhead-geometry',
    })
    if (outline?.kind === 'polygon') {
      expect(outline.points[0]?.[0]).toBeCloseTo(3)
      expect(outline.points[0]?.[1]).toBeCloseTo(1)
    }
  })
})
