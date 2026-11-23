import type { AnyNode, RoofNode } from '../schema'
import { nodeRegistry } from './registry'
import type { RoofsCapability } from './types'

type Nodes = Readonly<Record<string, AnyNode | undefined>>
type Pt = [number, number]

/**
 * The node's `roofs` capability, when its kind declares one: the node is a face of the roof holding
 * it. Undefined for a roof's segments, which are its masses, and for kinds this runtime has not
 * registered.
 */
export function roofFaceOf(node: AnyNode | undefined): RoofsCapability | undefined {
  return node ? nodeRegistry.get(node.type)?.capabilities.roofs : undefined
}

/** A face of a roof in the frame of what holds the roof: its level's metres. */
export type RoofFaceShape = {
  id: string
  /** The face's outline in that plan, `[x, z]` corners. */
  outline: Pt[]
  /** Its surface at its lowest corner (the eave) and at its highest, over that frame's floor. */
  low: number
  high: number
}

/**
 * A roof's faces (`capabilities.roofs`), in `children` order, each in the plan and heights of what
 * holds the roof: the roof's turn and position applied to the face's own frame. A face of a kind
 * this runtime has not registered, or one with no area, is not read.
 */
export function roofFaceShapes(roof: RoofNode, nodes: Nodes): RoofFaceShape[] {
  // The roof's turn about +Y, as three.js turns its group: local +z toward +x.
  const cos = Math.cos(roof.rotation ?? 0)
  const sin = Math.sin(roof.rotation ?? 0)
  const [x0, y0, z0] = roof.position
  return (roof.children ?? []).flatMap((id) => {
    const face = nodes[id]
    const roofs = roofFaceOf(face)
    if (!(face && roofs)) return []
    const corners = roofs.outline(face)
    const heights = corners.map(([x, z]) => roofs.heightAt(face, x, z))
    if (
      corners.length < 3 ||
      !corners.every(([x, z]) => Number.isFinite(x) && Number.isFinite(z)) ||
      !heights.every(Number.isFinite)
    )
      return []
    return [
      {
        id: face.id,
        outline: corners.map(([x, z]): Pt => [x0 + x * cos + z * sin, z0 - x * sin + z * cos]),
        low: y0 + Math.min(...heights),
        high: y0 + Math.max(...heights),
      },
    ]
  })
}

/**
 * A roof holds its segments and faces of other kinds (`capabilities.roofs`), nothing else: a child
 * a write adds to it, of a registered kind that is neither, is refused. What it held before stays,
 * so a roof saved before the rule still edits, and so does a kind this runtime has not registered
 * (a plugin loaded elsewhere).
 */
export function validateRoofRelations(roof: AnyNode, nodes: Nodes, before?: Nodes): void {
  if (roof.type !== 'roof') return
  const prior = before?.[roof.id]
  const held = new Set<string>(prior?.type === 'roof' ? (prior.children ?? []) : [])
  for (const id of roof.children ?? []) {
    const child = nodes[id]
    if (!child || held.has(id) || child.type === 'roof-segment') continue
    const definition = nodeRegistry.get(child.type)
    if (!definition || definition.capabilities.roofs) continue
    throw new Error(
      `roof ${roof.id} holds its segments and faces of kinds that roof (capabilities.roofs): ${child.type} ${id} is neither.`,
    )
  }
}
