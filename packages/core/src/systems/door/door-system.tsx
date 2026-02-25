import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { DoubleSide, MeshStandardNodeMaterial } from 'three/webgpu'
import { sceneRegistry } from '../../hooks/scene-registry/scene-registry'
import type { AnyNodeId, DoorNode } from '../../schema'
import useScene from '../../store/use-scene'

const frameMaterial = new MeshStandardNodeMaterial({
  name: 'door-frame',
  color: '#e8e8e8',
  roughness: 0.6,
  metalness: 0,
})

const leafMaterial = new MeshStandardNodeMaterial({
  name: 'door-leaf',
  color: '#d0c8b8',
  roughness: 0.5,
  metalness: 0,
})

const panelMaterial = new MeshStandardNodeMaterial({
  name: 'door-panel',
  color: '#c5bdb0',
  roughness: 0.5,
  metalness: 0,
})

const glassMaterial = new MeshStandardNodeMaterial({
  name: 'door-glass',
  color: 'lightblue',
  roughness: 0.05,
  metalness: 0.1,
  transparent: true,
  opacity: 0.35,
  side: DoubleSide,
  depthWrite: false,
})

const thresholdMaterial = new MeshStandardNodeMaterial({
  name: 'door-threshold',
  color: '#999',
  roughness: 0.4,
  metalness: 0.5,
})

const handleMaterial = new MeshStandardNodeMaterial({
  name: 'door-handle',
  color: '#bbb',
  roughness: 0.2,
  metalness: 0.8,
})

const closerMaterial = new MeshStandardNodeMaterial({
  name: 'door-closer',
  color: '#333',
  roughness: 0.4,
  metalness: 0.3,
})

// Invisible material for root mesh — used as selection hitbox only
const hitboxMaterial = new THREE.MeshBasicMaterial({ visible: false })

export const DoorSystem = () => {
  const dirtyNodes = useScene((state) => state.dirtyNodes)
  const clearDirty = useScene((state) => state.clearDirty)

  useFrame(() => {
    if (dirtyNodes.size === 0) return

    const nodes = useScene.getState().nodes

    dirtyNodes.forEach((id) => {
      const node = nodes[id]
      if (!node || node.type !== 'door') return

      const mesh = sceneRegistry.nodes.get(id) as THREE.Mesh
      if (!mesh) return // Keep dirty until mesh mounts

      updateDoorMesh(node as DoorNode, mesh)
      clearDirty(id as AnyNodeId)

      // Rebuild the parent wall so its cutout reflects the updated door geometry
      if ((node as DoorNode).parentId) {
        useScene.getState().dirtyNodes.add((node as DoorNode).parentId as AnyNodeId)
      }
    })
  }, 3)

  return null
}

function addBox(
  parent: THREE.Object3D,
  material: THREE.Material,
  w: number, h: number, d: number,
  x: number, y: number, z: number,
) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material)
  m.position.set(x, y, z)
  parent.add(m)
}

function updateDoorMesh(node: DoorNode, mesh: THREE.Mesh) {
  // Root mesh is an invisible hitbox; all visuals live in child meshes
  mesh.geometry.dispose()
  mesh.geometry = new THREE.BoxGeometry(node.width, node.height, node.frameDepth)
  mesh.material = hitboxMaterial

  // Sync transform from node (React may lag behind the system by a frame during drag)
  mesh.position.set(node.position[0], node.position[1], node.position[2])
  mesh.rotation.set(node.rotation[0], node.rotation[1], node.rotation[2])

  // Dispose and remove all old visual children; preserve 'cutout'
  for (const child of [...mesh.children]) {
    if (child.name === 'cutout') continue
    if (child instanceof THREE.Mesh) child.geometry.dispose()
    mesh.remove(child)
  }

  const {
    width, height, frameThickness, frameDepth, threshold, thresholdHeight,
    segments, handle, handleHeight, handleSide,
    doorCloser, panicBar, panicBarHeight,
  } = node

  // Leaf occupies the full opening (no bottom frame bar — door opens to floor)
  const leafW = width - 2 * frameThickness
  const leafH = height - frameThickness  // only top frame
  const leafDepth = 0.04
  // Leaf center is shifted down from door center by half the top frame
  const leafCenterY = -frameThickness / 2

  // ── Frame members ──
  // Left post — full height
  addBox(mesh, frameMaterial, frameThickness, height, frameDepth, -width / 2 + frameThickness / 2, 0, 0)
  // Right post — full height
  addBox(mesh, frameMaterial, frameThickness, height, frameDepth, width / 2 - frameThickness / 2, 0, 0)
  // Head (top bar) — full width
  addBox(mesh, frameMaterial, width, frameThickness, frameDepth, 0, height / 2 - frameThickness / 2, 0)

  // ── Threshold ──
  if (threshold) {
    addBox(mesh, thresholdMaterial, width, thresholdHeight, frameDepth, 0, -height / 2 + thresholdHeight / 2, 0)
  }

  // ── Door leaf — full backing ──
  addBox(mesh, leafMaterial, leafW, leafH, leafDepth, 0, leafCenterY, 0)

  // ── Segments (stacked top to bottom within leaf area) ──
  const totalRatio = segments.reduce((sum, s) => sum + s.heightRatio, 0)
  const leafTop = leafCenterY + leafH / 2

  let segY = leafTop
  for (const seg of segments) {
    const segH = (seg.heightRatio / totalRatio) * leafH
    const segCenterY = segY - segH / 2

    const numCols = seg.columnRatios.length
    const colSum = seg.columnRatios.reduce((a, b) => a + b, 0)
    const usableW = leafW - (numCols - 1) * seg.dividerThickness
    const colWidths = seg.columnRatios.map(r => (r / colSum) * usableW)

    // Column x-centers
    const colXCenters: number[] = []
    let cx = -leafW / 2
    for (let c = 0; c < numCols; c++) {
      colXCenters.push(cx + colWidths[c]! / 2)
      cx += colWidths[c]!
      if (c < numCols - 1) cx += seg.dividerThickness
    }

    // Column dividers within this segment
    cx = -leafW / 2
    for (let c = 0; c < numCols - 1; c++) {
      cx += colWidths[c]!
      addBox(mesh, leafMaterial, seg.dividerThickness, segH, leafDepth + 0.001, cx + seg.dividerThickness / 2, segCenterY, 0)
      cx += seg.dividerThickness
    }

    // Segment content per column
    for (let c = 0; c < numCols; c++) {
      const colW = colWidths[c]!
      const colX = colXCenters[c]!

      if (seg.type === 'glass') {
        const glassDepth = Math.max(0.004, leafDepth * 0.15)
        addBox(mesh, glassMaterial, colW, segH, glassDepth, colX, segCenterY, 0)
      } else if (seg.type === 'panel') {
        const panelW = colW - 2 * seg.panelInset
        const panelH = segH - 2 * seg.panelInset
        if (panelW > 0.01 && panelH > 0.01) {
          const effectiveDepth = Math.abs(seg.panelDepth) < 0.002 ? 0.005 : Math.abs(seg.panelDepth)
          const panelZ = leafDepth / 2 + effectiveDepth / 2
          addBox(mesh, panelMaterial, panelW, panelH, effectiveDepth, colX, segCenterY, panelZ)
        }
      }
      // 'empty' → leaf backing is already there, nothing extra
    }

    segY -= segH
  }

  // ── Handle ──
  if (handle) {
    // Convert from floor-based height to mesh-center-based Y
    const handleY = handleHeight - height / 2
    // Handle grip sits on the front face (+Z) of the leaf
    const faceZ = leafDepth / 2

    // X position: handleSide refers to which side the grip is on
    const handleX = handleSide === 'right'
      ? leafW / 2 - 0.045
      : -leafW / 2 + 0.045

    // Backplate
    addBox(mesh, handleMaterial, 0.028, 0.14, 0.01, handleX, handleY, faceZ + 0.005)
    // Grip lever
    addBox(mesh, handleMaterial, 0.022, 0.1, 0.035, handleX, handleY, faceZ + 0.025)
  }

  // ── Door closer (commercial hardware at top) ──
  if (doorCloser) {
    const closerY = leafCenterY + leafH / 2 - 0.04
    // Body
    addBox(mesh, closerMaterial, 0.28, 0.055, 0.055, 0, closerY, leafDepth / 2 + 0.03)
    // Arm (simplified as thin bar to frame side)
    addBox(mesh, closerMaterial, 0.14, 0.015, 0.015, leafW / 4, closerY + 0.025, leafDepth / 2 + 0.015)
  }

  // ── Panic bar ──
  if (panicBar) {
    const barY = panicBarHeight - height / 2
    addBox(mesh, handleMaterial, leafW * 0.72, 0.04, 0.055, 0, barY, leafDepth / 2 + 0.03)
  }

  // ── Cutout (for wall CSG) — always full door dimensions, 1m deep ──
  let cutout = mesh.getObjectByName('cutout') as THREE.Mesh | undefined
  if (!cutout) {
    cutout = new THREE.Mesh()
    cutout.name = 'cutout'
    mesh.add(cutout)
  }
  cutout.geometry.dispose()
  cutout.geometry = new THREE.BoxGeometry(node.width, node.height, 1.0)
  cutout.visible = false
}
