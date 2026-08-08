import { describe, expect, test } from 'bun:test'
import type { SceneGraph } from '@pascal-app/core/clone-scene-graph'
import { buildTools } from './chat-ai'

/**
 * The chat tools' half of the project pour.
 *
 * Every failure mode here is silent — an unparented node that survives the reply
 * and vanishes on reload, a merge that drops a stated sibling, a hallucinated part
 * id that falls back to a default the project never chose, an SCC pick that the
 * pressure codes never see. None of them produce an error the user could notice, so
 * they are tested rather than reasoned about. They mirror the store-path tests in
 * `packages/nodes/src/formwork-project-settings/use-formwork-settings.test.ts`,
 * because a disagreement between the two paths is a disagreement about whether the
 * design report says "assumed" or "project".
 */

type ToolMap = ReturnType<typeof buildTools>

function scene(): {
  graph: SceneGraph
  tools: ToolMap
  mutations: () => number
  settings: () => Record<string, unknown> | undefined
} {
  const graph = {
    nodes: {
      site_1: {
        object: 'node',
        id: 'site_1',
        type: 'site',
        parentId: null,
        visible: true,
        metadata: {},
        children: [],
      },
    },
    rootNodeIds: ['site_1'],
  } as unknown as SceneGraph
  let mutations = 0
  const tools = buildTools(graph, [], () => {
    mutations++
  })
  return {
    graph,
    tools,
    mutations: () => mutations,
    settings: () =>
      (Object.values(graph.nodes) as Array<Record<string, unknown>>).find(
        (node) => node.type === 'formwork-settings',
      ),
  }
}

function set(tools: ToolMap, input: unknown): Promise<string> {
  return (tools.set_formwork_settings.execute as (i: unknown) => Promise<string>)(input)
}

function inspect(tools: ToolMap): Promise<string> {
  return (tools.inspect_formwork_settings.execute as (i: unknown) => Promise<string>)({})
}

describe('set_formwork_settings — the node', () => {
  test('creates the settings node parented to the site', async () => {
    const { tools, settings, graph } = scene()

    await set(tools, { placement: { riseRateMH: 2 } })

    const node = settings()
    expect(node).toBeDefined()
    // Unparented, the store's loader sweeps it and the pour silently reverts.
    expect(node?.parentId).toBe('site_1')
    expect((graph.nodes.site_1 as unknown as { children: string[] }).children).toContain(
      node?.id as string,
    )
  })

  test('reuses the node on a second write rather than making a rival', async () => {
    const { tools, graph } = scene()

    await set(tools, { placement: { riseRateMH: 2 } })
    await set(tools, { pressureStandard: 'ACI_347' })

    const found = (Object.values(graph.nodes) as Array<{ type: string }>).filter(
      (node) => node.type === 'formwork-settings',
    )
    expect(found).toHaveLength(1)
  })

  test('a scene with no site is refused rather than given an orphan', async () => {
    const graph = { nodes: {}, rootNodeIds: [] } as unknown as SceneGraph
    const tools = buildTools(graph, [], () => {})

    const reply = await set(tools, { placement: { riseRateMH: 2 } })

    expect(reply).toStartWith('Error:')
    expect(Object.keys(graph.nodes)).toHaveLength(0)
  })

  test('reports the mutation so the graph is persisted', async () => {
    const { tools, mutations } = scene()

    await set(tools, { placement: { riseRateMH: 2 } })

    expect(mutations()).toBe(1)
  })

  test('an empty call changes nothing', async () => {
    const { tools, settings, mutations } = scene()

    const reply = await set(tools, {})

    expect(reply).toStartWith('Error:')
    expect(settings()).toBeUndefined()
    expect(mutations()).toBe(0)
  })
})

describe('set_formwork_settings — unset stays unset', () => {
  test('writes only the stated field', async () => {
    const { tools, settings } = scene()

    await set(tools, { placement: { riseRateMH: 2 } })

    expect(settings()?.placement).toEqual({ riseRateMH: 2 })
  })

  test('a second field merges instead of replacing the group', async () => {
    const { tools, settings } = scene()

    await set(tools, { placement: { riseRateMH: 2 } })
    await set(tools, { placement: { concreteTemperatureC: 30 } })

    expect(settings()?.placement).toEqual({ riseRateMH: 2, concreteTemperatureC: 30 })
  })

  test('null hands a field back rather than storing it', async () => {
    const { tools, settings } = scene()

    await set(tools, { placement: { riseRateMH: 2, concreteTemperatureC: 30 } })
    await set(tools, { placement: { riseRateMH: null } })

    expect(settings()?.placement).toEqual({ concreteTemperatureC: 30 })
  })

  test('emptying a group removes it, so nothing survives as a stated empty claim', async () => {
    const { tools, settings } = scene()

    await set(tools, { placement: { riseRateMH: 2 } })
    await set(tools, { placement: { riseRateMH: null } })

    expect(settings()?.placement).toBeUndefined()
  })

  test('null unstates a top-level standard', async () => {
    const { tools, settings } = scene()

    await set(tools, { pressureStandard: 'ACI_347' })
    await set(tools, { pressureStandard: null })

    expect(settings()?.pressureStandard).toBeUndefined()
  })
})

describe('set_formwork_settings — the binder is a second level', () => {
  test('a binder field does not drop a stated sibling of concrete', async () => {
    const { tools, settings } = scene()

    await set(tools, { concrete: { unitWeightKnM3: 25 } })
    await set(tools, { cement: { retarder: true } })

    expect(settings()?.concrete).toEqual({ unitWeightKnM3: 25, cement: { retarder: true } })
  })

  test('two binder fields accumulate', async () => {
    const { tools, settings } = scene()

    await set(tools, { cement: { retarder: true } })
    await set(tools, { cement: { slagFraction: 0.5 } })

    expect(settings()?.concrete).toEqual({ cement: { retarder: true, slagFraction: 0.5 } })
  })

  test('emptying the binder removes it rather than leaving a stated empty spec', async () => {
    const { tools, settings } = scene()

    await set(tools, { cement: { retarder: true } })
    await set(tools, { cement: { retarder: null } })

    expect(settings()?.concrete).toBeUndefined()
  })

  test('emptying the binder keeps a stated sibling', async () => {
    const { tools, settings } = scene()

    await set(tools, { concrete: { unitWeightKnM3: 25 } })
    await set(tools, { cement: { retarder: true } })
    await set(tools, { cement: { retarder: null } })

    expect(settings()?.concrete).toEqual({ unitWeightKnM3: 25 })
  })
})

describe('set_formwork_settings — SCC is one fact', () => {
  test('picking SCC sets the flag the pressure codes branch on', async () => {
    const { tools, settings } = scene()

    await set(tools, { concrete: { consistencyClass: 'SCC' } })

    expect(settings()?.concrete).toEqual({ consistencyClass: 'SCC', selfCompacting: true })
  })

  test('picking an F class clears the flag, or the class would be ignored', async () => {
    const { tools, settings } = scene()

    await set(tools, { concrete: { consistencyClass: 'SCC' } })
    await set(tools, { concrete: { consistencyClass: 'F4' } })

    expect(settings()?.concrete).toEqual({ consistencyClass: 'F4' })
  })

  test('a concrete patch that says nothing about consistency leaves the flag alone', async () => {
    const { tools, settings } = scene()

    await set(tools, { concrete: { consistencyClass: 'SCC' } })
    await set(tools, { concrete: { unitWeightKnM3: 25 } })

    expect(settings()?.concrete).toEqual({
      consistencyClass: 'SCC',
      selfCompacting: true,
      unitWeightKnM3: 25,
    })
  })
})

describe('set_formwork_settings — parts come from the catalog', () => {
  test('an id that names nothing is refused, since a bad id falls back silently', async () => {
    const { tools, settings } = scene()

    const reply = await set(tools, { parts: { beamId: 'peri-h20' } })

    expect(reply).toStartWith('Error:')
    expect(settings()).toBeUndefined()
  })

  test('a real catalog id is written', async () => {
    const { tools, settings } = scene()

    await set(tools, { parts: { beamId: 'h20-doka-permissible' } })

    expect(settings()?.parts).toEqual({ beamId: 'h20-doka-permissible' })
  })

  test('null still unstates a part without tripping the catalog check', async () => {
    const { tools, settings } = scene()

    await set(tools, { parts: { beamId: 'h20-doka-permissible', doubledWalers: true } })
    await set(tools, { parts: { beamId: null } })

    expect(settings()?.parts).toEqual({ doubledWalers: true })
  })
})

describe('set_formwork_settings — the reply', () => {
  test('names the pour the scene now designs to', async () => {
    const { tools } = scene()

    const reply = await set(tools, {
      placement: { riseRateMH: 2, concreteTemperatureC: 15 },
      pressureStandard: 'ACI_347',
    })

    expect(reply).toContain('2 m/h')
    expect(reply).toContain('15 °C')
    expect(reply).toContain('ACI_347')
  })

  test('says nothing about existing shutters when there are none', async () => {
    const { tools } = scene()

    const reply = await set(tools, { placement: { riseRateMH: 2 } })

    expect(reply).not.toContain('shutter')
  })

  test('counts the shutters the change reaches, and does not ask for a re-attach', async () => {
    const { graph, tools } = scene()
    for (const id of ['formwork-assembly_1', 'formwork-assembly_2']) {
      ;(graph.nodes as Record<string, unknown>)[id] = {
        object: 'node',
        id,
        type: 'formwork-assembly',
        parentId: 'site_1',
      }
    }

    const reply = await set(tools, { placement: { riseRateMH: 2 } })

    expect(reply).toContain('all 2 existing shutters are')
    // This used to say "call attach_formwork" — the shutters are re-designed on
    // read, so the re-attach bought nothing and cost every part decision on them.
    expect(reply).not.toContain('attach_formwork')
    expect(reply).toContain('nothing to regenerate')
  })
})

describe('inspect_formwork_settings', () => {
  test('reports the assumed defaults as assumed on an untouched scene', async () => {
    const { tools } = scene()

    const report = JSON.parse(await inspect(tools))

    expect(report.anythingStated).toBe(false)
    expect(report.stated).toBeNull()
    // The figure the report would print, and the fact nobody chose it.
    expect(report.resolved.riseRateMH).toBe(report.assumedDefaults.riseRateMH)
    expect(report.resolved.concreteTemperatureC).toBe(report.assumedDefaults.concreteTemperatureC)
  })

  test('separates what the project stated from what resolved around it', async () => {
    const { tools } = scene()

    await set(tools, { placement: { riseRateMH: 2 } })
    const report = JSON.parse(await inspect(tools))

    expect(report.anythingStated).toBe(true)
    expect(report.stated.placement).toEqual({ riseRateMH: 2 })
    expect(report.resolved.riseRateMH).toBe(2)
    // Stated nothing about the temperature, so it is still an assumption.
    expect(report.stated.placement.concreteTemperatureC).toBeUndefined()
    expect(report.resolved.concreteTemperatureC).toBe(report.assumedDefaults.concreteTemperatureC)
  })

  test('does not create the node, so reading is not a decision', async () => {
    const { tools, settings } = scene()

    await inspect(tools)

    expect(settings()).toBeUndefined()
  })
})
