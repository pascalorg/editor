import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { DoubleSide, MeshStandardNodeMaterial } from 'three/webgpu'
import { sceneRegistry } from '../../hooks/scene-registry/scene-registry'
import type { AnyNodeId, WindowNode } from '../../schema'
import useScene from '../../store/use-scene'

const glassMaterial = new MeshStandardNodeMaterial({
  name: 'glass',
  color: 'lightgray',
  roughness: 0.8,
  metalness: 0,
  transparent: true,
  opacity: 0.35,
  side: DoubleSide,
  depthWrite: false,
})

export const WindowSystem = () => {
  const dirtyNodes = useScene((state) => state.dirtyNodes)
  const clearDirty = useScene((state) => state.clearDirty)

  useFrame(() => {
    if (dirtyNodes.size === 0) return

    const nodes = useScene.getState().nodes

    dirtyNodes.forEach((id) => {
      const node = nodes[id]
      if (!node || node.type !== 'window') return

      const mesh = sceneRegistry.nodes.get(id) as THREE.Mesh
      if (!mesh) return // Keep dirty until mesh mounts

      updateWindowMesh(node as WindowNode, mesh)
      clearDirty(id as AnyNodeId)

      // Rebuild the parent wall so its cutout reflects the updated window geometry
      if ((node as WindowNode).parentId) {
        useScene.getState().dirtyNodes.add((node as WindowNode).parentId as AnyNodeId)
      }
    })
  })

  return null
}

function updateWindowMesh(node: WindowNode, mesh: THREE.Mesh) {
  // Replace geometry with a box matching the overall window dimensions
  mesh.geometry.dispose()
  mesh.geometry = new THREE.BoxGeometry(node.width, node.height, node.frameDepth)
  mesh.material = glassMaterial

  // Sync transform from node (React may lag behind the system by a frame during drag)
  mesh.position.set(node.position[0], node.position[1], node.position[2])
  mesh.rotation.set(node.rotation[0], node.rotation[1], node.rotation[2])

  // Update (or create) the named cutout mesh used by wall-system for CSG subtraction
  let cutout = mesh.getObjectByName('cutout') as THREE.Mesh | undefined
  if (!cutout) {
    cutout = new THREE.Mesh()
    cutout.name = 'cutout'
    mesh.add(cutout)
  }
  cutout.geometry.dispose()
  // Extends 1m through the wall so the CSG brush covers full wall thickness
  cutout.geometry = new THREE.BoxGeometry(node.width, node.height, 1.0)
  cutout.visible = false;
}
