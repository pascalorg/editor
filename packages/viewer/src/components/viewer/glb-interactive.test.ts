import { expect, test } from 'bun:test'
import type { AnyNodeId, SceneGraph } from '@pascal-app/core'
import type { EvaluatedLight } from '@pascal-app/core/procedural-items'
import { Group, Vector3 } from 'three'
import chandelier from '../../../../core/src/procedural-items/__fixtures__/chandelier_six_arms.json'
import {
  buildGlbInteractiveItems,
  buildGlbLightRegs,
  type GlbInteractiveItem,
} from './glb-interactive'

test('three six-arm chandeliers register eighteen distinct emitters for twelve pooled slots', () => {
  const nodes = Object.fromEntries(
    [1, 2, 3].map((index) => [
      `chandelier_${index}`,
      { type: 'procedural-item', recipe: chandelier, parameters: {}, name: `Chandelier ${index}` },
    ]),
  )
  const items = buildGlbInteractiveItems({ nodes } as unknown as SceneGraph)
  const identity = new Map(items.map((item) => [item.pascalId, new Group()]))
  const regs = buildGlbLightRegs(items, identity)
  expect(regs).toHaveLength(18)
  expect(new Set(regs.map((reg) => reg.key)).size).toBe(18)
  expect(new Set(regs.map((reg) => reg.nodeId)).size).toBe(3)
})

test('baked catalog effects keep distinct emitter keys and one control owner', () => {
  const item: GlbInteractiveItem = {
    pascalId: 'lamp' as AnyNodeId,
    label: 'Lamp',
    height: 1,
    interactive: {
      controls: [{ kind: 'toggle', label: 'Power' }],
      effects: [
        { kind: 'light', color: '#ffffff', offset: [0, 1, 0], intensityRange: [0, 2] },
        { kind: 'light', color: '#ff0000', offset: [1, 1, 0], intensityRange: [0, 2] },
      ],
    },
  }
  const regs = buildGlbLightRegs([item], new Map([['lamp', new Group()]]))
  expect(regs.map((reg) => reg.key)).toEqual(['lamp:0', 'lamp:1'])
  expect(regs.map((reg) => reg.nodeId)).toEqual(['lamp', 'lamp'])
})

test('baked moving emitter follows its motion group around the pivot', () => {
  const root = new Group()
  const motion = new Group()
  motion.position.set(1, 0, 0)
  motion.userData.proceduralMotion = { groupId: 'arm' }
  root.add(motion)
  const light: EvaluatedLight = {
    id: 'bulb:0',
    partId: 'bulb',
    index: 0,
    motionGroup: 'arm',
    position: [1.5, 0, 0],
    color: '#ffffff',
    intensity: 2,
    distance: 5,
  }
  const item: GlbInteractiveItem = {
    pascalId: 'fixture' as AnyNodeId,
    label: 'Fixture',
    height: 1,
    interactive: { controls: [], effects: [] },
    procedural: { lights: [light], parts: [] },
  }
  const [reg] = buildGlbLightRegs([item], new Map([['fixture', root]]))
  const position = new Vector3()
  reg!.getWorldPosition(position)
  expect(position.toArray()).toEqual([1.5, 0, 0])
  motion.rotation.z = Math.PI / 2
  reg!.getWorldPosition(position)
  expect(position.x).toBeCloseTo(1)
  expect(position.y).toBeCloseTo(0.5)
})
