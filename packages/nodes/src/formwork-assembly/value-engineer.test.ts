import { describe, expect, test } from 'bun:test'
import type { AnyNode, WallNode } from '@pascal-app/core'
import { STOCKABLE_CATALOG_PARTS } from '@pascal-app/core/formwork'
import type { FormworkAssemblyNode } from './schema'
import { solveProjectFormwork } from './solve-project'
import { formworkValueOptions, valueCaveats, valueOptionByKey } from './value-engineer'

/**
 * Building the same job a second way.
 *
 * The failures worth guarding are the ones that make an option read better than it is: a
 * comparison taken off a converted bill rather than a second layout (the fitting count would
 * not move), a money verdict on a project that has recorded no rates, an option offered against
 * the system already in use, and a mixed job compared against half of itself.
 */

function makeWall(id: string, overrides: Partial<WallNode> = {}): WallNode {
  return {
    object: 'node',
    id,
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
    formworkType: 'steel-panel',
    ...overrides,
  } as WallNode
}

function makeAssembly(
  id: string,
  hostId: string,
  overrides: Partial<FormworkAssemblyNode> = {},
): FormworkAssemblyNode {
  return {
    object: 'node',
    id,
    type: 'formwork-assembly',
    parentId: hostId,
    visible: true,
    metadata: {},
    children: [],
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    panelWidth: 0.6,
    fillerPosition: 'middle',
    segmentIndex: 0,
    liftIndex: 0,
    partOverrides: {},
    ...overrides,
  } as unknown as FormworkAssemblyNode
}

function sceneOf(...members: Array<WallNode | FormworkAssemblyNode>): Record<string, AnyNode> {
  const hosts = members.filter((node) => node.type !== 'formwork-assembly')
  const nodes: Record<string, AnyNode> = {
    level_1: {
      object: 'node',
      id: 'level_1',
      type: 'level',
      parentId: null,
      visible: true,
      metadata: {},
      children: hosts.map((host) => host.id as string),
      elevation: 0,
      height: 3,
    } as unknown as AnyNode,
  }
  for (const member of members) nodes[member.id as string] = member as unknown as AnyNode
  return nodes
}

function withSettings(
  nodes: Record<string, AnyNode>,
  settings: Record<string, unknown>,
): Record<string, AnyNode> {
  return {
    ...nodes,
    'formwork-settings_1': {
      object: 'node',
      id: 'formwork-settings_1',
      type: 'formwork-settings',
      parentId: 'site_1',
      visible: true,
      metadata: {},
      children: [],
      ...settings,
    } as unknown as AnyNode,
  }
}

function steelWallScene(): Record<string, AnyNode> {
  return sceneOf(makeWall('wall_1'), makeAssembly('formwork-assembly_1', 'wall_1'))
}

function optionsFor(nodes: Record<string, AnyNode>) {
  return formworkValueOptions(nodes, {}, solveProjectFormwork(nodes))
}

describe('formworkValueOptions', () => {
  test('the system in use is not offered as an alternative to itself', () => {
    const value = optionsFor(steelWallScene())

    expect(value.currentSystemIds).toEqual(['doka-framax-xlife'])
    expect(value.options.map((option) => option.systemId)).toEqual(['peri-trio'])
    expect(value.refusal).toBeUndefined()
  })

  test('the option is a second layout, not a converted bill', () => {
    // The guard against the cheap implementation. Re-pricing the current quantities into another
    // system's part numbers would leave the fitting count identical, which is exactly the figure
    // a different panel grid has to move.
    const value = optionsFor(steelWallScene())
    const option = value.options[0]

    expect(option?.fittings.delta).not.toBe(0)
    expect(option?.weightKg.delta).not.toBe(0)
    expect(option?.fittings.from).toBeGreaterThan(0)
    expect(option?.fittings.to).toBeGreaterThan(0)
  })

  test('an unpriced project still gets the quantities, and says the money is missing', () => {
    const value = optionsFor(steelWallScene())
    const option = value.options[0]

    expect(option?.verdict).toBe('not-priced')
    expect(option?.cost).toBeUndefined()
    expect(option?.gaps).toContain('no-rates')
    expect(option?.gaps).toContain('no-norms')
    expect(option?.weightKg.from).toBeGreaterThan(0)
    expect(valueCaveats(value).join(' ')).toContain('no money')
  })

  test('a priced project gets a verdict, and the figures are the two solves’ own totals', () => {
    // Every catalog part priced the same per month, so the money follows the fitting count —
    // which is the only way to assert a delta here without restating either layout.
    const byCatalogId = Object.fromEntries(
      STOCKABLE_CATALOG_PARTS.map((part) => [part.id, { rentalPerUnitPerMonth: 10 }]),
    )
    const nodes = withSettings(steelWallScene(), {
      rates: { currency: 'GBP', byCatalogId },
    })
    const current = solveProjectFormwork(nodes)
    const value = formworkValueOptions(nodes, {}, current)
    const option = value.options[0]

    expect(option?.cost?.from).toBe(current.cost?.totalCost as number)
    expect(option?.cost?.from).toBeGreaterThan(0)
    expect(option?.cost?.delta).toBe((option?.cost?.to as number) - (option?.cost?.from as number))
    expect(['cheaper', 'dearer', 'level']).toContain(option?.verdict as string)
    expect(value.currency).toBe('GBP')
  })

  test('a rate table nothing in the bill matches is not a priced comparison', () => {
    // A cost object exists — the project has a rate table — and every line in it went unpriced,
    // so the total is zero. A verdict off that would read as "level", which is a call this model
    // has no basis for making.
    const nodes = withSettings(steelWallScene(), {
      rates: { currency: 'GBP', byCatalogId: { 'nothing-like-this': { purchasePerUnit: 10 } } },
    })

    expect(optionsFor(nodes).options[0]?.verdict).toBe('not-priced')
  })

  test('a mixed job is compared against standardising on either system', () => {
    const nodes = sceneOf(
      makeWall('wall_1'),
      makeWall('wall_2', { start: [0, 4], end: [6, 4] } as Partial<WallNode>),
      makeAssembly('formwork-assembly_1', 'wall_1', { systemId: 'peri-trio' }),
      makeAssembly('formwork-assembly_2', 'wall_2', { systemId: 'doka-framax-xlife' }),
    )

    const value = optionsFor(nodes)

    expect(value.currentSystemIds).toEqual(['doka-framax-xlife', 'peri-trio'])
    expect(value.options).toHaveLength(2)
    expect(valueCaveats(value).join(' ')).toContain('standardising')
  })

  test('an unformed scope is refused rather than compared against nothing', () => {
    const value = optionsFor(sceneOf(makeWall('wall_1')))

    expect(value.refusal).toBe('nothing-formed')
    expect(value.options).toEqual([])
    expect(valueCaveats(value)[0]).toContain('generate the formwork first')
  })

  test('an option can be taken by key, and an unknown key resolves to nothing', () => {
    const value = optionsFor(steelWallScene())

    expect(valueOptionByKey(value, 'system:peri-trio')?.systemId).toBe('peri-trio')
    expect(valueOptionByKey(value, 'system:nothing-like-this')).toBeUndefined()
  })

  test('the caveats name the write that takes an option, and refuse to read as a quote', () => {
    const text = valueCaveats(optionsFor(steelWallScene())).join(' ')

    expect(text).toContain('set_formwork_settings parts.systemId')
    expect(text).toContain('None of this is a quotation')
  })
})
