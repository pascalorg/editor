import { describe, expect, test } from 'bun:test'
import type { SceneGraph } from '@pascal-app/core/clone-scene-graph'
import { validationSummary } from '@pascal-app/core/formwork'
import type { AnyNode } from '@pascal-app/core/schema'
import { validateProjectFormwork } from '@pascal-app/nodes/formwork-assembly'
import { buildTools } from './chat-ai'

/**
 * The AI asked whether the job can be built.
 *
 * A different question from what it costs, and the model has no way of deriving one
 * from the other: a bill can total perfectly for a shutter that opens under pressure.
 * So the tests here are about the model getting the answer in a form it cannot round
 * off — the two severities apart, because an error is a thing the crew cannot do and a
 * warning is an exception somebody signs; the unchecked assertions present, because a
 * list of failures alone reads as a clean bill of health for everything never
 * examined; and the sentences word for word the ones in the Buildability panel, so a
 * user comparing the chat to the screen is not left working out whether they are
 * looking at one fault or two.
 */

type ToolMap = ReturnType<typeof buildTools>

const call = (tools: ToolMap, name: keyof ToolMap, input: unknown): Promise<string> =>
  (tools[name].execute as (i: unknown) => Promise<string>)(input)

interface ValidationReply {
  scope: string
  elementCount: number
  errorCount: number
  warningCount: number
  findings: Array<{
    invariant: string
    severity: 'error' | 'warning'
    elementIds: string[]
    message: string
    locus: { alongM?: number; elevationM?: number } | null
  }>
  summary: string[]
  shutteredIds: string[]
  notChecked: Array<{ invariant: string; needs: string }>
}

/** Two levels, so a level scope can be wrong in either direction. */
function scene(): { graph: SceneGraph; tools: ToolMap } {
  const wall = (id: string, parentId: string, y: number, thickness = 0.25) => ({
    object: 'node',
    id,
    type: 'wall',
    parentId,
    visible: true,
    metadata: {},
    children: [],
    start: [0, y],
    end: [6, y],
    thickness,
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
      // Thicker than any system tie assembly reaches, which is the check that only
      // runs on the catalog the element is actually formed in.
      wall_2: wall('wall_2', 'level_1', 4, 1.4),
      wall_3: wall('wall_3', 'level_2', 0),
    },
    rootNodeIds: ['site_1'],
  } as unknown as SceneGraph
  return { graph, tools: buildTools(graph, [], () => {}) }
}

async function shutter(tools: ToolMap, elementId: string) {
  await call(tools, 'set_element_construction', { elementId, formworkType: 'steel-panel' })
  await call(tools, 'attach_formwork', { elementId })
}

const validate = async (tools: ToolMap, input: unknown = {}): Promise<ValidationReply> =>
  JSON.parse(await call(tools, 'validate_formwork', input)) as ValidationReply

describe('validate_formwork', () => {
  test('faults a wall no tie in its system holds, and names the thickness', async () => {
    const { tools } = scene()
    await shutter(tools, 'wall_2')

    const reply = await validate(tools, { levelId: 'level_1' })

    const tie = reply.findings.find((finding) => finding.invariant === 'WALL_OUTSIDE_TIE_RANGE')
    expect(tie).toBeDefined()
    // Actionable means naming the figure that failed. "Outside the tie range" alone is
    // a claim the reader cannot check.
    expect(tie?.message).toContain('1400 mm')
    expect(tie?.elementIds).toEqual(['wall_2'])
  })

  test('keeps the two severities apart rather than reporting one count', async () => {
    const { tools } = scene()
    await shutter(tools, 'wall_1')
    await shutter(tools, 'wall_2')

    const reply = await validate(tools, { levelId: 'level_1' })

    expect(reply.errorCount + reply.warningCount).toBe(reply.findings.length)
    expect(reply.findings.filter((f) => f.severity === 'error')).toHaveLength(reply.errorCount)
    expect(reply.findings.filter((f) => f.severity === 'warning')).toHaveLength(reply.warningCount)
  })

  test('the model reads the sentences the panel shows, word for word', async () => {
    // Three phrasings of one fault is how a user comes to believe two of them are
    // different problems.
    const { graph, tools } = scene()
    await shutter(tools, 'wall_2')

    const reply = await validate(tools, { levelId: 'level_1' })
    const onScreen = validationSummary(
      validateProjectFormwork(graph.nodes as unknown as Record<string, AnyNode>, {
        parentId: 'level_1',
      }).report,
    )

    expect(reply.summary).toEqual(onScreen)
  })

  test('says which assertions could not run here', async () => {
    // A report of failures alone reads as a clean bill of health for everything it
    // never examined — rebar clashes and crane capacity among them.
    const { tools } = scene()
    await shutter(tools, 'wall_1')

    const reply = await validate(tools, { levelId: 'level_1' })

    expect(reply.notChecked.map((entry) => entry.invariant)).toContain('TIES_THROUGH_REBAR')
    for (const entry of reply.notChecked) expect(entry.needs.length).toBeGreaterThan(0)
  })

  test('the layout and pressure checks are unchecked until something is shuttered', async () => {
    // They are properties of a solved layout, and an element nobody has formed has no
    // layout to fault. Absent from the list they would read as passed.
    const { tools } = scene()

    const bare = await validate(tools, { levelId: 'level_1' })
    await shutter(tools, 'wall_1')
    await shutter(tools, 'wall_2')
    const formed = await validate(tools, { levelId: 'level_1' })

    const names = (reply: ValidationReply) => reply.notChecked.map((entry) => entry.invariant)
    expect(names(bare)).toContain('UNFORMABLE_STRIP')
    expect(names(bare)).toContain('WALL_OUTSIDE_TIE_RANGE')
    expect(names(formed)).not.toContain('UNFORMABLE_STRIP')
    expect(names(formed)).not.toContain('WALL_OUTSIDE_TIE_RANGE')
  })

  test('names which elements had a layout to check at all', async () => {
    const { tools } = scene()
    await shutter(tools, 'wall_1')

    const reply = await validate(tools, { levelId: 'level_1' })

    expect(reply.elementCount).toBe(2)
    expect(reply.shutteredIds).toEqual(['wall_1'])
  })

  test('scopes to a level, and does not carry the floor above', async () => {
    const { tools } = scene()
    await shutter(tools, 'wall_2')
    await shutter(tools, 'wall_3')

    const ground = await validate(tools, { levelId: 'level_1' })

    expect(ground.findings.flatMap((finding) => finding.elementIds)).not.toContain('wall_3')
    expect(ground.elementCount).toBe(2)
  })

  test('checks only the elements named when given a selection', async () => {
    const { tools } = scene()
    await shutter(tools, 'wall_1')
    await shutter(tools, 'wall_2')

    const named = await validate(tools, { elementIds: ['wall_1'] })

    expect(named.shutteredIds).toEqual(['wall_1'])
    expect(named.findings.flatMap((finding) => finding.elementIds)).not.toContain('wall_2')
  })

  test('a level that does not exist is refused, not reported as nothing wrong', async () => {
    // Scoped to a typo, the honest answer looks exactly like a floor that passed.
    const { tools } = scene()
    await shutter(tools, 'wall_2')

    const reply = await call(tools, 'validate_formwork', { levelId: 'level_9' })

    expect(reply).toStartWith('Error:')
    expect(reply).toContain('list_castable_elements')
  })

  test('an empty scope is not an empty pass', async () => {
    const { tools } = scene()

    const reply = await validate(tools, { elementIds: [] })

    expect(reply.findings).toEqual([])
    expect(reply.shutteredIds).toEqual([])
    expect(reply.summary.join(' ')).toContain('Nothing in this scope to check.')
  })
})
