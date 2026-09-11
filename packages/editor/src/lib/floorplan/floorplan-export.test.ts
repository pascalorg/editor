import { describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeDefinition,
  type FloorplanGeometry,
  type GeometryContext,
  loadPlugin,
  type NodeCategory,
  nodeRegistry,
  registerNode,
} from '@pascal-app/core'
import PDFDocument from 'pdfkit'
import { z } from 'zod'
import { splitFloorplanOverlay } from '../../components/editor-2d/renderers/floorplan-registry-layer'
import { DEFAULT_FLOORPLAN_ANNOTATION_VISIBILITY } from './annotation-visibility'
import {
  collectFloorplanGeometry,
  collectFloorplanSchedules,
  filterFloorplanExportOverlay,
  fitPlanToBox,
  isFloorplanExportAnnotationGeometry,
  isFloorplanNodeInExportScope,
  partitionFloorplanExportOverlay,
  resolveFloorplanExportAnnotationVisibility,
  resolveFloorplanExportNodeGeometry,
  resolveFloorplanExportPlacement,
  resolveFloorplanExportRotationDeg,
  resolveFloorplanExportViewport,
  resolveFloorplanExportViewState,
  resolveFloorplanMeasurementSize,
  resolveFloorplanPageLayout,
  resolveFloorplanScreenUnitsPerPixel,
  rotateFloorplanExportBounds,
} from './floorplan-export'
import { floorplanGeometryMetadata } from './floorplan-extension'
import { FloorplanPdfDocument } from './floorplan-pdfkit-document'
import { renderFloorplanGeometryToPdfKit } from './floorplan-pdfkit-renderer'

type GroupGeometry = Extract<FloorplanGeometry, { kind: 'group' }>
type GroupTransform = NonNullable<GroupGeometry['transform']>

function flattenGeometry(geometry: FloorplanGeometry | null): FloorplanGeometry[] {
  if (!geometry) return []
  if (geometry.kind !== 'group') return [geometry]
  return [geometry, ...geometry.children.flatMap(flattenGeometry)]
}

function applyGeometryTransforms(
  point: readonly [number, number],
  transforms: readonly GroupTransform[],
): [number, number] {
  let x = point[0]
  let y = point[1]
  for (let index = transforms.length - 1; index >= 0; index -= 1) {
    const transform = transforms[index]!
    if (transform.rotate !== undefined) {
      const cos = Math.cos(transform.rotate)
      const sin = Math.sin(transform.rotate)
      const rotatedX = x * cos - y * sin
      y = x * sin + y * cos
      x = rotatedX
    }
    if (transform.translate) {
      x += transform.translate[0]
      y += transform.translate[1]
    }
  }
  return [x, y]
}

function projectedGeometryPoint(
  geometry: FloorplanGeometry,
  target: 'circle' | 'image',
  transforms: readonly GroupTransform[] = [],
): [number, number] | null {
  if (geometry.kind === target) {
    const point =
      geometry.kind === 'circle'
        ? ([geometry.cx, geometry.cy] as const)
        : geometry.kind === 'image'
          ? geometry.center
          : null
    return point ? applyGeometryTransforms(point, transforms) : null
  }
  if (geometry.kind !== 'group') return null
  const nestedTransforms = geometry.transform ? [...transforms, geometry.transform] : transforms
  for (const child of geometry.children) {
    const point = projectedGeometryPoint(child, target, nestedTransforms)
    if (point) return point
  }
  return null
}

describe('filterFloorplanExportOverlay', () => {
  test('preserves annotation metadata while splitting geometry passes', () => {
    const contextualDimension = {
      kind: 'group',
      metadata: floorplanGeometryMetadata({ annotationRole: 'contextual-dimension' }),
      children: [
        {
          kind: 'dimension',
          start: [0, 0],
          end: [2, 0],
          offsetNormal: [0, 1],
          offsetDistance: 0.3,
          extensionOvershoot: 0.08,
          text: '2m',
        },
      ],
    } satisfies FloorplanGeometry

    expect(splitFloorplanOverlay(contextualDimension).overlay).toMatchObject(contextualDimension)
  })

  test('preserves value labels and removes editing handles', () => {
    const label = {
      kind: 'dimension-label',
      appearance: 'outlined',
      cx: 1,
      cy: 0,
      text: '2.00m',
      angle: 0,
    } satisfies FloorplanGeometry
    const overlay = {
      kind: 'group',
      children: [
        label,
        {
          kind: 'endpoint-handle',
          point: [0, 0],
          state: 'idle',
          affordance: 'move-measurement-vertex',
          payload: { vertexIndex: 0 },
        },
      ],
    } satisfies FloorplanGeometry

    expect(filterFloorplanExportOverlay(overlay)).toEqual({
      kind: 'group',
      children: [label],
    })
  })

  test('preserves wall, door, and window shapes used as annotation obstacles', () => {
    const fixedGeometry = {
      kind: 'group',
      children: [
        {
          kind: 'polygon',
          points: [
            [0, 0],
            [4, 0],
            [4, 0.2],
            [0, 0.2],
          ],
          fill: '#374151',
          stroke: '#1f2937',
          metadata: floorplanGeometryMetadata({ annotationObstacle: 'outline' }),
        },
        {
          kind: 'path',
          d: 'M 1 0 A 1 1 0 0 1 2 1',
          fill: 'none',
          stroke: '#64748b',
          metadata: floorplanGeometryMetadata({ annotationObstacle: 'bounds' }),
        },
        {
          kind: 'line',
          x1: 2.5,
          y1: 0,
          x2: 3.5,
          y2: 0,
          stroke: '#1f2937',
          metadata: floorplanGeometryMetadata({ annotationObstacle: 'bounds' }),
        },
        { kind: 'move-handle', point: [2, 0.1] },
      ],
    } satisfies FloorplanGeometry

    const { overlay } = splitFloorplanOverlay(fixedGeometry)
    expect(overlay).not.toBeNull()
    expect(filterFloorplanExportOverlay(overlay!)).toEqual({
      kind: 'group',
      children: fixedGeometry.children.slice(0, 3),
      transform: undefined,
    })
  })

  test('keeps structural obstacles in model bounds while leaving marks as annotations', () => {
    const wall = {
      kind: 'polygon',
      points: [
        [0, 0],
        [4, 0],
        [4, 0.2],
        [0, 0.2],
      ],
      fill: '#374151',
      metadata: floorplanGeometryMetadata({ annotationObstacle: 'outline' }),
    } satisfies FloorplanGeometry
    const openingMark = {
      kind: 'group',
      metadata: floorplanGeometryMetadata({ annotationRole: 'opening-mark' }),
      children: [
        {
          kind: 'rect',
          x: 1,
          y: 1,
          width: 0.4,
          height: 0.2,
          fill: '#ffffff',
          stroke: '#334155',
        },
        { kind: 'text', x: 1.2, y: 1.1, text: 'W01', fontSize: 0.1, upright: true },
      ],
    } satisfies FloorplanGeometry

    expect(
      partitionFloorplanExportOverlay({ kind: 'group', children: [wall, openingMark] }),
    ).toEqual({
      model: { kind: 'group', children: [wall], transform: undefined },
      annotations: { kind: 'group', children: [openingMark], transform: undefined },
    })
  })

  test('moves automatic dimensions embedded in base wall geometry into the PDF annotation layer', () => {
    const wall = {
      kind: 'polygon',
      points: [
        [0, 0],
        [4, 0],
        [4, 0.2],
        [0, 0.2],
      ],
      fill: '#374151',
    } satisfies FloorplanGeometry
    const dimensions = {
      kind: 'dimension-string',
      segments: [{ start: [0, 0], end: [4, 0], text: '4m' }],
      offsetNormal: [0, -1],
      offsetDistance: 1,
      extensionOvershoot: 0.12,
    } satisfies FloorplanGeometry

    expect(
      resolveFloorplanExportNodeGeometry(
        { kind: 'group', children: [wall, dimensions] },
        null,
        false,
      ),
    ).toEqual({
      model: { kind: 'group', children: [wall], transform: undefined },
      annotations: { kind: 'group', children: [dimensions], transform: undefined },
    })
  })
})

describe('fitPlanToBox', () => {
  test('preserves aspect ratio and centers the plan', () => {
    expect(fitPlanToBox(20, 10, 10, 20, 400, 300)).toEqual({
      x: 10,
      y: 70,
      width: 400,
      height: 200,
    })
  })
})

describe('floor plan export policy', () => {
  test('uses the live floor-plan formatting profile for metric and imperial dimensions', () => {
    expect(resolveFloorplanExportViewState('metric', 'millimeters')).toMatchObject({
      purpose: 'edit',
      unit: 'metric',
      metricNotation: 'millimeters',
    })
    expect(resolveFloorplanExportViewState('imperial', 'meters')).toMatchObject({
      purpose: 'edit',
      unit: 'imperial',
      metricNotation: 'meters',
    })
  })

  test('fits an oversized plan inside the complete export viewport', () => {
    const placement = resolveFloorplanExportPlacement(30, 20, 10, 20, 400, 300)

    expect(placement.x).toBe(10)
    expect(placement.y).toBeCloseTo(36.67, 2)
    expect(placement.width).toBe(400)
    expect(placement.height).toBeCloseTo(266.67, 2)
    expect(placement.x).toBeGreaterThanOrEqual(10)
    expect(placement.y).toBeGreaterThanOrEqual(20)
    expect(placement.x + placement.width).toBeLessThanOrEqual(410)
    expect(placement.y + placement.height).toBeLessThanOrEqual(320)
  })

  test('exports the same annotation categories that are visible in the live view', () => {
    const liveVisibility = {
      automaticDimensions: true,
      contextualDimensions: false,
      manualDimensions: false,
      measurements: true,
      openingMarks: true,
      structuralGrids: false,
      roomLabels: false,
      stairAnnotations: true,
    }

    expect(resolveFloorplanExportAnnotationVisibility('expert', liveVisibility)).toEqual(
      liveVisibility,
    )
  })

  test('exports only model geometry and room labels in Default', () => {
    expect(
      resolveFloorplanExportAnnotationVisibility(
        'default',
        DEFAULT_FLOORPLAN_ANNOTATION_VISIBILITY,
      ),
    ).toEqual({
      automaticDimensions: false,
      contextualDimensions: false,
      manualDimensions: false,
      measurements: false,
      openingMarks: false,
      structuralGrids: false,
      roomLabels: true,
      stairAnnotations: false,
    })
  })

  test('matches live screen sizing to the fitted export viewport', () => {
    expect(resolveFloorplanScreenUnitsPerPixel(7, 4.5, 572, 463)).toBeCloseTo(0.012_237_762, 8)
  })

  test('keeps the export viewport anchored to the structural drawing bounds', () => {
    expect(resolveFloorplanExportViewport({ x: -5, y: -6, width: 13, height: 13.5 })).toEqual({
      x: -7.7,
      y: -8.7,
      width: 18.4,
      height: 18.9,
    })
  })

  test('fits the viewport around the rotated plan instead of clipping its corners', () => {
    const bounds = rotateFloorplanExportBounds({ x: 0, y: 0, width: 10, height: 5 }, 90)

    expect(bounds.x).toBeCloseTo(-5, 8)
    expect(bounds.y).toBeCloseTo(0, 8)
    expect(bounds.width).toBeCloseTo(5, 8)
    expect(bounds.height).toBeCloseTo(10, 8)
  })

  test('keeps annotation-only nodes out of primary model bounds', () => {
    expect(
      isFloorplanExportAnnotationGeometry({
        kind: 'group',
        children: [],
        metadata: { 'pascal:editor/floorplan': { annotationRole: 'measurement' } },
      }),
    ).toBe(true)
    expect(
      isFloorplanExportAnnotationGeometry({
        kind: 'group',
        children: [],
        metadata: { 'pascal:editor/floorplan': { annotationRole: 'manual-dimension' } },
      }),
    ).toBe(true)
    expect(isFloorplanExportAnnotationGeometry({ kind: 'polygon', points: [] })).toBe(false)
  })

  test('matches the current floor-plan rotation instead of forcing north-up', () => {
    expect(resolveFloorplanExportRotationDeg(Math.PI / 6, Math.PI / 2)).toBeCloseTo(60, 8)
  })
})

describe('resolveFloorplanMeasurementSize', () => {
  test('sizes the hidden SVG in screen pixels before resolving label collisions', () => {
    expect(
      resolveFloorplanMeasurementSize({ x: -2, y: -3, width: 18.4, height: 18.9 }, 0.024),
    ).toEqual({ width: 18.4 / 0.024, height: 18.9 / 0.024 })
  })
})

describe('resolveFloorplanPageLayout', () => {
  test('uses the available A4 page area for the fitted plan', () => {
    expect(resolveFloorplanPageLayout(842, 595)).toEqual({
      planBox: { x: 36, y: 64, width: 770, height: 495 },
    })
  })
})

describe('isFloorplanNodeInExportScope', () => {
  const definition = (category?: NodeCategory) => ({ category })

  test('includes structure-category nodes under structure and full', () => {
    expect(isFloorplanNodeInExportScope(definition('structure'), 'structure')).toBe(true)
    expect(isFloorplanNodeInExportScope(definition('structure'), 'full')).toBe(true)
  })

  test('excludes utility-category nodes under structure', () => {
    expect(isFloorplanNodeInExportScope(definition('utility'), 'full')).toBe(true)
    expect(isFloorplanNodeInExportScope(definition('utility'), 'structure')).toBe(false)
  })

  test('includes furnish-category nodes only under full', () => {
    expect(isFloorplanNodeInExportScope(definition('furnish'), 'full')).toBe(true)
    expect(isFloorplanNodeInExportScope(definition('furnish'), 'structure')).toBe(false)
  })

  test('includes analysis and site-category nodes only under full', () => {
    for (const category of ['analysis', 'site'] as const) {
      expect(isFloorplanNodeInExportScope(definition(category), 'full')).toBe(true)
      expect(isFloorplanNodeInExportScope(definition(category), 'structure')).toBe(false)
    }
  })

  test('excludes nodes with no category except under full', () => {
    expect(isFloorplanNodeInExportScope(definition(undefined), 'full')).toBe(true)
    expect(isFloorplanNodeInExportScope(definition(undefined), 'structure')).toBe(false)
  })

  test('handles an undefined definition like a no-category node', () => {
    expect(isFloorplanNodeInExportScope(undefined, 'full')).toBe(true)
    expect(isFloorplanNodeInExportScope(undefined, 'structure')).toBe(false)
  })
})

describe('collectFloorplanSchedules', () => {
  test('omits non-structure schedule contributors under structure scope', () => {
    const restoreRegistry = nodeRegistry._snapshot()
    const structureKind = 'test:structure-schedule'
    const siteKind = 'test:site-schedule'
    const levelId = 'level_schedules' as AnyNode['id']
    const structureNodeId = 'structure_scheduled' as AnyNode['id']
    const siteNodeId = 'site_scheduled' as AnyNode['id']

    const scheduleFor = (title: string) => ({
      id: title.toLowerCase(),
      title,
      columns: [{ key: 'id', label: 'ID' }],
      rows: [{ id: 'row', cells: { id: '1' } }],
    })

    try {
      nodeRegistry._reset()
      registerNode({
        kind: structureKind,
        schemaVersion: 1,
        schema: z.object({ type: z.literal(structureKind) }) as never,
        category: 'structure',
        defaults: () => ({}) as never,
        capabilities: {},
        extensions: {
          'pascal:editor/floorplan': {
            schedule: () => scheduleFor('Doors'),
          },
        },
      } as AnyNodeDefinition)
      registerNode({
        kind: siteKind,
        schemaVersion: 1,
        schema: z.object({ type: z.literal(siteKind) }) as never,
        category: 'site',
        defaults: () => ({}) as never,
        capabilities: {},
        extensions: {
          'pascal:editor/floorplan': {
            schedule: () => scheduleFor('Rooms'),
          },
        },
      } as AnyNodeDefinition)

      const nodes = {
        [levelId]: {
          id: levelId,
          type: 'level',
          visible: true,
          children: [structureNodeId, siteNodeId],
        },
        [structureNodeId]: {
          id: structureNodeId,
          type: structureKind,
          visible: true,
        },
        [siteNodeId]: {
          id: siteNodeId,
          type: siteKind,
          visible: true,
        },
      } as unknown as Record<string, AnyNode>

      const full = collectFloorplanSchedules(nodes, levelId, 'metric', 'full')
      expect(full.map((schedule) => schedule.title).sort()).toEqual(['Doors', 'Rooms'])

      const structure = collectFloorplanSchedules(nodes, levelId, 'metric', 'structure')
      expect(structure.map((schedule) => schedule.title)).toEqual(['Doors'])
    } finally {
      restoreRegistry()
    }
  })
})

describe('collectFloorplanGeometry', () => {
  test('collects the active Site once below architecture with semantic context and projection', async () => {
    const restoreRegistry = nodeRegistry._snapshot()
    const activeSiteId = 'site_active'
    const otherSiteId = 'site_other'
    const enabledPluginId = 'test:site-pdf-enabled'
    const disabledPluginId = 'test:site-pdf-disabled'
    const enabledKind = 'test:site-pdf-overlay'
    const disabledKind = 'test:site-pdf-disabled-overlay'
    const architectureKind = 'test:level-architecture'
    const semanticChildId = 'site_overlay_detail'
    const referencedNodeId = 'site_reference'
    const inlinePng =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

    const siteDefinition = (
      kind: string,
      floorplan: (node: Record<string, unknown>, context: GeometryContext) => FloorplanGeometry,
    ): AnyNodeDefinition =>
      ({
        kind,
        schemaVersion: 1,
        schema: z.object({ type: z.literal(kind) }) as never,
        category: 'utility',
        defaults: () => ({}) as never,
        capabilities: {},
        floorplanScope: 'site',
        floorplan,
      }) as AnyNodeDefinition

    const enabledDefinition = siteDefinition(enabledKind, (siteOverlay, context) => ({
      kind: 'group',
      children: [
        {
          kind: 'rect',
          x: 10,
          y: 3,
          width: context.children[0]?.id === semanticChildId ? 3 : -3,
          height: context.siblings.some(({ id }) => id === 'site_overlay_hidden') ? 4 : -4,
          fill:
            siteOverlay.id === 'site_overlay' &&
            context.parent?.id === activeSiteId &&
            context.resolve(referencedNodeId)?.id === referencedNodeId
              ? '#102030'
              : '#ff0000',
        },
        {
          kind: 'path',
          d: 'M0,0H4V4H0ZM1,1H3V3H1Z',
          fill: '#3f6b2f',
          fillRule: 'evenodd',
        },
        {
          kind: 'image',
          url: inlinePng,
          center: [10, 3],
          width: 1,
          height: 1,
        },
        { kind: 'circle', cx: 12, cy: 5, r: 0.5 },
      ],
    }))

    try {
      nodeRegistry._reset()
      registerNode({
        kind: architectureKind,
        schemaVersion: 1,
        schema: z.object({ type: z.literal(architectureKind) }) as never,
        category: 'structure',
        defaults: () => ({}) as never,
        capabilities: {},
        floorplan: () => ({
          kind: 'polygon',
          points: [
            [0, 0],
            [4, 0],
            [4, 4],
          ],
        }),
      } as AnyNodeDefinition)
      await loadPlugin({
        id: enabledPluginId,
        apiVersion: 1,
        nodes: [enabledDefinition],
      })
      await loadPlugin({
        id: disabledPluginId,
        apiVersion: 1,
        nodes: [siteDefinition(disabledKind, () => ({ kind: 'circle', cx: 0, cy: 0, r: 1 }))],
      })

      const activeSite = {
        id: activeSiteId,
        type: 'site',
        parentId: null,
        visible: true,
        children: [
          'building_active',
          'site_overlay',
          'site_overlay_hidden',
          'site_overlay_disabled',
        ],
      } as unknown as AnyNode
      const activeBuilding = {
        id: 'building_active',
        type: 'building',
        parentId: activeSiteId,
        children: ['level_active', 'level_upper'],
        position: [10, 0, 5],
        rotation: [0, Math.PI / 2, 0],
      } as unknown as AnyNode
      const activeLevel = {
        id: 'level_active',
        type: 'level',
        parentId: activeBuilding.id,
        children: ['level_architecture'],
      } as unknown as AnyNode
      const upperLevel = {
        id: 'level_upper',
        type: 'level',
        parentId: activeBuilding.id,
        children: ['level_upper_architecture'],
      } as unknown as AnyNode
      const nodes = {
        [activeSite.id]: activeSite,
        [activeBuilding.id]: activeBuilding,
        [activeLevel.id]: activeLevel,
        [upperLevel.id]: upperLevel,
        level_upper_architecture: {
          id: 'level_upper_architecture',
          type: architectureKind,
          parentId: upperLevel.id,
          visible: true,
        } as unknown as AnyNode,
        level_architecture: {
          id: 'level_architecture',
          type: architectureKind,
          parentId: activeLevel.id,
          visible: true,
        } as unknown as AnyNode,
        site_overlay: {
          id: 'site_overlay',
          type: enabledKind,
          parentId: null,
          children: [semanticChildId],
          visible: true,
        } as unknown as AnyNode,
        [semanticChildId]: {
          id: semanticChildId,
          type: 'test:site-detail',
          parentId: 'site_overlay',
        } as unknown as AnyNode,
        [referencedNodeId]: {
          id: referencedNodeId,
          type: 'test:site-reference',
          parentId: activeSiteId,
        } as unknown as AnyNode,
        site_overlay_hidden: {
          id: 'site_overlay_hidden',
          type: enabledKind,
          parentId: activeSiteId,
          visible: false,
        } as unknown as AnyNode,
        site_overlay_disabled: {
          id: 'site_overlay_disabled',
          type: disabledKind,
          parentId: activeSiteId,
          visible: true,
        } as unknown as AnyNode,
        [otherSiteId]: {
          id: otherSiteId,
          type: 'site',
          parentId: null,
          children: ['site_overlay_other'],
        } as unknown as AnyNode,
        site_overlay_other: {
          id: 'site_overlay_other',
          type: enabledKind,
          parentId: otherSiteId,
          visible: true,
        } as unknown as AnyNode,
      }

      const full = collectFloorplanGeometry(
        nodes,
        activeLevel.id,
        'full',
        'metric',
        'meters',
        DEFAULT_FLOORPLAN_ANNOTATION_VISIBILITY,
        'floor-plan',
        'finished-faces',
        [enabledPluginId],
      )

      expect(full.map(({ id }) => id)).toEqual(['site_overlay', 'level_architecture'])
      const siteModel = full[0]?.model
      if (!siteModel) throw new Error('Expected Site geometry')
      const siteParts = flattenGeometry(siteModel)
      expect(siteParts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: 'rect',
            width: 3,
            height: 4,
            fill: '#102030',
          }),
          expect.objectContaining({ kind: 'path', fillRule: 'evenodd' }),
          expect.objectContaining({ kind: 'image', url: inlinePng }),
        ]),
      )
      expect(projectedGeometryPoint(siteModel, 'image')).toEqual([
        expect.closeTo(2),
        expect.closeTo(0),
      ])
      expect(projectedGeometryPoint(siteModel, 'circle')).toEqual([
        expect.closeTo(0),
        expect.closeTo(2),
      ])

      const rawPdf = new PDFDocument({ autoFirstPage: false, compress: false })
      const chunks: Buffer[] = []
      rawPdf.on('data', (chunk: Buffer) => chunks.push(chunk))
      const completedPdf = Promise.withResolvers<string>()
      rawPdf.on('end', () => completedPdf.resolve(Buffer.concat(chunks).toString('latin1')))
      const pdf = new FloorplanPdfDocument(rawPdf, [200, 200])
      pdf.addPage()
      for (const { model } of full) {
        if (!model) continue
        await renderFloorplanGeometryToPdfKit(pdf, model, {
          annotationLayer: false,
          placement: { x: 20, y: 20, width: 100, height: 100 },
          rotationDeg: 0,
          viewport: { x: -4, y: -4, width: 20, height: 20 },
        })
      }
      rawPdf.end()
      const renderedPdf = await completedPdf.promise
      expect(renderedPdf).toMatch(/f\*/)
      expect(renderedPdf).toContain('/Subtype /Image')

      const upper = collectFloorplanGeometry(
        nodes,
        upperLevel.id,
        'full',
        'metric',
        'meters',
        DEFAULT_FLOORPLAN_ANNOTATION_VISIBILITY,
        'floor-plan',
        'finished-faces',
        [enabledPluginId],
      )
      expect(upper.map(({ id }) => id)).toEqual(['site_overlay', 'level_upper_architecture'])

      const hiddenSiteNodes = {
        ...nodes,
        [activeSite.id]: { ...activeSite, visible: false } as AnyNode,
      }
      const hiddenSite = collectFloorplanGeometry(
        hiddenSiteNodes,
        activeLevel.id,
        'full',
        'metric',
        'meters',
        DEFAULT_FLOORPLAN_ANNOTATION_VISIBILITY,
        'floor-plan',
        'finished-faces',
        [enabledPluginId],
      )
      expect(hiddenSite.map(({ id }) => id)).toEqual(['level_architecture'])

      const structure = collectFloorplanGeometry(
        nodes,
        activeLevel.id,
        'structure',
        'metric',
        'meters',
        DEFAULT_FLOORPLAN_ANNOTATION_VISIBILITY,
        'floor-plan',
        'finished-faces',
        [enabledPluginId],
      )
      expect(structure.map(({ id }) => id)).toEqual(['level_architecture'])
    } finally {
      restoreRegistry()
    }
  })
})
