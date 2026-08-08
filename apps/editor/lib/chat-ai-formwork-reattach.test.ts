import { describe, expect, test } from 'bun:test'
import type { SceneGraph } from '@pascal-app/core/clone-scene-graph'
import { buildTools } from './chat-ai'

/**
 * Calling the formwork tools twice.
 *
 * The AI reaches every state in here by following its own instructions — set the
 * pour limits, then ask what to order — and until this was tested it got two
 * things wrong, both invisibly. `attach_formwork` appended, so a second call left
 * two copies of every shutter and doubled the bill; a pour limit set after
 * attaching left the element cast in three pours and formed for one, and every
 * figure the model then quoted was a third of the truth with nothing marking it.
 *
 * Neither failure raises an error, and both produce output that looks entirely
 * reasonable, which is why the assertions here are on quantities and on the words
 * of the reply rather than on a status. Mirrors the reconciliation tests in
 * `packages/nodes/src/formwork-assembly/attach.test.ts`, which cover the same
 * decisions at the pure level; these cover the graph the tools actually mutate.
 */

type ToolMap = ReturnType<typeof buildTools>

/** A 9 m wall — tall enough that a lift cap splits it. */
function scene(): { graph: SceneGraph; tools: ToolMap; mutations: () => number } {
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
        children: ['wall_1'],
        elevation: 0,
        height: 9,
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
        height: 9,
        frontSide: 'unknown',
        backSide: 'unknown',
      },
    },
    rootNodeIds: ['site_1'],
  } as unknown as SceneGraph
  let mutations = 0
  const tools = buildTools(graph, [], () => {
    mutations++
  })
  return { graph, tools, mutations: () => mutations }
}

const call = (tools: ToolMap, name: keyof ToolMap, input: unknown): Promise<string> =>
  (tools[name].execute as (i: unknown) => Promise<string>)(input)

async function shuttered() {
  const made = scene()
  await call(made.tools, 'set_element_construction', {
    elementId: 'wall_1',
    formworkType: 'steel-panel',
  })
  await call(made.tools, 'attach_formwork', { elementId: 'wall_1' })
  return made
}

interface Assembly {
  id: string
  type: string
  parentId: string
  segmentIndex: number
  liftIndex: number
  partOverrides?: Record<string, unknown>
}

const assemblies = (graph: SceneGraph): Assembly[] =>
  (Object.values(graph.nodes) as unknown as Assembly[]).filter(
    (node) => node.type === 'formwork-assembly',
  )

interface PartsReport {
  shutters: Array<{ assemblyId: string; partCount: number; parts: Array<{ mark: string }> }>
  totalWeightKg: number
  duplicateMarks: Array<{ assemblyId: string; mark: string }>
  coversWholeElement: boolean
  coverageCaveat: string | null
}

const report = async (tools: ToolMap): Promise<PartsReport> =>
  JSON.parse(await call(tools, 'inspect_formwork_parts', { elementId: 'wall_1' })) as PartsReport

describe('attach_formwork called twice', () => {
  test('does not add a second copy of a shutter that already exists', async () => {
    const { tools, graph } = await shuttered()

    await call(tools, 'attach_formwork', { elementId: 'wall_1' })

    expect(assemblies(graph)).toHaveLength(1)
  })

  test('does not double the bill or collide the marks', async () => {
    // What the append actually cost: 50 parts became 100, every mark appeared
    // twice, and the weight doubled — a purchase order for two shutters where the
    // wall needs one.
    const { tools } = await shuttered()
    const before = await report(tools)

    await call(tools, 'attach_formwork', { elementId: 'wall_1' })
    const after = await report(tools)

    expect(after.shutters).toHaveLength(1)
    expect(after.shutters[0]?.partCount).toBe(before.shutters[0]?.partCount ?? 0)
    expect(after.totalWeightKg).toBeCloseTo(before.totalWeightKg, 6)
    expect(after.duplicateMarks).toEqual([])
  })

  test('keeps the same assembly, so selections and per-part decisions survive', async () => {
    const { tools, graph } = await shuttered()
    const id = assemblies(graph)[0]?.id as string
    const mark = (await report(tools)).shutters[0]?.parts[0]?.mark as string
    await call(tools, 'set_formwork_part', { elementId: 'wall_1', mark, omitted: true })

    await call(tools, 'attach_formwork', { elementId: 'wall_1' })

    expect(assemblies(graph)[0]?.id).toBe(id)
    // The decision the yard recorded. A rebuild here re-orders a part somebody
    // said was already on site.
    expect(assemblies(graph)[0]?.partOverrides).toEqual({ [mark]: { omitted: true } })
  })

  test("says it changed nothing, so the model does not report work it didn't do", async () => {
    const { tools } = await shuttered()

    const reply = await call(tools, 'attach_formwork', { elementId: 'wall_1' })

    expect(reply).toContain('unchanged')
    expect(reply).toContain('intact')
  })

  test('leaves the wall with one child entry per assembly', async () => {
    // The child list is what a reload rebuilds the tree from, so a stale id here
    // is a shutter that appears in the outliner and nowhere else.
    const { tools, graph } = await shuttered()

    await call(tools, 'attach_formwork', { elementId: 'wall_1' })

    const wall = graph.nodes.wall_1 as unknown as { children: string[] }
    const ids = assemblies(graph).map((node) => node.id)
    expect(wall.children.filter((id) => id.startsWith('formwork-assembly'))).toEqual(ids)
  })
})

describe('a pour limit set after the shutter', () => {
  test('is reported as leaving the element short, not just as a split', async () => {
    // The whole bug in one assertion. Without this the reply is "ok — cast in 3
    // pours" and the model happily quotes a one-third takeoff.
    const { tools } = await shuttered()

    const reply = await call(tools, 'set_pour_limits', { elementId: 'wall_1', maxLiftHeight: 3 })

    expect(reply).toContain('cast in 3 pours')
    expect(reply).toContain('1 of the 3 pours are shuttered')
    expect(reply).toContain('attach_formwork')
  })

  test('says nothing about coverage on an element with no shutter yet', async () => {
    const made = scene()

    const reply = await call(made.tools, 'set_pour_limits', {
      elementId: 'wall_1',
      maxLiftHeight: 3,
    })

    expect(reply).not.toContain('attach_formwork')
  })

  test('re-attaching builds the missing shutters and keeps the one that survived', async () => {
    const { tools, graph } = await shuttered()
    const id = assemblies(graph)[0]?.id as string

    await call(tools, 'set_pour_limits', { elementId: 'wall_1', maxLiftHeight: 3 })
    const reply = await call(tools, 'attach_formwork', { elementId: 'wall_1' })

    expect(assemblies(graph)).toHaveLength(3)
    expect(assemblies(graph).map((node) => node.id)).toContain(id)
    expect(reply).toContain('2 added')
    expect(reply).toContain('1 kept')
  })

  test('re-attaching raises the takeoff to the whole element', async () => {
    const { tools } = await shuttered()
    const oneLift = await report(tools)

    await call(tools, 'set_pour_limits', { elementId: 'wall_1', maxLiftHeight: 3 })
    await call(tools, 'attach_formwork', { elementId: 'wall_1' })
    const threeLifts = await report(tools)

    expect(threeLifts.shutters).toHaveLength(3)
    // Three lifts of a 9 m wall form more than one 9 m pour's worth of shutter —
    // each lift is struck and re-erected, and each gets its own stop-ends.
    expect(threeLifts.totalWeightKg).toBeGreaterThan(oneLift.totalWeightKg)
    // A mark is a position within its own pour unit, so the three lifts share
    // marks by design and none of that is a clash.
    expect(threeLifts.duplicateMarks).toEqual([])
  })

  test('lifting the cap again removes the orphaned shutters and names the cost', async () => {
    const { tools, graph } = await shuttered()
    await call(tools, 'set_pour_limits', { elementId: 'wall_1', maxLiftHeight: 3 })
    await call(tools, 'attach_formwork', { elementId: 'wall_1' })
    // A decision recorded on a lift that is about to stop existing.
    const upper = assemblies(graph).find((node) => node.liftIndex === 2)?.id as string
    ;(graph.nodes[upper as keyof typeof graph.nodes] as unknown as Assembly).partOverrides = {
      'P-A-1-00000': { omitted: true },
    }

    await call(tools, 'set_pour_limits', { elementId: 'wall_1', maxLiftHeight: null })
    const reply = await call(tools, 'attach_formwork', { elementId: 'wall_1' })

    expect(assemblies(graph)).toHaveLength(1)
    expect(reply).toContain('2 removed')
    // Counted and handed to the model, because deleting recorded work silently is
    // the one thing a repair routine must not do.
    expect(reply).toContain('discarding 1 part decision')
    expect(reply).toContain('say so')
  })
})

describe('inspect_formwork_parts coverage', () => {
  test('a shutter matching the pour reports whole coverage and no caveat', async () => {
    const { tools } = await shuttered()

    const parts = await report(tools)

    expect(parts.coversWholeElement).toBe(true)
    expect(parts.coverageCaveat).toBeNull()
  })

  test('a bill for part of the element leads with the caveat rather than the figures', async () => {
    // Every number in this report is correct and the report is still wrong: it is
    // for a third of the wall. Nothing else in the JSON hints at that.
    const { tools } = await shuttered()

    await call(tools, 'set_pour_limits', { elementId: 'wall_1', maxLiftHeight: 3 })
    const parts = await report(tools)

    expect(parts.coversWholeElement).toBe(false)
    expect(parts.coverageCaveat).toContain('1 of the 3 pours are shuttered')
    expect(parts.coverageCaveat).toContain('attach_formwork')
  })

  test('the caveat clears once the element is shuttered to match', async () => {
    const { tools } = await shuttered()

    await call(tools, 'set_pour_limits', { elementId: 'wall_1', maxLiftHeight: 3 })
    await call(tools, 'attach_formwork', { elementId: 'wall_1' })
    const parts = await report(tools)

    expect(parts.coversWholeElement).toBe(true)
    expect(parts.coverageCaveat).toBeNull()
  })

  test('two lifts sharing a mark is not reported as a clash', async () => {
    // A mark encodes station and elevation *within its own pour unit*, so the same
    // panel in two lifts of one wall carries the same mark. Checked across the
    // element rather than per shutter, a correctly shuttered three-lift wall
    // reported its panels as clashing with themselves — and a clash list that is
    // full whenever an element is split is a clash list nobody reads.
    const { tools } = await shuttered()
    await call(tools, 'set_pour_limits', { elementId: 'wall_1', maxLiftHeight: 3 })
    await call(tools, 'attach_formwork', { elementId: 'wall_1' })

    const parts = await report(tools)
    const perLift = parts.shutters.map((shutter) => new Set(shutter.parts.map((part) => part.mark)))

    expect(perLift).toHaveLength(3)
    const shared = [...(perLift[0] as Set<string>)].filter((mark) =>
      (perLift[1] as Set<string>).has(mark),
    )
    expect(shared.length).toBeGreaterThan(0)
    expect(parts.duplicateMarks).toEqual([])
  })

  test('an over-shuttered element is flagged too, in the other direction', async () => {
    const { tools } = await shuttered()
    await call(tools, 'set_pour_limits', { elementId: 'wall_1', maxLiftHeight: 3 })
    await call(tools, 'attach_formwork', { elementId: 'wall_1' })

    await call(tools, 'set_pour_limits', { elementId: 'wall_1', maxLiftHeight: null })
    const parts = await report(tools)

    expect(parts.coversWholeElement).toBe(false)
    expect(parts.coverageCaveat).toContain('3 shutters for 1 pour')
  })
})
