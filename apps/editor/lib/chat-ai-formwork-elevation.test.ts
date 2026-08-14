import { describe, expect, test } from 'bun:test'
import type { SceneGraph } from '@pascal-app/core/clone-scene-graph'
import { buildTools } from './chat-ai'

/**
 * The AI asked where a panel mark actually is on the wall.
 *
 * `inspect_formwork_parts` already answers what the parts are, and the model cannot derive
 * this from it: a list says P-A-1-01250 is a 1200 × 2400 panel and cannot say which panel is
 * beside it or whether the tie at 1250 falls on its joint. So what is asserted here is what
 * only this surface can get wrong — that the marks drawn are the marks priced, that each lift
 * is drawn in its own frame rather than measured up the wall, that a station the grid offers
 * and the wall cannot use arrives as an absence with a reason, and that a column is answered
 * with a sentence instead of an empty drawing a model would read as an unformed element.
 */

type ToolMap = ReturnType<typeof buildTools>

const call = (tools: ToolMap, name: keyof ToolMap, input: unknown): Promise<string> =>
  (tools[name].execute as (i: unknown) => Promise<string>)(input)

interface ElevationReply {
  elementId: string
  drawings: Array<{
    assemblyId: string
    pour: string
    runMm: number
    formBaseMm: number
    concreteTopMm: number
    formTopMm: number
    courses: Array<{ baseMm: number; topMm: number }>
    openings: Array<{ id: string; xMm: number; yMm: number; widthMm: number; heightMm: number }>
    ties: Array<{ xMm: number; yMm: number; mark: string }>
    tiesNotTied: Array<{ xMm: number; yMm: number; because: string }>
    tiesFrom: string
    faces: Array<{
      face: string
      pieces: Array<{
        mark: string
        kind: string
        xMm: number
        yMm: number
        widthMm: number
        heightMm: number
        course: number | null
      }>
    }>
    caveats: string[]
  }>
  noElevationBecause?: string
}

interface PartsReply {
  shutters: Array<{ assemblyId: string; parts: Array<{ mark: string }> }>
}

/** A wall tall enough to need more than one lift, and a column for the other answer. */
function scene(): { graph: SceneGraph; tools: ToolMap } {
  const graph = {
    nodes: {
      site_1: {
        object: 'node',
        id: 'site_1',
        type: 'site',
        parentId: null,
        visible: true,
        metadata: {},
        children: ['building_1'],
      },
      building_1: {
        object: 'node',
        id: 'building_1',
        type: 'building',
        parentId: 'site_1',
        visible: true,
        metadata: {},
        children: ['level_1'],
      },
      level_1: {
        object: 'node',
        id: 'level_1',
        type: 'level',
        parentId: 'building_1',
        visible: true,
        metadata: {},
        children: ['wall_1', 'column_1'],
        elevation: 0,
        height: 8,
        level: 0,
      },
      wall_1: {
        object: 'node',
        id: 'wall_1',
        type: 'wall',
        parentId: 'level_1',
        visible: true,
        metadata: {},
        children: [],
        start: [0, 0],
        end: [6, 0],
        thickness: 0.25,
        height: 7.5,
        frontSide: 'unknown',
        backSide: 'unknown',
      },
      column_1: {
        object: 'node',
        id: 'column_1',
        type: 'column',
        parentId: 'level_1',
        visible: true,
        metadata: {},
        children: [],
        position: [8, 0, 0],
        rotation: [0, 0, 0],
        width: 0.4,
        depth: 0.4,
        height: 3,
        shape: 'rectangular',
      },
    },
    rootNodeIds: ['site_1'],
  } as unknown as SceneGraph
  return { graph, tools: buildTools(graph, [], () => {}) }
}

async function shutter(tools: ToolMap, elementId: string, formworkType: string) {
  await call(tools, 'set_element_construction', { elementId, formworkType })
  await call(tools, 'attach_formwork', { elementId })
}

const elevation = async (tools: ToolMap, elementId: string): Promise<ElevationReply> =>
  JSON.parse(await call(tools, 'formwork_elevation', { elementId })) as ElevationReply

describe('formwork_elevation', () => {
  test('draws both skins, and every mark on the drawing is a part in the bill', async () => {
    // The join, and the assertion that cannot be made below this layer: a drawing labelled
    // with a mark the parts list has no line for is a mark nobody can order.
    const { tools } = scene()
    await shutter(tools, 'wall_1', 'steel-panel')

    const reply = await elevation(tools, 'wall_1')
    const parts = JSON.parse(
      await call(tools, 'inspect_formwork_parts', { elementId: 'wall_1' }),
    ) as PartsReply

    expect(reply.drawings.length).toBeGreaterThan(0)
    for (const drawing of reply.drawings) {
      expect(drawing.faces.map((face) => face.face)).toEqual(['side-a', 'side-b'])
      const shutterParts = parts.shutters.find((s) => s.assemblyId === drawing.assemblyId)
      const marks = new Set(shutterParts?.parts.map((part) => part.mark))
      for (const face of drawing.faces) {
        expect(face.pieces.length).toBeGreaterThan(0)
        for (const piece of face.pieces) expect(marks.has(piece.mark)).toBe(true)
      }
    }
  })

  test('every lift is drawn in its own frame, starting at its own base', async () => {
    // The one error on this drawing that reads as correct: a figure 2500 mm out because the
    // lift's base was read as the wall's. Three lifts, three drawings, each beginning at zero.
    const { tools } = scene()
    await call(tools, 'set_element_construction', {
      elementId: 'wall_1',
      formworkType: 'steel-panel',
    })
    await call(tools, 'set_pour_limits', { elementId: 'wall_1', maxLiftHeight: 3 })
    await call(tools, 'attach_formwork', { elementId: 'wall_1' })

    const reply = await elevation(tools, 'wall_1')

    expect(reply.drawings.length).toBeGreaterThan(1)
    expect(new Set(reply.drawings.map((drawing) => drawing.pour)).size).toBe(reply.drawings.length)
    for (const drawing of reply.drawings) {
      // Under 3 m even on the top lift — a figure measured up the wall would be 7500 here.
      expect(drawing.formTopMm).toBeLessThan(3200)
      expect(drawing.concreteTopMm).toBeLessThanOrEqual(drawing.formTopMm)
      // The kicker is why this is not zero on the bottom lift.
      expect(drawing.formBaseMm).toBeLessThan(200)
      expect(Math.min(...drawing.courses.map((course) => course.baseMm))).toBeLessThan(200)
      for (const face of drawing.faces) {
        for (const piece of face.pieces) {
          expect(piece.yMm).toBeLessThan(drawing.formTopMm)
        }
      }
    }
  })

  test('a station the grid offers and the wall cannot use arrives with its reason', async () => {
    // The one figure here whose value is the absence: an opening blocks stations inside its
    // span, and a tie count with them silently missing is what gets queried a fortnight later.
    const { tools } = scene()
    await shutter(tools, 'wall_1', 'steel-panel')

    const reply = await elevation(tools, 'wall_1')
    const drawing = reply.drawings[0]

    expect(drawing?.tiesFrom).toBe('drilled-holes')
    expect(drawing?.ties.length).toBeGreaterThan(0)
    for (const tie of drawing?.tiesNotTied ?? []) {
      expect(['opening', 'corner']).toContain(tie.because)
      // A dropped station is never also a drawn one — a rod both set and not set.
      expect(
        drawing?.ties.some((drawnTie) => drawnTie.xMm === tie.xMm && drawnTie.yMm === tie.yMm),
      ).toBe(false)
    }
    expect(drawing?.caveats.some((line) => line.includes('cannot be moved'))).toBe(true)
  })

  test('the caveats are core’s own, so the reply and the panel say the same thing', async () => {
    const { tools } = scene()
    await shutter(tools, 'wall_1', 'steel-panel')

    const reply = await elevation(tools, 'wall_1')
    const caveats = reply.drawings[0]?.caveats ?? []

    // The frame first, because every figure above it is wrong without it.
    expect(caveats[0]).toContain('millimetres')
    expect(caveats.some((line) => line.includes('shutter face only'))).toBe(true)
    expect(caveats.some((line) => line.includes('rectangles do not count'))).toBe(true)
  })

  test('a column is answered with the reason, not with an empty drawing', async () => {
    // An empty list reads as a wall nobody solved, and a model reading it that way calls
    // attach_formwork on a column that is already fully clamped.
    const { tools } = scene()
    await shutter(tools, 'column_1', 'steel-panel')

    const reply = await elevation(tools, 'column_1')

    expect(reply.drawings).toEqual([])
    expect(reply.noElevationBecause).toContain('clamped to a schedule')
    expect(reply.noElevationBecause).toContain('Not a missing input')
  })

  test('an unformed wall is refused, naming what to call first', async () => {
    const { tools } = scene()

    const reply = await call(tools, 'formwork_elevation', { elementId: 'wall_1' })

    expect(reply).toContain('attach_formwork')
  })

  test('refuses an id that is not a castable element', async () => {
    const { tools } = scene()

    const reply = await call(tools, 'formwork_elevation', { elementId: 'level_1' })

    expect(reply).toContain('No wall, column, slab or beam')
  })
})
