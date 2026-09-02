import { describe, expect, test } from 'bun:test'
import {
  assemblyThickness,
  type FloorplanGeometry,
  type FloorplanPalette,
  type GeometryContext,
  WallNode,
} from '@pascal-app/core'
import { createFloorplanContextExtensions, readFloorplanGeometryMetadata } from '@pascal-app/editor'
import { buildWallFloorplan } from './floorplan'

const palette: FloorplanPalette = {
  selectedStroke: '#334155',
  selectedFill: '#ffffff',
  selectedHatch: '#334155',
  wallHoverStroke: '#334155',
  endpointHandleFill: '#ffffff',
  endpointHandleStroke: '#334155',
  endpointHandleHoverStroke: '#334155',
  endpointHandleActiveFill: '#334155',
  endpointHandleActiveStroke: '#334155',
  curveHandleFill: '#ffffff',
  curveHandleStroke: '#334155',
  curveHandleHoverStroke: '#334155',
  measurementStroke: '#334155',
  measurementLabelBackground: '#ffffff',
  measurementLabelText: '#111827',
}

function context(
  purpose: 'edit' | 'document',
  selected = false,
  metricNotation: 'meters' | 'millimeters' = 'meters',
  wallDimensionReference: 'finished-faces' | 'centerline' | 'stud-faces' = 'finished-faces',
  automaticDimensions = true,
): GeometryContext {
  return {
    resolve: () => undefined,
    children: [],
    siblings: [],
    parent: null,
    viewState: {
      selected,
      unit: 'metric',
      highlighted: false,
      hovered: false,
      moving: false,
      palette,
    },
    extensions: createFloorplanContextExtensions({
      automaticDimensions,
      metricNotation,
      purpose,
      wallDimensionReference,
    }),
  }
}

function flatten(geometry: FloorplanGeometry): FloorplanGeometry[] {
  return geometry.kind === 'group' ? [geometry, ...geometry.children.flatMap(flatten)] : [geometry]
}

describe('buildWallFloorplan render purpose', () => {
  const wall = WallNode.parse({
    id: 'wall_main',
    parentId: 'level_main',
    start: [0, 0],
    end: [4, 0],
    thickness: 0.1,
    frontSide: 'exterior',
    backSide: 'interior',
  })

  test('keeps thin walls legible in edit mode but uses modeled thickness in documents', () => {
    const edit = buildWallFloorplan(wall, context('edit'))
    const document = buildWallFloorplan(wall, context('document'))
    const editPolygon = edit && flatten(edit).find((entry) => entry.kind === 'polygon')
    const documentPolygon = document && flatten(document).find((entry) => entry.kind === 'polygon')

    expect(editPolygon?.kind).toBe('polygon')
    expect(documentPolygon?.kind).toBe('polygon')
    if (editPolygon?.kind !== 'polygon' || documentPolygon?.kind !== 'polygon') return

    const editThickness =
      Math.max(...editPolygon.points.map((point) => point[1])) -
      Math.min(...editPolygon.points.map((point) => point[1]))
    const documentThickness =
      Math.max(...documentPolygon.points.map((point) => point[1])) -
      Math.min(...documentPolygon.points.map((point) => point[1]))
    expect(editThickness).toBeCloseTo(0.13)
    expect(documentThickness).toBeCloseTo(0.1)
    expect(readFloorplanGeometryMetadata(editPolygon).annotationObstacle).toBe('outline')
    expect(readFloorplanGeometryMetadata(documentPolygon).annotationObstacle).toBe('outline')
  })

  test('draws crisp diagonal hatch strokes inside a selected wall', () => {
    const diagonalWall = WallNode.parse({
      ...wall,
      end: [4, 4],
    })
    const selected = buildWallFloorplan(diagonalWall, context('edit', true))
    const selectedOutline = selected
      ? flatten(selected).find((entry) => entry.kind === 'polygon')
      : undefined
    const hatchLines = selected
      ? flatten(selected).filter(
          (entry) => entry.kind === 'line' && entry.stroke === palette.selectedHatch,
        )
      : []

    expect(selectedOutline?.kind).toBe('polygon')
    expect(hatchLines.length).toBeGreaterThan(8)
    expect(
      hatchLines.every(
        (entry) =>
          entry.kind === 'line' &&
          entry.strokeWidth === 0.02 &&
          entry.strokeWidth < (selectedOutline?.strokeWidth ?? 0) &&
          entry.vectorEffect === undefined &&
          entry.pointerEvents === 'none' &&
          readFloorplanGeometryMetadata(entry).renderPass === 'overlay',
      ),
    ).toBe(true)
  })

  test('extends selected-wall hatch strokes to both wall faces', () => {
    const selected = buildWallFloorplan(wall, context('edit', true))
    const entries = selected ? flatten(selected) : []
    const outline = entries.find((entry) => entry.kind === 'polygon')
    const hatch = entries.find(
      (entry) => entry.kind === 'line' && entry.stroke === palette.selectedHatch,
    )

    expect(outline?.kind).toBe('polygon')
    expect(hatch?.kind).toBe('line')
    if (outline?.kind !== 'polygon' || hatch?.kind !== 'line') return

    const wallFaces = outline.points.map((point) => point[1])
    expect(Math.min(hatch.y1, hatch.y2)).toBeCloseTo(Math.min(...wallFaces))
    expect(Math.max(hatch.y1, hatch.y2)).toBeCloseTo(Math.max(...wallFaces))
  })

  test('uses document metric notation only for document output', () => {
    const edit = buildWallFloorplan(wall, context('edit'))
    const document = buildWallFloorplan(wall, context('document'))
    const texts = (geometry: FloorplanGeometry | null) =>
      geometry
        ? flatten(geometry).flatMap((entry) =>
            entry.kind === 'dimension-string' ? entry.segments.map((segment) => segment.text) : [],
          )
        : []

    expect(texts(edit)).toContain('4m')
    expect(texts(document)).toContain('4000')
  })

  test('uses the live millimeter notation in edit mode', () => {
    const edit = buildWallFloorplan(wall, context('edit', false, 'millimeters'))
    const texts = edit
      ? flatten(edit).flatMap((entry) =>
          entry.kind === 'dimension-string' ? entry.segments.map((segment) => segment.text) : [],
        )
      : []

    expect(texts).toContain('4000')
  })

  test('does not construct automatic wall dimensions when presentation disables them', () => {
    const geometry = buildWallFloorplan(
      wall,
      context('edit', false, 'meters', 'finished-faces', false),
    )
    const entries = geometry ? flatten(geometry) : []

    expect(
      entries.some(
        (entry) =>
          entry.kind === 'dimension' ||
          entry.kind === 'dimension-string' ||
          entry.kind === 'dimension-label',
      ),
    ).toBe(false)
    expect(entries.some((entry) => entry.kind === 'polygon')).toBe(true)
  })

  test('keeps standalone wall witnesses on the wall face in every intersection mode', () => {
    const plainWall = WallNode.parse({
      ...wall,
      thickness: 0.1,
    })
    const witnessY = (reference: 'finished-faces' | 'centerline' | 'stud-faces') => {
      const geometry = buildWallFloorplan(plainWall, context('edit', false, 'meters', reference))
      const dimension = geometry
        ? flatten(geometry).find((entry) => entry.kind === 'dimension-string')
        : undefined
      return dimension?.kind === 'dimension-string' ? dimension.segments[0]?.start[1] : undefined
    }

    expect(witnessY('finished-faces')).toBeCloseTo(0.065)
    expect(witnessY('centerline')).toBeCloseTo(0.065)
    expect(witnessY('stud-faces')).toBeCloseTo(0.065)
  })

  test('shows an orthogonal depth dimension for a curved wall without a radius leader', () => {
    const curved = WallNode.parse({ ...wall, curveOffset: 1 })
    const geometry = buildWallFloorplan(curved, context('edit'))
    const entries = geometry ? flatten(geometry) : []

    expect(entries.find((entry) => entry.kind === 'dimension-label')).toBeUndefined()
    expect(entries.find((entry) => entry.kind === 'dimension-string')).toMatchObject({
      kind: 'dimension-string',
      segments: [{ text: '1m' }],
    })
  })

  test('places selected move arrows on the curved wall midpoint', () => {
    const curved = WallNode.parse({ ...wall, curveOffset: 1 })
    const geometry = buildWallFloorplan(curved, context('edit', true))
    const arrows = geometry ? flatten(geometry).filter((entry) => entry.kind === 'move-arrow') : []

    expect(arrows).toHaveLength(2)
    expect(arrows[0]).toMatchObject({ kind: 'move-arrow', angle: Math.PI / 2 })
    expect(arrows[1]).toMatchObject({ kind: 'move-arrow', angle: -Math.PI / 2 })
    if (arrows[0]?.kind !== 'move-arrow' || arrows[1]?.kind !== 'move-arrow') return
    expect(arrows[0].point[0]).toBeCloseTo(2)
    expect(arrows[0].point[1]).toBeCloseTo(-0.885)
    expect(arrows[1].point[0]).toBeCloseTo(2)
    expect(arrows[1].point[1]).toBeCloseTo(-1.115)
  })
})

describe('buildWallFloorplan assembly layers', () => {
  const assembly = {
    preset: 'exterior-2x6-siding',
    exterior: { finish: 'siding' as const, thickness: 0.75 * 0.0254 },
    sheathing: { material: 'osb' as const, thickness: 0.4375 * 0.0254 },
    framing: { kind: 'wood' as const, depth: 5.5 * 0.0254 },
    interior: { finish: 'drywall' as const, thickness: 0.5 * 0.0254 },
  }
  const layered = WallNode.parse({
    id: 'wall_layered',
    parentId: 'level_main',
    start: [0, 0],
    end: [4, 0],
    thickness: assemblyThickness(assembly),
    assembly,
    frontSide: 'exterior',
    backSide: 'interior',
    type: 'wall',
    name: 'Layered wall',
  })
  const plain = WallNode.parse({
    id: 'wall_plain',
    parentId: 'level_main',
    start: [0, 0],
    end: [4, 0],
    thickness: 0.1,
    frontSide: 'exterior',
    backSide: 'interior',
    type: 'wall',
    name: 'Plain wall',
  })

  test('a wall with no assembly draws exactly what it drew before', () => {
    const built = buildWallFloorplan(plain, context('document'))
    const parts = built ? flatten(built) : []
    expect(parts.some((part) => part.kind === 'hatch')).toBe(false)
  })

  test('document purpose draws the framing poche and one line per interior boundary', () => {
    const built = buildWallFloorplan(layered, context('document'))
    expect(built).not.toBeNull()
    const parts = flatten(built as FloorplanGeometry)
    // 4 layers -> 5 boundaries -> 3 interior lines.
    const hatches = parts.filter((part) => part.kind === 'hatch')
    expect(hatches).toHaveLength(1)
    const lines = parts.filter(
      (part): part is Extract<FloorplanGeometry, { kind: 'line' }> =>
        part.kind === 'line' && part.opacity === 1,
    )
    expect(lines).toHaveLength(3)
    // Straight wall along +x: each boundary sits at its own y offset, all
    // strictly inside the footprint.
    const half = assemblyThickness(assembly) / 2
    for (const line of lines) {
      expect(line.y1).toBeCloseTo(line.y2, 12)
      expect(Math.abs(line.y1)).toBeLessThan(half)
      expect(line.x1).toBeCloseTo(0, 9)
      expect(line.x2).toBeCloseTo(4, 9)
    }
  })

  test('edit purpose keeps the layer lines but drops the poche', () => {
    const built = buildWallFloorplan(layered, context('edit'))
    const parts = flatten(built as FloorplanGeometry)
    expect(parts.some((part) => part.kind === 'hatch')).toBe(false)
    const lines = parts.filter(
      (part): part is Extract<FloorplanGeometry, { kind: 'line' }> => part.kind === 'line',
    )
    expect(lines).toHaveLength(3)
    for (const line of lines) expect(line.opacity).toBeLessThan(1)
  })

  test('an opening cuts through every layer line', () => {
    const ctx = context('document')
    const door = {
      id: 'door_1',
      type: 'door' as const,
      parentId: 'wall_layered',
      position: [2, 0, 0] as [number, number, number],
      width: 0.9,
    }
    const withDoor: GeometryContext = {
      ...ctx,
      children: [door as unknown as GeometryContext['children'][number]],
    }
    const parts = flatten(buildWallFloorplan(layered, withDoor) as FloorplanGeometry)
    const lines = parts.filter(
      (part): part is Extract<FloorplanGeometry, { kind: 'line' }> =>
        part.kind === 'line' && part.opacity === 1,
    )
    // Each of the 3 interior boundaries is cut into two pieces by the door.
    expect(lines).toHaveLength(6)
    for (const line of lines) {
      const lo = Math.min(line.x1, line.x2)
      const hi = Math.max(line.x1, line.x2)
      // No piece overlaps the 1.55..2.45 rough opening.
      expect(hi <= 1.55 + 1e-9 || lo >= 2.45 - 1e-9).toBe(true)
    }
  })
})
