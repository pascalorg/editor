import { describe, expect, test } from 'bun:test'
import type { SceneGraph } from '@pascal-app/core/clone-scene-graph'
import { buildTools } from './chat-ai'

/**
 * The AI asked how to get the boards out of the sheets.
 *
 * `inspect_project_formwork` already answers what to buy, and the model cannot derive this
 * from it: a sheet count says a deck takes nine sheets and says nothing about which board
 * comes off which one, or in what order a saw can reach them. So what is asserted here is
 * what only this surface can get wrong — that the boards reported are the boards the takeoff
 * priced, that the cuts arrive as sentences the model quotes rather than extents it would
 * rephrase into a full-width cut through a board already freed, and that the two absences
 * reach a model that asked about cutting rather than about cost.
 */

type ToolMap = ReturnType<typeof buildTools>

const call = (tools: ToolMap, name: keyof ToolMap, input: unknown): Promise<string> =>
  (tools[name].execute as (i: unknown) => Promise<string>)(input)

interface CutSheetReply {
  scope: string
  sheets: Array<{
    sheetId: string
    number: number
    widthMm: number
    heightMm: number
    boards: Array<{
      mark: string
      xMm: number
      yMm: number
      widthMm: number
      heightMm: number
      turned: boolean
    }>
    offcuts: Array<{ widthMm: number; heightMm: number; worthRacking: boolean }>
    cuts: string[]
    guillotineable: boolean
    unsequencedMarks: string[]
    usedPercent: number
  }>
  boardsLargerThanEverySheet: Array<{ mark: string; widthMm: number; heightMm: number }>
  caveats: string[]
  noCutSheetBecause?: string
}

const PLAIN_SHEET = 'ply-1220x2440x18-plain'

/**
 * A plywood deck and a steel-panel wall on one level.
 *
 * The deck is what makes this testable at all: it bills cut ply by the hundred, where a wall
 * in whole panels cuts no board, so every assertion about placements needs one. The wall is
 * kept beside it for the second absence — a scope with no cut ply has to say something
 * different from a scope waiting on a sheet size.
 */
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
        children: ['slab_1', 'wall_1'],
        elevation: 0,
        height: 6,
        level: 0,
      },
      slab_1: {
        object: 'node',
        id: 'slab_1',
        type: 'slab',
        parentId: 'level_1',
        visible: true,
        metadata: {},
        children: [],
        polygon: [
          [0, 0],
          [6, 0],
          [6, 5],
          [0, 5],
        ],
        holes: [],
        elevation: 6,
        thickness: 0.25,
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
        height: 6,
        frontSide: 'unknown',
        backSide: 'unknown',
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

const cutSheet = async (tools: ToolMap, input: unknown = {}): Promise<CutSheetReply> =>
  JSON.parse(await call(tools, 'formwork_cut_sheet', input)) as CutSheetReply

describe('formwork_cut_sheet', () => {
  test('places every board the takeoff priced, on the sheet the project states', async () => {
    // The join, and the assertion that could not be made anywhere below this layer: a
    // drawing carrying fewer boards than the bill prices is a carpenter short of a board.
    const { tools } = scene()
    await shutter(tools, 'slab_1', 'plywood')
    await call(tools, 'set_formwork_settings', { sheets: { stockIds: [PLAIN_SHEET] } })

    const takeoff = JSON.parse(
      await call(tools, 'inspect_project_formwork', { elementIds: ['slab_1'] }),
    ) as { cutList?: { boardsNested: number } }
    const reply = await cutSheet(tools, { elementIds: ['slab_1'] })

    const marks = reply.sheets.flatMap((sheet) => sheet.boards.map((board) => board.mark))
    expect(marks.length + reply.boardsLargerThanEverySheet.length).toBe(
      takeoff.cutList?.boardsNested,
    )
    expect(new Set(marks).size).toBe(marks.length)
    expect(reply.sheets.every((sheet) => sheet.sheetId === PLAIN_SHEET)).toBe(true)
    expect(reply.sheets.every((sheet) => sheet.widthMm === 1220 && sheet.heightMm === 2440)).toBe(
      true,
    )
    // Every board inside the sheet it is drawn on, because a placement off the edge is a
    // measurement a carpenter would set a fence to.
    for (const sheet of reply.sheets) {
      for (const board of sheet.boards) {
        expect(board.xMm + board.widthMm).toBeLessThanOrEqual(sheet.widthMm)
        expect(board.yMm + board.heightMm).toBeLessThanOrEqual(sheet.heightMm)
      }
    }
  })

  test('gives the cuts as numbered instructions rather than as coordinates', async () => {
    // Why this tool returns sentences: handed atMm/fromMm/toMm the model composes "cut at
    // 600 mm across the sheet", and a later full-width cut goes back through a board freed
    // two cuts earlier. The extent is in the sentence, and the sentence is not the model's.
    const { tools } = scene()
    await shutter(tools, 'slab_1', 'plywood')
    await call(tools, 'set_formwork_settings', { sheets: { stockIds: [PLAIN_SHEET] } })

    const reply = await cutSheet(tools, { elementIds: ['slab_1'] })

    const cut = reply.sheets.find((sheet) => sheet.cuts.length > 0)
    expect(cut).toBeDefined()
    expect(cut?.cuts[0]).toMatch(/^1\. (Rip|Crosscut) at \d+(\.\d+)? mm, (down|across) /)
    expect(cut?.cuts.map((line) => line.split('.')[0])).toEqual(
      cut?.cuts.map((_line, index) => String(index + 1)),
    )
    for (const sheet of reply.sheets) {
      expect(sheet.guillotineable).toBe(true)
      expect(sheet.unsequencedMarks).toEqual([])
    }
    expect(reply.caveats.some((line) => line.includes('still joined'))).toBe(true)
  })

  test('marks each offcut keep or scrap and says how full each sheet is', async () => {
    const { tools } = scene()
    await shutter(tools, 'slab_1', 'plywood')
    await call(tools, 'set_formwork_settings', {
      sheets: { minKeepWidthMm: 300, stockIds: [PLAIN_SHEET] },
    })

    const reply = await cutSheet(tools, { elementIds: ['slab_1'] })

    const racked = reply.sheets.flatMap((sheet) => sheet.offcuts)
    expect(racked.length).toBeGreaterThan(0)
    expect(racked.every((offcut) => typeof offcut.worthRacking === 'boolean')).toBe(true)
    for (const sheet of reply.sheets) {
      expect(sheet.usedPercent).toBeGreaterThan(0)
      expect(sheet.usedPercent).toBeLessThanOrEqual(100)
    }
  })

  test('a job that cuts ply with no sheet stated names the remedy, and never to guess', async () => {
    const { tools } = scene()
    await shutter(tools, 'slab_1', 'plywood')

    const reply = await cutSheet(tools, { elementIds: ['slab_1'] })

    expect(reply.sheets).toEqual([])
    expect(reply.noCutSheetBecause).toContain('set_formwork_settings sheets')
    expect(reply.noCutSheetBecause).toContain('never take the size from a sheathing grade')
  })

  test('a job with no cut ply has nothing to cut, which is a different answer', async () => {
    // Two absences and two sentences: a steel wall is not waiting on an input, and one
    // hedged sentence would send the model to ask the user for a sheet size it does not need.
    const { tools } = scene()
    await shutter(tools, 'wall_1', 'steel-panel')
    await call(tools, 'set_formwork_settings', { sheets: { stockIds: [PLAIN_SHEET] } })

    const reply = await cutSheet(tools, { elementIds: ['wall_1'] })

    expect(reply.sheets).toEqual([])
    expect(reply.noCutSheetBecause).toContain('Not a missing input')
    expect(reply.noCutSheetBecause).not.toContain('set_formwork_settings sheets')
  })

  test('refuses a level that does not exist rather than drawing nothing for it', async () => {
    // "There is nothing to cut on level_9" is a sentence a model will produce about a level
    // that was never in the scene.
    const { tools } = scene()

    const reply = await call(tools, 'formwork_cut_sheet', { levelId: 'level_9' })

    expect(reply).toContain('no level with id level_9')
    expect(reply).toContain('list_castable_elements')
  })
})
