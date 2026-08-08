import { describe, expect, test } from 'bun:test'
import type { SceneGraph } from '@pascal-app/core/clone-scene-graph'
import { buildTools } from './chat-ai'

/**
 * The AI asked what a floor needs.
 *
 * Before `inspect_project_formwork` this was a question the model could only answer
 * by calling the per-element tool once per wall and adding the results up, which is
 * the one arithmetic it must not do: the same panel type on two walls is one line on
 * a delivery note, and summing two bills of it produces a plausible order that no
 * yard can pick. Everything here is therefore about the aggregation being one solve
 * over the scope rather than a sum of solves, and about the two facts a project total
 * hides — an element in scope with no shutter at all, and one formed for fewer pours
 * than it is cast in.
 */

type ToolMap = ReturnType<typeof buildTools>

const call = (tools: ToolMap, name: keyof ToolMap, input: unknown): Promise<string> =>
  (tools[name].execute as (i: unknown) => Promise<string>)(input)

interface ProjectReport {
  scope: string
  elementCount: number
  shutterCount: number
  elements: Array<{
    id: string
    kind: string
    shutters: number
    pourUnits: number
    coversWholePour: boolean
  }>
  unshuttered: string[]
  bom: Array<{ description: string; quantity: number; totalWeightKg: number | null }>
  totalWeightKg: number
  totalWeightComplete: boolean
  beyondCapacity: Array<{ elementId: string; mark: string }>
  caveats: string[]
}

interface PartsReport {
  bom: Array<{ description: string; quantity: number }>
  totalWeightKg: number
}

/**
 * Two levels, two walls on the ground and one above, so a level scope can be wrong
 * in both directions — missing what it should carry and carrying what it should not.
 */
function scene(): { graph: SceneGraph; tools: ToolMap } {
  const wall = (id: string, parentId: string, y: number) => ({
    object: 'node',
    id,
    type: 'wall',
    parentId,
    visible: true,
    metadata: {},
    children: [],
    start: [0, y],
    end: [6, y],
    thickness: 0.25,
    height: 6,
    frontSide: 'unknown',
    backSide: 'unknown',
  })
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
        children: ['level_1', 'level_2'],
      },
      level_1: {
        object: 'node',
        id: 'level_1',
        type: 'level',
        parentId: 'building_1',
        visible: true,
        metadata: {},
        children: ['wall_1', 'wall_2'],
        elevation: 0,
        height: 6,
        level: 0,
      },
      level_2: {
        object: 'node',
        id: 'level_2',
        type: 'level',
        parentId: 'building_1',
        visible: true,
        metadata: {},
        children: ['wall_3'],
        elevation: 6,
        height: 6,
        level: 1,
      },
      wall_1: wall('wall_1', 'level_1', 0),
      wall_2: wall('wall_2', 'level_1', 4),
      wall_3: wall('wall_3', 'level_2', 0),
    },
    rootNodeIds: ['site_1'],
  } as unknown as SceneGraph
  const tools = buildTools(graph, [], () => {})
  return { graph, tools }
}

async function shutter(tools: ToolMap, elementId: string) {
  await call(tools, 'set_element_construction', { elementId, formworkType: 'steel-panel' })
  await call(tools, 'attach_formwork', { elementId })
}

const project = async (tools: ToolMap, input: unknown = {}): Promise<ProjectReport> =>
  JSON.parse(await call(tools, 'inspect_project_formwork', input)) as ProjectReport

const element = async (tools: ToolMap, elementId: string): Promise<PartsReport> =>
  JSON.parse(await call(tools, 'inspect_formwork_parts', { elementId })) as PartsReport

describe('inspect_project_formwork', () => {
  test('bills two walls as one order rather than two takeoffs', async () => {
    // The whole reason the tool exists. Two identical walls need twice the panels on
    // one line, not the same line twice, and the model cannot be asked to work out
    // which of the two it is looking at.
    const { tools } = scene()
    await shutter(tools, 'wall_1')
    await shutter(tools, 'wall_2')
    const one = await element(tools, 'wall_1')

    const both = await project(tools, { levelId: 'level_1' })

    const line = both.bom.find((row) => row.description === one.bom[0]?.description)
    expect(line?.quantity).toBe((one.bom[0]?.quantity ?? 0) * 2)
    expect(both.bom.filter((row) => row.description === one.bom[0]?.description)).toHaveLength(1)
    expect(both.totalWeightKg).toBeGreaterThan(one.totalWeightKg)
  })

  test('scopes to a level, and does not carry the floor above', async () => {
    const { tools } = scene()
    await shutter(tools, 'wall_1')
    await shutter(tools, 'wall_3')

    const ground = await project(tools, { levelId: 'level_1' })

    expect(ground.elements.map((e) => e.id)).toEqual(['wall_1'])
    expect(ground.shutterCount).toBe(1)
  })

  test('the whole scene is more than either level', async () => {
    const { tools } = scene()
    await shutter(tools, 'wall_1')
    await shutter(tools, 'wall_3')

    const whole = await project(tools)
    const ground = await project(tools, { levelId: 'level_1' })

    expect(whole.elements.map((e) => e.id)).toEqual(['wall_1', 'wall_3'])
    expect(whole.totalWeightKg).toBeGreaterThan(ground.totalWeightKg)
  })

  test('bills only the elements named when given a selection', async () => {
    const { tools } = scene()
    await shutter(tools, 'wall_1')
    await shutter(tools, 'wall_2')

    const named = await project(tools, { elementIds: ['wall_2'] })

    expect(named.elements.map((e) => e.id)).toEqual(['wall_2'])
  })

  test('names the elements in scope with no shutter at all', async () => {
    // The likeliest reason a total is lower than a user expects, and invisible in a
    // bill that lists only what exists. An empty row would read as "needs nothing".
    const { tools } = scene()
    await shutter(tools, 'wall_1')

    const ground = await project(tools, { levelId: 'level_1' })

    expect(ground.unshuttered).toEqual(['wall_2'])
    expect(ground.elements.map((e) => e.id)).toEqual(['wall_1'])
  })

  test('says nothing is unshuttered once everything is formed', async () => {
    const { tools } = scene()
    await shutter(tools, 'wall_1')
    await shutter(tools, 'wall_2')

    expect((await project(tools, { levelId: 'level_1' })).unshuttered).toEqual([])
  })

  test('a bill with nothing in it is not an empty success', async () => {
    const { tools } = scene()

    const empty = await project(tools)

    expect(empty.elementCount).toBe(0)
    expect(empty.bom).toEqual([])
    expect(empty.unshuttered).toEqual(['wall_1', 'wall_2', 'wall_3'])
  })

  test('a level that does not exist is refused, not silently billed as nothing', async () => {
    // Scoped to a typo, the honest answer looks exactly like a floor with no
    // formwork on it, and the model would report a level as unformed.
    const { tools } = scene()
    await shutter(tools, 'wall_1')

    const reply = await call(tools, 'inspect_project_formwork', { levelId: 'level_9' })

    expect(reply).toStartWith('Error:')
    expect(reply).toContain('list_castable_elements')
  })

  test('an element cast in more pours than it is formed for drags the total short, and says so', async () => {
    // The failure a project scope makes worse rather than better: one under-formed
    // element among five, and every figure in the bill is individually correct.
    const { tools } = scene()
    await shutter(tools, 'wall_1')
    await shutter(tools, 'wall_2')
    await call(tools, 'set_pour_limits', { elementId: 'wall_2', maxLiftHeight: 2 })

    const ground = await project(tools, { levelId: 'level_1' })

    const short = ground.elements.find((e) => e.id === 'wall_2')
    expect(short?.pourUnits).toBe(3)
    expect(short?.shutters).toBe(1)
    expect(short?.coversWholePour).toBe(false)
    expect(ground.caveats.join(' ')).toContain('wall_2 is cast in 3 pours and formed for 1')
  })

  test('the caveat clears once the missing shutters are built', async () => {
    const { tools } = scene()
    await shutter(tools, 'wall_1')
    await call(tools, 'set_pour_limits', { elementId: 'wall_1', maxLiftHeight: 2 })
    const short = await project(tools, { levelId: 'level_1' })

    await call(tools, 'attach_formwork', { elementId: 'wall_1' })
    const whole = await project(tools, { levelId: 'level_1' })

    expect(short.caveats.some((c) => c.includes('formed for 1'))).toBe(true)
    expect(whole.caveats.some((c) => c.includes('formed for'))).toBe(false)
    expect(whole.elements[0]?.coversWholePour).toBe(true)
    expect(whole.totalWeightKg).toBeGreaterThan(short.totalWeightKg)
  })

  test('a per-part omission recorded on one wall reaches the project bill', async () => {
    // Proof the aggregation reads the shutters rather than re-solving beside them.
    // A second enumeration at project scope would quietly re-order everything the
    // yard had taken off the list.
    const { tools } = scene()
    await shutter(tools, 'wall_1')
    const before = await project(tools, { elementIds: ['wall_1'] })
    const parts = JSON.parse(
      await call(tools, 'inspect_formwork_parts', { elementId: 'wall_1', kind: 'panel' }),
    ) as { shutters: Array<{ parts: Array<{ mark: string }> }> }
    const mark = parts.shutters[0]?.parts[0]?.mark as string

    await call(tools, 'set_formwork_part', { elementId: 'wall_1', mark, omitted: true })
    const after = await project(tools, { elementIds: ['wall_1'] })

    expect(after.totalWeightKg).toBeLessThan(before.totalWeightKg)
  })

  test('reports whether the weight total is the lifting weight of the set', async () => {
    const { tools } = scene()
    await shutter(tools, 'wall_1')

    const solved = await project(tools)

    expect(typeof solved.totalWeightComplete).toBe('boolean')
    // A complete flag and a weight caveat side by side would be worse than either,
    // so the two have to agree whichever way this scene falls.
    expect(solved.caveats.some((c) => c.includes('no published weight'))).toBe(
      !solved.totalWeightComplete,
    )
  })

  test('the element rows and the scope counts agree with each other', async () => {
    const { tools } = scene()
    await shutter(tools, 'wall_1')
    await shutter(tools, 'wall_2')

    const ground = await project(tools, { levelId: 'level_1' })

    expect(ground.elementCount).toBe(ground.elements.length)
    expect(ground.shutterCount).toBe(ground.elements.reduce((total, e) => total + e.shutters, 0))
  })
})
