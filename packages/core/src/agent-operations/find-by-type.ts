import { isScriptedNode } from '../lib/geometry-script-node'
import type { AnyNode, ItemNode } from '../schema'
import { requireLevel } from './level-target'
import { levelIdOf } from './scene-queries'
import type { AgentOperation } from './types'

type Vec3 = [number, number, number]

const round = (v: number) => Math.round(v * 1000) / 1000

/** A point in an item's frame, in its level's frame (items on a level: position + yaw). */
function toLevel(item: ItemNode, [x, y, z]: Vec3): Vec3 {
  const yaw = item.rotation[1] ?? 0
  const [sx, sy, sz] = item.scale
  const lx = x * sx
  const lz = z * sz
  return [
    round(item.position[0] + Math.cos(yaw) * lx + Math.sin(yaw) * lz),
    round(item.position[1] + y * sy),
    round(item.position[2] - Math.sin(yaw) * lx + Math.cos(yaw) * lz),
  ]
}

function boundsInLevel(item: ItemNode, bounds: { min: Vec3; max: Vec3 }) {
  const corners: Vec3[] = []
  for (const x of [bounds.min[0], bounds.max[0]])
    for (const y of [bounds.min[1], bounds.max[1]])
      for (const z of [bounds.min[2], bounds.max[2]]) corners.push(toLevel(item, [x, y, z]))
  return {
    min: [0, 1, 2].map((k) => Math.min(...corners.map((c) => c[k]!))) as Vec3,
    max: [0, 1, 2].map((k) => Math.max(...corners.map((c) => c[k]!))) as Vec3,
  }
}

const emitsLight = (node: AnyNode) =>
  node.type === 'item' &&
  Boolean(node.asset.interactive?.effects.some((effect) => effect.kind === 'light'))

const matchesWord = (text: string | undefined, word: string) =>
  Boolean(text) &&
  text!
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .includes(word)

/**
 * `find_by_type`: everything of one type, nodes and the typed parts of
 * authored objects alike. Parts are read from each object's manifest; the
 * object stays the thing that is selected, moved and edited.
 */
export const findByType: AgentOperation<{ type: string; levelId?: string }> = (
  nodes,
  { type, levelId },
) => {
  // A level that is not there is said, as get_zones says it, not answered with nothing found.
  if (levelId) requireLevel(nodes, levelId)
  const word = type.trim().toLowerCase().replace(/s$/, '')
  const results: Record<string, unknown>[] = []
  for (const node of Object.values(nodes)) {
    const level = levelIdOf(nodes, node.id)
    if (levelId && level !== levelId) continue
    const item = node.type === 'item' ? node : null
    const typed = (isScriptedNode(node) ? node.source.manifest.parts : []).filter(
      (part) => part.type,
    )
    const typedParts = typed.filter((part) => part.type === word)
    // An authored item whose typed parts are all of this type is one (a
    // lantern); a mixed one (a porch), or a window, door or column, answers
    // with its parts.
    const wholeAuthored =
      item !== null && typedParts.length > 0 && typedParts.length === typed.length
    const wholeMatch =
      node.type === word ||
      wholeAuthored ||
      (item &&
        (matchesWord(item.asset.category, word) ||
          (word === 'light' && emitsLight(node) && typedParts.length === 0)))
    if (wholeMatch) {
      results.push({
        id: node.id,
        name: node.name ?? item?.asset.name,
        nodeType: node.type,
        levelId: level,
      })
      continue
    }
    for (const part of typedParts) {
      results.push({
        id: node.id,
        name: node.name ?? item?.asset.name,
        nodeType: node.type,
        levelId: level,
        part: part.id,
        partType: part.type,
        ...(part.bounds && item && item.parentId === level
          ? { bounds: boundsInLevel(item, part.bounds) }
          : {}),
      })
    }
  }
  return {
    result: {
      type: word,
      count: results.length,
      nodes: results.filter((entry) => !entry.part).length,
      parts: results.filter((entry) => entry.part).length,
      results,
    },
  }
}
