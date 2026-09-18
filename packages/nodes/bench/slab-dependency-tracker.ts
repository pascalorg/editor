import {
  AnyNode,
  type AnyNodeId,
  getLinkedWallUpdates,
  type SlabNode,
  type WallNode,
} from '@pascal-app/core'
import fixture from '../../core/src/store/fixtures/maxi-8x-endpoint.json'
import { createSlabDependencyTracker } from '../src/slab/dependency-tracker'

// Preserve the origin/main signature and dirty-selection work for a like-for-like baseline.
function levelSlabContextSignatures(nodes: Record<string, AnyNode>): Map<string, string> {
  const partsByLevel = new Map<string, string[]>()

  const push = (levelId: string, part: string) => {
    const parts = partsByLevel.get(levelId)
    if (parts) parts.push(part)
    else partsByLevel.set(levelId, [part])
  }

  for (const node of Object.values(nodes)) {
    const levelId = node.parentId
    if (!levelId) continue
    if (node.type === 'wall') {
      const wall = node as WallNode
      push(
        levelId,
        `w|${wall.id}|${wall.start[0]},${wall.start[1]}|${wall.end[0]},${wall.end[1]}|${wall.thickness ?? ''}|${wall.curveOffset ?? ''}`,
      )
    } else if (node.type === 'slab') {
      const slab = node as SlabNode
      // Elevation is a seam input: an unequal-elevation seam projects to
      // the lower side's wall face, so a height change reshapes siblings.
      push(
        levelId,
        `s|${slab.id}|${slab.elevation ?? ''}|${slab.polygon.map(([x, z]) => `${x},${z}`).join(';')}`,
      )
    }
  }

  for (const node of Object.values(nodes)) {
    if (node.type !== 'building') continue
    const transform = `${node.position.join(',')}|${node.rotation.join(',')}`
    for (const childId of node.children) {
      const child = nodes[childId]
      if (child?.type === 'level') push(child.id, `b|${node.id}|${transform}`)
    }
  }

  const signatures = new Map<string, string>()
  for (const [levelId, parts] of partsByLevel.entries()) {
    signatures.set(levelId, parts.sort().join('||'))
  }
  return signatures
}

function oldTracker(initial: Record<string, AnyNode>) {
  let previous = levelSlabContextSignatures(initial)
  return (nodes: Record<string, AnyNode>) => {
    const current = levelSlabContextSignatures(nodes)
    const dirty: AnyNodeId[] = []
    for (const [levelId, signature] of current) {
      if (previous.get(levelId) === signature) continue
      for (const node of Object.values(nodes)) {
        if (node.type === 'slab' && node.parentId === levelId) dirty.push(node.id)
      }
    }
    previous = current
    return dirty
  }
}

const initial: Record<string, AnyNode> = Object.fromEntries(
  fixture.nodes.map((raw) => {
    const node = AnyNode.parse(raw)
    return [node.id, node]
  }),
)
const wall = initial[fixture.updates[0]!.id] as WallNode
const nextStart: [number, number] = [wall.start[0], wall.start[1] + 0.4]
const nextEnd: [number, number] = [wall.end[0], wall.end[1] + 0.4]
const moved = { ...initial, [wall.id]: { ...wall, start: nextStart, end: nextEnd } }
const linked = Object.values(initial).filter(
  (node): node is WallNode =>
    node.type === 'wall' && node.id !== wall.id && node.parentId === wall.parentId,
)
for (const update of getLinkedWallUpdates(
  linked.map((wall) => ({ wall })),
  wall.start,
  wall.end,
  nextStart,
  nextEnd,
)) {
  const original = initial[update.id] as WallNode
  if (update.start === original.start && update.end === original.end) continue
  moved[update.id] = { ...original, start: update.start, end: update.end }
}

const iterations = 1000
function measure(create: typeof oldTracker) {
  const update = create(moved)
  for (let i = 0; i < 100; i++) {
    update(initial)
    update(moved)
  }
  let elapsed = 0
  let marks = 0
  for (let i = 0; i < iterations; i++) {
    const start = performance.now()
    marks += update(initial).length
    elapsed += performance.now() - start
    update(moved)
  }
  return { msPerWrite: elapsed / iterations, marksPerWrite: marks / iterations }
}
const runs = Array.from({ length: 7 }, (_, i) => {
  const order =
    i % 2 ? [createSlabDependencyTracker, oldTracker] : [oldTracker, createSlabDependencyTracker]
  return Object.fromEntries(
    order.map((create) => [create === oldTracker ? 'old' : 'new', measure(create)]),
  )
})
for (const key of ['old', 'new']) {
  const sorted = runs.map((run) => run[key]!).sort((a, b) => a.msPerWrite - b.msPerWrite)
  console.log(key, JSON.stringify(sorted[3]))
}
console.log(
  'Fixture:',
  fixture.levelId,
  'walls:',
  Object.values(initial).filter((node) => node.type === 'wall').length,
  'slabs:',
  Object.values(initial).filter((node) => node.type === 'slab').length,
  'wall body undo:',
  wall.id,
  'changed walls:',
  Object.keys(moved).filter((id) => moved[id] !== initial[id]).length,
)
