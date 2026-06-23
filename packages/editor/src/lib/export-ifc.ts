import type { AnyNode, AnyNodeId } from '@pascal-app/core'
import { exportSceneToIfc } from '@pascal-app/core/exporters/ifc'
import { collectItemMeshesForIfc } from './export-ifc-item-meshes'

export async function exportSceneToIfcWithItemMeshes(
  nodes: Record<AnyNodeId, AnyNode>,
): Promise<string> {
  const itemMeshes = await collectItemMeshesForIfc(nodes)
  return exportSceneToIfc(nodes, { itemMeshes })
}
