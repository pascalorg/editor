import { describe, expect, test } from 'bun:test'
import type { SceneGraph } from '@pascal-app/core/clone-scene-graph'
import { buildTools } from './chat-ai'

/**
 * The chat tools' half of the parts model.
 *
 * The failure that matters here is the AI and the user's screen disagreeing about what
 * a shutter is made of. The panel solves the parts by calling `solveShuttersForHost`
 * and so does `inspect_formwork_parts`, so the count and the marks are the same list —
 * but only while the tool keeps going through that solver rather than counting from the
 * spacings, and only while `set_formwork_part` writes the same `partOverrides` record
 * the panel writes. Both are asserted from the outside: the marks the read tool reports
 * are the marks the write tool accepts, and a mark the model invented is refused.
 *
 * Mirrors `chat-ai-formwork-settings.test.ts`, which tests the project-pour tools the
 * same way and for the same reason.
 */

type ToolMap = ReturnType<typeof buildTools>

/** A level with one 6 m wall on it — enough for the coverage engine to classify faces. */
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
        height: 3,
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
        height: 3,
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

/** A shuttered wall, which is what every parts question presupposes. */
async function shuttered(): Promise<{
  graph: SceneGraph
  tools: ToolMap
  mutations: () => number
}> {
  const made = scene()
  await call(made.tools, 'set_element_construction', {
    elementId: 'wall_1',
    formworkType: 'panel-system',
  })
  await call(made.tools, 'attach_formwork', { elementId: 'wall_1' })
  return made
}

interface PartsReport {
  kind: string
  shutters: Array<{
    assemblyId: string
    partCount: number
    parts: Array<{
      mark: string
      kind: string
      omittedFromOrder: boolean
      catalogId: string | null
    }>
  }>
  bom: Array<{ description: string; quantity: number; unit: string; marks: string[] }>
  totalWeightKg: number
  totalWeightComplete: boolean
  hardestWorked: { mark: string; utilisation: number } | null
  beyondCapacity: Array<{ mark: string }>
  duplicateMarks: string[]
  staleEdits: Array<{ mark: string }>
}

async function report(tools: ToolMap, input: unknown = { elementId: 'wall_1' }) {
  return JSON.parse(await call(tools, 'inspect_formwork_parts', input)) as PartsReport
}

describe('inspect_formwork_parts', () => {
  test('an unshuttered wall is told to attach formwork rather than given an empty bill', async () => {
    const { tools } = scene()

    const reply = await call(tools, 'inspect_formwork_parts', { elementId: 'wall_1' })

    expect(reply).toStartWith('Error:')
    expect(reply).toContain('attach_formwork')
  })

  test('an id that is not a castable element is refused', async () => {
    const { tools } = scene()

    const reply = await call(tools, 'inspect_formwork_parts', { elementId: 'level_1' })

    expect(reply).toStartWith('Error:')
  })

  test('reports the parts of the shutter, with marks', async () => {
    const { tools } = await shuttered()

    const parts = await report(tools)

    expect(parts.kind).toBe('wall')
    expect(parts.shutters).toHaveLength(1)
    expect(parts.shutters[0]?.partCount).toBeGreaterThan(0)
    // A wall is two tied faces, so panels and ties both have to be there — a report
    // with panels and no ties is a single-sided shutter, which is not a real one.
    const kinds = new Set(parts.shutters[0]?.parts.map((part) => part.kind))
    expect(kinds).toContain('panel')
    expect(kinds).toContain('tie')
    expect(kinds).toContain('waler')
  })

  test('every mark is unique, so a mark identifies one part', async () => {
    const { tools } = await shuttered()

    const parts = await report(tools)

    expect(parts.duplicateMarks).toEqual([])
  })

  test('the same wall reports the same marks twice — a mark is a position, not a counter', async () => {
    const { tools } = await shuttered()

    const first = await report(tools)
    const second = await report(tools)

    expect(second.shutters[0]?.parts.map((part) => part.mark)).toEqual(
      first.shutters[0]?.parts.map((part) => part.mark),
    )
  })

  test('the bill totals quantities across the shutter and traces each line to its marks', async () => {
    const { tools } = await shuttered()

    const parts = await report(tools)

    expect(parts.bom.length).toBeGreaterThan(0)
    for (const line of parts.bom) {
      expect(line.quantity).toBe(line.marks.length)
    }
  })

  test('the itemised list can be trimmed to one kind while the bill stays whole', async () => {
    const { tools } = await shuttered()

    const all = await report(tools)
    const ties = await report(tools, { elementId: 'wall_1', kind: 'tie' })

    expect(new Set(ties.shutters[0]?.parts.map((part) => part.kind))).toEqual(new Set(['tie']))
    // The count is of the whole shutter either way — the trim is presentational, and a
    // partCount that followed the filter would have the model quoting 12 parts for a wall.
    expect(ties.shutters[0]?.partCount).toBe(all.shutters[0]?.partCount ?? 0)
    expect(ties.bom).toEqual(all.bom)
  })

  test('reports the hardest-worked part rather than leaving it to be re-derived', async () => {
    const { tools } = await shuttered()

    const parts = await report(tools)

    expect(parts.hardestWorked).not.toBeNull()
    expect(parts.hardestWorked?.utilisation).toBeGreaterThan(0)
    const marks = new Set(parts.shutters[0]?.parts.map((part) => part.mark))
    expect(marks).toContain(parts.hardestWorked?.mark as string)
  })
})

describe('set_formwork_part', () => {
  test('an empty call changes nothing', async () => {
    const { tools, mutations } = await shuttered()
    const before = mutations()

    const reply = await call(tools, 'set_formwork_part', {
      elementId: 'wall_1',
      mark: 'P-A-1-00000',
    })

    expect(reply).toStartWith('Error:')
    expect(mutations()).toBe(before)
  })

  test('a mark this shutter does not have is refused, not written as a stale edit', async () => {
    const { tools, graph, mutations } = await shuttered()
    const before = mutations()

    const reply = await call(tools, 'set_formwork_part', {
      elementId: 'wall_1',
      mark: 'P-Z-9-99999',
      omitted: true,
    })

    expect(reply).toStartWith('Error:')
    expect(reply).toContain('inspect_formwork_parts')
    expect(mutations()).toBe(before)
    const assembly = (Object.values(graph.nodes) as Array<Record<string, unknown>>).find(
      (node) => node.type === 'formwork-assembly',
    )
    expect(assembly?.partOverrides ?? {}).toEqual({})
  })

  test('a catalog id that names nothing is refused', async () => {
    const { tools } = await shuttered()
    const parts = await report(tools)
    const mark = parts.shutters[0]?.parts[0]?.mark as string

    const reply = await call(tools, 'set_formwork_part', {
      elementId: 'wall_1',
      mark,
      catalogId: 'framax-9999-invented',
    })

    expect(reply).toStartWith('Error:')
  })

  test('omitting a part takes it off the bill and off the weight, and leaves it in the model', async () => {
    const { tools } = await shuttered()
    const before = await report(tools)
    const panel = before.shutters[0]?.parts.find((part) => part.kind === 'panel')
    const mark = panel?.mark as string

    const reply = await call(tools, 'set_formwork_part', {
      elementId: 'wall_1',
      mark,
      omitted: true,
    })
    const after = await report(tools)

    expect(reply).toStartWith('ok')
    // Still enumerated — an omission is somebody's decision, and a part that vanishes
    // from the list reads as a solver fault instead.
    expect(after.shutters[0]?.partCount).toBe(before.shutters[0]?.partCount ?? 0)
    expect(after.shutters[0]?.parts.find((part) => part.mark === mark)?.omittedFromOrder).toBe(true)
    const bomMarks = after.bom.flatMap((line) => line.marks)
    expect(bomMarks).not.toContain(mark)
    expect(after.totalWeightKg).toBeLessThan(before.totalWeightKg)
  })

  test('putting a part back on the order clears the override rather than storing a false', async () => {
    const { tools, graph } = await shuttered()
    const parts = await report(tools)
    const mark = parts.shutters[0]?.parts[0]?.mark as string

    await call(tools, 'set_formwork_part', { elementId: 'wall_1', mark, omitted: true })
    await call(tools, 'set_formwork_part', { elementId: 'wall_1', mark, omitted: false })

    // An override left as `{}` is reported as a stale edit for the rest of the
    // project's life, against a part nobody actually edited.
    const assembly = (Object.values(graph.nodes) as Array<Record<string, unknown>>).find(
      (node) => node.type === 'formwork-assembly',
    )
    expect(assembly?.partOverrides).toEqual({})
    expect((await report(tools)).staleEdits).toEqual([])
  })

  test('a substitution is recorded as a decision, not folded back into stock', async () => {
    const { tools } = await shuttered()
    const before = await report(tools)
    const panel = before.shutters[0]?.parts.find(
      (part) => part.kind === 'panel' && part.catalogId !== null,
    )
    const mark = panel?.mark as string
    // Another id this same layout already used, so the substitute is a real catalog
    // entry without this test having to hard-code one from the sheet.
    const substitute = before.shutters[0]?.parts.find(
      (part) => part.catalogId !== null && part.catalogId !== panel?.catalogId,
    )?.catalogId as string
    expect(substitute).toBeString()

    const reply = await call(tools, 'set_formwork_part', {
      elementId: 'wall_1',
      mark,
      catalogId: substitute,
      note: 'the 750s are on the podium job',
    })
    const after = await report(tools)
    const edited = after.shutters[0]?.parts.find((part) => part.mark === mark)

    expect(reply).toStartWith('ok')
    expect(edited?.catalogId).toBe(substitute)
    // The line it lands on is `modified`, so the yard can tell this pour's panel from
    // one off the rack.
    expect(after.bom.some((line) => line.marks.includes(mark))).toBe(true)
  })

  test('two edits to one part merge rather than overwrite', async () => {
    const { tools } = await shuttered()
    const parts = await report(tools)
    const panel = parts.shutters[0]?.parts.find(
      (part) => part.kind === 'panel' && part.catalogId !== null,
    )
    const mark = panel?.mark as string

    await call(tools, 'set_formwork_part', { elementId: 'wall_1', mark, note: 'checked on site' })
    await call(tools, 'set_formwork_part', { elementId: 'wall_1', mark, omitted: true })

    const after = await report(tools)
    const edited = after.shutters[0]?.parts.find((part) => part.mark === mark)
    expect(edited?.omittedFromOrder).toBe(true)
    // The note survived the second write; a flat write would have dropped it.
    expect(
      (after.shutters[0]?.parts.find((part) => part.mark === mark) as { note?: string | null })
        .note,
    ).toBe('checked on site')
  })

  test('reports the mutation so the graph is persisted', async () => {
    const { tools, mutations } = await shuttered()
    const parts = await report(tools)
    const mark = parts.shutters[0]?.parts[0]?.mark as string
    const before = mutations()

    await call(tools, 'set_formwork_part', { elementId: 'wall_1', mark, omitted: true })

    expect(mutations()).toBe(before + 1)
  })
})
