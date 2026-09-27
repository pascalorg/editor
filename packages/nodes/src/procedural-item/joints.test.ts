import { expect, test } from 'bun:test'
import {
  type EvaluatedMotion,
  evaluateRecipe,
  motionRestOffset,
  ProceduralItemNode,
  parseRecipe,
  type Recipe,
} from '@pascal-app/core/procedural-items'
import * as THREE from 'three'
import cabinetJson from '../../../core/src/procedural-items/__fixtures__/cabinet_two_doors_drawer.json'
import jointJson from '../../../core/src/procedural-items/__fixtures__/joint_cabinet.json'
import { bakeProceduralAnimationClips } from './animation'
import { buildProceduralGeometry } from './geometry'

// The renderer's object tree: a merged rest container, and joint groups nested by parent.
function renderTree(node: ProceduralItemNode, motions: EvaluatedMotion[]) {
  const root = new THREE.Group()
  const rest = new THREE.Group()
  rest.userData.pascalProceduralRest = true
  rest.add(new THREE.Mesh())
  const split = new THREE.Group()
  split.userData.pascalProceduralSplit = true
  split.visible = false
  root.add(rest, split)
  const groups = new Map<string, THREE.Group>()
  for (const motion of motions) {
    const group = new THREE.Group()
    group.name = `${node.id}__motion__${motion.id}`
    group.position.set(...motionRestOffset(motion, motions))
    group.userData.proceduralMotion = {
      nodeId: node.id,
      partId: motion.partId,
      groupId: motion.id,
      kind: motion.kind,
    }
    groups.set(motion.id, group)
  }
  for (const motion of motions)
    (motion.parent ? groups.get(motion.parent)! : split).add(groups.get(motion.id)!)
  return { root, rest, split, groups }
}

test('part-tree designs also build their merged rest pose; flat designs do not', () => {
  const built = buildProceduralGeometry(
    ProceduralItemNode.parse({ recipe: parseRecipe(jointJson) }),
  )
  expect(built.rest!.map((batch) => batch.slot).sort()).toEqual(['carcass', 'front', 'metal'])
  const restTriangles = built.rest!.reduce(
    (n, b) => n + b.geometry.getAttribute('position').count / 3,
    0,
  )
  expect(restTriangles).toBe(built.triangles)
  for (const batch of built.rest!)
    expect(batch.ranges.at(-1)!.end).toBe(batch.geometry.getAttribute('position').count / 3)
  const flat = buildProceduralGeometry(
    ProceduralItemNode.parse({ recipe: parseRecipe(structuredClone(cabinetJson)) }),
  )
  expect(flat.rest).toBeUndefined()
})

test('nested joints bake per-part clips on nested groups, and the export drops the rest pose', () => {
  const recipe = parseRecipe(jointJson)
  const node = ProceduralItemNode.parse({ recipe })
  const { motions } = evaluateRecipe(recipe)
  const { root, rest, split, groups } = renderTree(node, motions)
  const clips = bakeProceduralAnimationClips(node, root)
  expect(rest.parent).toBeNull()
  expect(split.visible).toBe(true)
  expect(clips.map((clip) => clip.name)).toEqual(
    ['door', 'knob', 'drawer', 'pull'].map((part) => `${node.id}:${part}: open`),
  )
  const knob = groups.get('knob')!
  expect(knob.parent).toBe(groups.get('door')!)
  expect(knob.position.toArray()).toEqual(
    motionRestOffset(motions.find((m) => m.id === 'knob')!, motions),
  )
  // The drawer slides from its rest offset; the pull swings about +X inside it.
  const drawer = clips.find((clip) => clip.name.endsWith(':drawer: open'))!.tracks[0]!
  expect(drawer.name.endsWith('.position')).toBe(true)
  expect(Array.from(drawer.values.slice(0, 3))).toEqual([0, 0, 0])
  expect(drawer.values.at(-1)).toBeCloseTo(0.3)
  const pull = clips.find((clip) => clip.name.endsWith(':pull: open'))!.tracks[0]!
  const end = new THREE.Quaternion().fromArray(Array.from(pull.values.slice(-4)))
  expect(
    end.angleTo(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -1.2)),
  ).toBeCloseTo(0)
  for (const clip of clips) {
    const group = root.getObjectByProperty('uuid', clip.tracks[0]!.name.split('.')[0]!)!
    expect(group.userData.proceduralMotion.clip).toBe(clip.name)
  }
})

test('an off-axis joint bakes its rotation about its own direction', () => {
  const recipe = structuredClone(jointJson) as Recipe
  recipe.joints![1]!.axis = [0, 0.6, 0.8]
  const parsed = parseRecipe(recipe)
  const node = ProceduralItemNode.parse({ recipe: parsed })
  const { motions } = evaluateRecipe(parsed)
  const { root } = renderTree(node, motions)
  const clip = bakeProceduralAnimationClips(node, root).find((c) => c.name.endsWith(':knob: open'))!
  const end = new THREE.Quaternion().fromArray(Array.from(clip.tracks[0]!.values.slice(-4)))
  const expected = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0.6, 0.8), 1.2)
  expect(end.angleTo(expected)).toBeCloseTo(0)
})
