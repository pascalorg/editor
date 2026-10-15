import {
  type AnyNode,
  type CabinetModuleNode,
  type CabinetNode,
  type LiveTransformLike,
  type PlacementNotice,
  resolveLevelId,
} from '@pascal-app/core'
import { type Frame, nodeLevelFrame } from '@pascal-app/core/procedural-items'
import { cabinetOpeningConflicts } from './opening-clearance'

export function cabinetPlacementNotice(
  node: CabinetNode | CabinetModuleNode,
  { nodes, live }: { nodes: Readonly<Record<string, AnyNode>>; live?: LiveTransformLike },
): PlacementNotice | null {
  const effective = live ? { ...node, position: live.position, rotation: live.rotation } : node
  const scene = { ...nodes, [node.id]: effective }
  const levelId = resolveLevelId(effective, scene)
  if (!levelId) return null
  const cache = new Map<string, Frame>()
  const modules: CabinetModuleNode[] = []
  const visit = (entry: CabinetNode | CabinetModuleNode, seen = new Set<string>()) => {
    if (seen.has(entry.id)) return
    seen.add(entry.id)
    if (entry.type === 'cabinet-module') modules.push(entry)
    for (const id of entry.children) {
      const child = scene[id]
      if (child?.type === 'cabinet' || child?.type === 'cabinet-module') visit(child, seen)
    }
  }
  visit(effective)
  for (const module of modules) {
    const pose = nodeLevelFrame(module.id, scene, new Set(), { cache })
    if (
      cabinetOpeningConflicts(
        module,
        pose.position,
        Math.atan2(pose.axes[2][0], pose.axes[2][2]),
        levelId,
        scene,
      ).length
    )
      return { line: 'Opening clearance: nearby objects may block a door or drawer' }
  }
  return null
}
