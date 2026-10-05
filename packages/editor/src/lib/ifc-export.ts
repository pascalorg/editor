import { type AnyNode, bakePolicyOf, sceneRegistry } from '@pascal-app/core'
import { buildIfcExport, type IfcMeshPart } from '@pascal-app/ifc-converter/export'
import { SCENE_LAYER } from '@pascal-app/viewer'
import * as THREE from 'three'

// Kinds the IFC writer always rebuilds parametrically from node data; their
// rendered triangles are never read, so skip copying them. (Slabs are copied:
// pools and legacy zero-thickness slabs export their rendered shape.)
const PARAMETRIC_KINDS = new Set(['site', 'building', 'level', 'wall', 'ceiling', 'zone'])

function owningNodeId(object: THREE.Object3D): string | null {
  for (let current: THREE.Object3D | null = object; current; current = current.parent) {
    const id = current.userData?.pascalId
    if (typeof id === 'string') return id
  }
  return null
}

function materialColor(
  material: THREE.Material | undefined,
): Pick<IfcMeshPart, 'color' | 'opacity'> {
  const color = (material as THREE.MeshStandardMaterial | undefined)?.color
  const rgb = color ? color.getRGB(new THREE.Color(), THREE.SRGBColorSpace) : null
  return {
    color: rgb ? [rgb.r, rgb.g, rgb.b] : undefined,
    opacity: material?.transparent ? material.opacity : 1,
  }
}

/**
 * World-space triangles per node from a prepared export scene (identity
 * stamped, instancing expanded, deformation frozen, reflected winding fixed).
 * Each material group becomes one part with only the vertices it uses.
 * `renderedNodeIds` lists every node that drew at least one triangle.
 */
export function collectIfcMeshes(
  root: THREE.Object3D,
  nodes: Record<string, AnyNode>,
): { meshes: Map<string, IfcMeshPart[]>; renderedNodeIds: Set<string> } {
  root.updateMatrixWorld(true)
  const parts = new Map<string, IfcMeshPart[]>()
  const renderedNodeIds = new Set<string>()
  const vertex = new THREE.Vector3()

  root.traverseVisible((object) => {
    const mesh = object as THREE.Mesh
    if (!mesh.isMesh) return
    const position = mesh.geometry?.getAttribute('position')
    if (!position || position.count < 3) return
    const nodeId = owningNodeId(mesh)
    const node = nodeId ? nodes[nodeId] : undefined
    if (!node) return
    renderedNodeIds.add(node.id)
    if (PARAMETRIC_KINDS.has(node.type)) return

    const geometry = mesh.geometry
    const drawStart = geometry.drawRange.start
    const drawEnd = Math.min(
      geometry.index ? geometry.index.count : position.count,
      drawStart + geometry.drawRange.count,
    )
    const indexAt = (i: number) => (geometry.index ? geometry.index.getX(i) : i)
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    const groups =
      Array.isArray(mesh.material) && geometry.groups.length > 0
        ? geometry.groups
        : [{ start: drawStart, count: drawEnd - drawStart, materialIndex: 0 }]

    for (const group of groups) {
      const material = materials[group.materialIndex ?? 0]
      if (!material || material.visible === false) continue
      const start = Math.max(group.start, drawStart)
      const end = Math.min(group.start + group.count, drawEnd)
      const remap = new Map<number, number>()
      const positions: number[] = []
      const indices: number[] = []
      for (let i = start; i + 2 < end; i += 3) {
        for (let corner = 0; corner < 3; corner++) {
          const source = indexAt(i + corner)
          let target = remap.get(source)
          if (target === undefined) {
            target = remap.size
            remap.set(source, target)
            vertex.fromBufferAttribute(position, source).applyMatrix4(mesh.matrixWorld)
            positions.push(vertex.x, vertex.y, vertex.z)
          }
          indices.push(target)
        }
      }
      if (indices.length === 0) continue
      const list = parts.get(node.id) ?? []
      list.push({
        positions: new Float32Array(positions),
        indices: new Uint32Array(indices),
        ...materialColor(material),
      })
      parts.set(node.id, list)
    }
  })
  return { meshes: parts, renderedNodeIds }
}

/**
 * Whether the live editor draws `nodeId`: a visible scene-layer mesh under its
 * registered object, or a collectively rendered (`bake: 'replace'`) kind whose
 * instances live outside that object. Overlay-only markers (spawn point,
 * camera shots) draw nothing here.
 */
function drawnInEditor(nodeId: string, nodes: Record<string, AnyNode>): boolean {
  const node = nodes[nodeId]
  const live = sceneRegistry.nodes.get(nodeId)
  if (!node || !live) return false
  if (bakePolicyOf(node.type) === 'replace') return true
  let drawn = false
  live.traverseVisible((object) => {
    const mesh = object as THREE.Mesh
    if (drawn || !mesh.isMesh || !object.layers.isEnabled(SCENE_LAYER)) return
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    const count = mesh.geometry?.getAttribute('position')?.count ?? 0
    if (count >= 3 && materials.some((material) => material?.visible !== false)) drawn = true
  })
  return drawn
}

export function ifcFileName(projectName: string | undefined, fallback: string): string {
  const base = projectName?.replace(/[\\/:*?"<>|]+/g, '-').trim()
  return `${base || fallback}.ifc`
}

export function exportPreparedSceneToIfc(
  root: THREE.Object3D,
  nodes: Record<string, AnyNode>,
  options: {
    projectName?: string
    onlyVisible?: boolean
    excludedNodeTypes?: readonly string[]
  },
): { data: string; warnings: string[] } {
  const { meshes, renderedNodeIds } = collectIfcMeshes(root, nodes)
  const { ifc, summary } = buildIfcExport({
    nodes,
    meshes,
    projectName: options.projectName,
    // Same default as scene preparation, which already pruned hidden meshes.
    onlyVisible: options.onlyVisible ?? true,
    excludedNodeTypes: options.excludedNodeTypes,
  })
  // Report everything that is on screen yet did not reach the file; markers
  // that draw nothing (spawn point, camera shots) are skipped silently.
  const missing = summary.skipped.filter(
    (skip) => renderedNodeIds.has(skip.nodeId) || drawnInEditor(skip.nodeId, nodes),
  ).length
  const warnings =
    missing > 0
      ? [
          `${missing} ${missing === 1 ? 'object has' : 'objects have'} no exportable geometry and ${missing === 1 ? 'was' : 'were'} left out of the IFC file.`,
        ]
      : []
  return { data: ifc, warnings }
}
