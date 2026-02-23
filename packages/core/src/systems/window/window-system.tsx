import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { DoubleSide, MeshStandardNodeMaterial } from 'three/webgpu'
import { sceneRegistry } from '../../hooks/scene-registry/scene-registry'
import type { AnyNodeId, WindowNode } from '../../schema'
import useScene from '../../store/use-scene'

const glassMaterial = new MeshStandardNodeMaterial({
  name: 'glass',
  color: 'lightblue',
  roughness: 0.05,
  metalness: 0.1,
  transparent: true,
  opacity: 0.3,
  side: DoubleSide,
  depthWrite: false,
})

const frameMaterial = new MeshStandardNodeMaterial({
  name: 'window-frame',
  color: '#e8e8e8',
  roughness: 0.6,
  metalness: 0,
})

// Invisible material for root mesh — used as selection hitbox only
const hitboxMaterial = new THREE.MeshBasicMaterial({ visible: false })

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

function updateWindowMesh(node: WindowNode, mesh: THREE.Mesh) {
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
    width, height, frameDepth, frameThickness,
    columnRatios, rowRatios, columnDividerThickness, rowDividerThickness,
    sill, sillDepth, sillThickness,
  } = node

  const innerW = width - 2 * frameThickness
  const innerH = height - 2 * frameThickness

  // ── Frame members ──
  // Top / bottom — full width
  addBox(mesh, frameMaterial, width, frameThickness, frameDepth, 0,  height / 2 - frameThickness / 2, 0)
  addBox(mesh, frameMaterial, width, frameThickness, frameDepth, 0, -height / 2 + frameThickness / 2, 0)
  // Left / right — inner height to avoid corner overlap
  addBox(mesh, frameMaterial, frameThickness, innerH, frameDepth, -width / 2 + frameThickness / 2, 0, 0)
  addBox(mesh, frameMaterial, frameThickness, innerH, frameDepth,  width / 2 - frameThickness / 2, 0, 0)

  // ── Pane grid ──
  const numCols = columnRatios.length
  const numRows = rowRatios.length

  const usableW = innerW - (numCols - 1) * columnDividerThickness
  const usableH = innerH - (numRows - 1) * rowDividerThickness

  const colSum = columnRatios.reduce((a, b) => a + b, 0)
  const rowSum = rowRatios.reduce((a, b) => a + b, 0)
  const colWidths  = columnRatios.map(r => (r / colSum) * usableW)
  const rowHeights = rowRatios.map(r => (r / rowSum) * usableH)

  // Compute column x-centers starting from left edge of inner area
  const colXCenters: number[] = []
  let cx = -innerW / 2
  for (let c = 0; c < numCols; c++) {
    colXCenters.push(cx + colWidths[c]! / 2)
    cx += colWidths[c]!
    if (c < numCols - 1) cx += columnDividerThickness
  }

  // Compute row y-centers starting from top edge of inner area (R1 = top)
  const rowYCenters: number[] = []
  let cy = innerH / 2
  for (let r = 0; r < numRows; r++) {
    rowYCenters.push(cy - rowHeights[r]! / 2)
    cy -= rowHeights[r]!
    if (r < numRows - 1) cy -= rowDividerThickness
  }

  // Column dividers — full inner height
  cx = -innerW / 2
  for (let c = 0; c < numCols - 1; c++) {
    cx += colWidths[c]!
    addBox(mesh, frameMaterial, columnDividerThickness, innerH, frameDepth, cx + columnDividerThickness / 2, 0, 0)
    cx += columnDividerThickness
  }

  // Row dividers — per column width, so they don't overlap column dividers (top to bottom)
  cy = innerH / 2
  for (let r = 0; r < numRows - 1; r++) {
    cy -= rowHeights[r]!
    const divY = cy - rowDividerThickness / 2
    for (let c = 0; c < numCols; c++) {
      addBox(mesh, frameMaterial, colWidths[c]!, rowDividerThickness, frameDepth, colXCenters[c]!, divY, 0)
    }
    cy -= rowDividerThickness
  }

  // Glass panes
  const glassDepth = Math.max(0.004, frameDepth * 0.08)
  for (let c = 0; c < numCols; c++) {
    for (let r = 0; r < numRows; r++) {
      addBox(mesh, glassMaterial, colWidths[c]!, rowHeights[r]!, glassDepth, colXCenters[c]!, rowYCenters[r]!, 0)
    }
  }

  // ── Sill ──
  if (sill) {
    const sillW = width + sillDepth * 0.4 // slightly wider than frame
    // Protrudes from the front face of the frame (+Z)
    const sillZ = frameDepth / 2 + sillDepth / 2
    addBox(mesh, frameMaterial, sillW, sillThickness, sillDepth, 0, -height / 2 - sillThickness / 2, sillZ)
  }

  // ── Cutout (for wall CSG) — always full window dimensions, 1m deep ──
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
