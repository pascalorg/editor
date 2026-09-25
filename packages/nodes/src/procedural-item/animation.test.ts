import { expect, test } from 'bun:test'
import { evaluateRecipe, ProceduralItemNode, parseRecipe } from '@pascal-app/core/procedural-items'
import * as THREE from 'three'
import fanJson from '../../../core/src/procedural-items/__fixtures__/ceiling_fan.json'
import { bakeProceduralAnimationClips } from './animation'

test('different spin periods export separate clips with actual group bindings', () => {
  const recipe = parseRecipe(fanJson)
  recipe.parts[1]!.motion = {
    kind: 'spin',
    pivot: [0, 2.1, 0],
    axis: 'y',
    radiansPerSecond: { op: 'add', args: [2, 'index'] },
  }
  const node = ProceduralItemNode.parse({ recipe })
  const root = new THREE.Group()
  for (const motion of evaluateRecipe(recipe).motions) {
    const group = new THREE.Group()
    group.name = `${node.id}__motion__${motion.id}`
    group.userData.proceduralMotion = {
      nodeId: node.id,
      partId: motion.partId,
      groupId: motion.id,
      kind: motion.kind,
    }
    root.add(group)
  }
  const clips = bakeProceduralAnimationClips(node, root)
  expect(clips).toHaveLength(5)
  expect(new Set(clips.map((clip) => clip.duration)).size).toBe(5)
  expect(clips.map((clip) => clip.name)).toEqual([
    `${node.id}:rotor: loop`,
    `${node.id}:rotor:1: loop`,
    `${node.id}:rotor:2: loop`,
    `${node.id}:rotor:3: loop`,
    `${node.id}:rotor:4: loop`,
  ])
  for (const clip of clips) {
    const group = root.getObjectByProperty('uuid', clip.tracks[0]!.name.split('.')[0]!)!
    expect(group.userData.proceduralMotion.clip).toBe(clip.name)
    expect(clip.tracks[0]!.times.at(-1)).toBeCloseTo(clip.duration)
  }
})
