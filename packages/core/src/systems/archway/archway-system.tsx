import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { sceneRegistry } from '../../hooks/scene-registry/scene-registry'
import { baseMaterial } from '../../materials'
import type { AnyNodeId, ArchwayNode } from '../../schema'
import useScene from '../../store/use-scene'

const hitboxMaterial = new THREE.MeshBasicMaterial({ visible: false })

export const ArchwaySystem = () => {
  const dirtyNodes = useScene((state) => state.dirtyNodes)
  const clearDirty = useScene((state) => state.clearDirty)

  useFrame(() => {
    if (dirtyNodes.size === 0) return

    const nodes = useScene.getState().nodes

    dirtyNodes.forEach((id) => {
      const node = nodes[id]
      if (!node || node.type !== 'archway') return

      const mesh = sceneRegistry.nodes.get(id) as THREE.Mesh
      if (!mesh) return

      updateArchwayMesh(node as ArchwayNode, mesh)
      clearDirty(id as AnyNodeId)

      if ((node as ArchwayNode).parentId) {
        useScene.getState().dirtyNodes.add((node as ArchwayNode).parentId as AnyNodeId)
      }
    })
  }, 3)

  return null
}

function createArchShape(width: number, height: number, archHeight: number) {
  const shape = new THREE.Shape()
  const halfW = width / 2
  const halfH = height / 2
  const straightH = height - archHeight
  const baseY = -halfH
  
  // Start bottom left
  shape.moveTo(-halfW, baseY)
  // Bottom right
  shape.lineTo(halfW, baseY)
  // Top right of straight part
  shape.lineTo(halfW, baseY + straightH)
  
  // Curved top (Arch)
  // We use an ellipse arc to support any archHeight
  // absellipse(x, y, xRadius, yRadius, startAngle, endAngle, clockwise, rotation)
  shape.absellipse(0, baseY + straightH, halfW, archHeight, 0, Math.PI, false)
  
  // Top left of straight part is handled by the arc ending there
  shape.lineTo(-halfW, baseY)
  
  return shape
}

function updateArchwayMesh(node: ArchwayNode, mesh: THREE.Mesh) {
  mesh.geometry.dispose()
  // Use a simple box for the selection hitbox (bounding box)
  mesh.geometry = new THREE.BoxGeometry(node.width, node.height, 0.1)
  mesh.material = hitboxMaterial

  mesh.position.set(node.position[0], node.position[1], node.position[2])
  mesh.rotation.set(node.rotation[0], node.rotation[1], node.rotation[2])

  // Clear visual children
  for (const child of [...mesh.children]) {
    if (child.name === 'cutout') continue
    if (child instanceof THREE.Mesh) child.geometry.dispose()
    mesh.remove(child)
  }

  // ── Decorative Trim ──
  if (node.showTrim) {
    const shape = createArchShape(node.width, node.height, node.archHeight)
    
    // Create a "hollow" arch by subtracting a smaller arch from the main one
    const innerShape = createArchShape(
      node.width - node.thickness * 2, 
      node.height - node.thickness, // Bottom doesn't have trim usually
      node.archHeight - node.thickness * 0.5 // Approximate
    )
    // Actually, it's better to use a path and stroke it, or just use ExtrudeGeometry with a hole
    
    // Simpler way for trim: extrude the shape with a hole
    const hole = new THREE.Path()
    const hw = (node.width - node.thickness * 2) / 2
    const ah = Math.max(0.01, node.archHeight - node.thickness)
    const sh = node.height - node.archHeight
    const by = -node.height / 2
    
    hole.moveTo(-hw, by - 0.1) // Slightly lower to ensure it cuts the bottom
    hole.lineTo(hw, by - 0.1)
    hole.lineTo(hw, by + sh)
    hole.absellipse(0, by + sh, hw, ah, 0, Math.PI, false)
    hole.lineTo(-hw, by - 0.1)
    
    shape.holes.push(hole)
    
    const trimGeo = new THREE.ExtrudeGeometry(shape, {
      depth: node.depth,
      bevelEnabled: false,
    })
    trimGeo.translate(0, 0, -node.depth / 2)
    
    const trimMesh = new THREE.Mesh(trimGeo, baseMaterial)
    mesh.add(trimMesh)
  }

  // ── Cutout (for wall CSG) ──
  let cutout = mesh.getObjectByName('cutout') as THREE.Mesh | undefined
  if (!cutout) {
    cutout = new THREE.Mesh()
    cutout.name = 'cutout'
    mesh.add(cutout)
  }
  
  const cutoutShape = createArchShape(node.width, node.height, node.archHeight)
  cutout.geometry.dispose()
  // Extrude the arch shape to create the cutout volume
  cutout.geometry = new THREE.ExtrudeGeometry(cutoutShape, {
    depth: 1.0, // Thick enough to cut through any wall
    bevelEnabled: false
  })
  // Center the extrusion on the wall
  cutout.geometry.translate(0, 0, -0.5)
  cutout.visible = false
}
