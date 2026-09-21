import type { AnyNode } from '../types'

type WallRelationNode = {
  id: string
  type: 'wall'
  children?: readonly string[]
}

/** Validate the bidirectional ownership index for a wall and its hosted items. */
export function validateWallRelations(
  wall: WallRelationNode,
  nodes: Readonly<Record<string, AnyNode>>,
) {
  const children = wall.children ?? []
  const listed = new Set<string>()

  for (const childId of children) {
    if (listed.has(childId))
      throw new Error(`Wall ${wall.id} lists child ${childId} more than once`)
    listed.add(childId)

    const child = nodes[childId]
    if (!child) throw new Error(`Wall ${wall.id} references missing child ${childId}`)
    if (child.parentId !== wall.id)
      throw new Error(`Wall ${wall.id} does not own listed child ${child.id}`)
  }

  for (const child of Object.values(nodes)) {
    if (child.parentId !== wall.id) continue
    if (!listed.has(child.id))
      throw new Error(`Wall ${wall.id} is missing owned child ${child.id} from children`)
  }
}
