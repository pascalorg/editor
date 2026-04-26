import { useFrame } from '@react-three/fiber'
import { useEffect } from 'react'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { sceneRegistry } from '../../hooks/scene-registry/scene-registry'
import { baseMaterial, glassMaterial } from '../../materials'
import type { AnyNodeId, DoorNode } from '../../schema'
import useScene from '../../store/use-scene'
import { getWallThickness } from '../wall/wall-footprint'

const hitboxMaterial = new THREE.MeshBasicMaterial({ visible: false })
const GARAGE_DOOR_MIN_WIDTH = 2.4
const GARAGE_DOOR_MIN_PANEL_SEGMENTS = 4
const OVERHEAD_TRACK_THICKNESS = 0.014
const OVERHEAD_TRACK_FACE_OFFSET = 0.016

type RuntimeDoorOpeningStyle = 'overhead' | 'swing'

type NavigationDoorAnimationState = {
  alternateOpenPosition?: [number, number, number]
  alternateOpenRotation?: [number, number, number]
  closedPosition: [number, number, number]
  closedRotation: [number, number, number]
  localBounds?: {
    max: [number, number, number]
    min: [number, number, number]
  }
  openPosition: [number, number, number]
  openRotation: [number, number, number]
  style: RuntimeDoorOpeningStyle
}

type SingleMaterialMesh = THREE.Mesh<THREE.BufferGeometry, THREE.Material>

type DoorGroupMergeEntry = {
  castShadow: boolean
  geometries: THREE.BufferGeometry[]
  material: THREE.Material
  receiveShadow: boolean
}

export const DoorSystem = () => {
  const dirtyNodes = useScene((state) => state.dirtyNodes)
  const clearDirty = useScene((state) => state.clearDirty)

  useEffect(() => {
    const nodes = useScene.getState().nodes
    for (const [id, node] of Object.entries(nodes)) {
      if (node?.type === 'door') {
        useScene.getState().dirtyNodes.add(id as AnyNodeId)
      }
    }
  }, [])

  useFrame(() => {
    if (dirtyNodes.size === 0) return

    const nodes = useScene.getState().nodes

    dirtyNodes.forEach((id) => {
      const node = nodes[id]
      if (!node || node.type !== 'door') return

      const mesh = sceneRegistry.nodes.get(id) as THREE.Mesh
      if (!mesh) return

      updateDoorMesh(node as DoorNode, mesh)
      clearDirty(id as AnyNodeId)

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
  width: number,
  height: number,
  depth: number,
  x: number,
  y: number,
  z: number,
) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material)
  mesh.position.set(x, y, z)
  parent.add(mesh)
}

function optimizeDoorGroupMeshes(group: THREE.Group) {
  const childMeshes = group.children.filter(
    (child): child is SingleMaterialMesh =>
      child instanceof THREE.Mesh && !Array.isArray(child.material),
  )
  if (childMeshes.length <= 1) {
    return
  }

  const mergedEntries = new Map<string, DoorGroupMergeEntry>()

  for (const mesh of childMeshes) {
    mesh.updateMatrix()
    const material = mesh.material
    const key = `${material.uuid}:${mesh.castShadow ? '1' : '0'}:${mesh.receiveShadow ? '1' : '0'}`
    const entry: DoorGroupMergeEntry = mergedEntries.get(key) ?? {
      castShadow: mesh.castShadow,
      geometries: [],
      material,
      receiveShadow: mesh.receiveShadow,
    }
    const geometry = mesh.geometry.clone()
    geometry.applyMatrix4(mesh.matrix)
    entry.geometries.push(geometry)
    mergedEntries.set(key, entry)
  }

  for (const mesh of childMeshes) {
    mesh.geometry.dispose()
  }
  group.clear()

  for (const entry of mergedEntries.values()) {
    const mergedGeometry =
      entry.geometries.length === 1
        ? entry.geometries[0]
        : (mergeGeometries(entry.geometries, false) ?? entry.geometries[0])
    if (!mergedGeometry) {
      continue
    }

    const mergedMesh = new THREE.Mesh(mergedGeometry, entry.material)
    mergedMesh.castShadow = entry.castShadow
    mergedMesh.receiveShadow = entry.receiveShadow
    group.add(mergedMesh)
  }
}

function ensureGroup(parent: THREE.Object3D, name: string) {
  const existingGroup = parent.getObjectByName(name)
  if (existingGroup instanceof THREE.Group) {
    return existingGroup
  }

  const group = new THREE.Group()
  group.name = name
  parent.add(group)
  return group
}

function getObjectBoundsInParentSpace(object: THREE.Object3D, parent: THREE.Object3D) {
  object.updateWorldMatrix(true, true)
  parent.updateWorldMatrix(true, true)

  const inverseParentMatrix = new THREE.Matrix4().copy(parent.matrixWorld).invert()
  const bounds = new THREE.Box3()
  let initialized = false

  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) {
      return
    }

    child.geometry.computeBoundingBox()
    const childBounds = child.geometry.boundingBox?.clone()
    if (!childBounds) {
      return
    }

    const childMatrixInParentSpace = new THREE.Matrix4().multiplyMatrices(
      inverseParentMatrix,
      child.matrixWorld,
    )
    childBounds.applyMatrix4(childMatrixInParentSpace)

    if (initialized) {
      bounds.union(childBounds)
    } else {
      bounds.copy(childBounds)
      initialized = true
    }
  })

  return initialized ? bounds : null
}

function getDoorLeafOpenAngle(node: Pick<DoorNode, 'hingesSide' | 'swingDirection'>) {
  const direction = node.swingDirection === 'inward' ? 1 : -1

  return direction * THREE.MathUtils.degToRad(170)
}

function getRuntimeDoorOpeningStyle(node: DoorNode): RuntimeDoorOpeningStyle {
  if (node.openingStyle) {
    return node.openingStyle
  }

  const hasOnlyPanelSegments = (node.segments ?? []).every((segment) => segment.type === 'panel')
  if (
    node.width >= GARAGE_DOOR_MIN_WIDTH &&
    (node.segments?.length ?? 0) >= GARAGE_DOOR_MIN_PANEL_SEGMENTS &&
    hasOnlyPanelSegments
  ) {
    return 'overhead'
  }

  return 'swing'
}

function buildNavigationDoorAnimationState(
  node: DoorNode,
  openingStyle: RuntimeDoorOpeningStyle,
  hingeX: number,
  leafDepth: number,
  leafH: number,
  leafTopY: number,
  frameDepth: number,
  wallDepth: number,
): NavigationDoorAnimationState {
  if (openingStyle === 'swing') {
    const openAngle = getDoorLeafOpenAngle(node)
    return {
      alternateOpenPosition: [hingeX, 0, 0],
      alternateOpenRotation: [0, -openAngle, 0],
      closedPosition: [hingeX, 0, 0],
      closedRotation: [0, 0, 0],
      openPosition: [hingeX, 0, 0],
      openRotation: [0, openAngle, 0],
      style: 'swing',
    }
  }

  const travelDirection = node.swingDirection === 'inward' ? -1 : 1
  const wallHalfDepth = wallDepth / 2
  const closedDepthOffset = travelDirection * Math.max(0, wallHalfDepth - leafDepth / 2 - 0.008)
  const trackInset =
    travelDirection * (wallHalfDepth + OVERHEAD_TRACK_THICKNESS / 2 + OVERHEAD_TRACK_FACE_OFFSET)
  const openDepthOffset = trackInset + travelDirection * leafH

  return {
    closedPosition: [0, leafTopY, closedDepthOffset],
    closedRotation: [0, 0, 0],
    openPosition: [0, leafTopY, openDepthOffset],
    openRotation: [travelDirection > 0 ? Math.PI / 2 : -Math.PI / 2, 0, 0],
    style: 'overhead',
  }
}

function updateDoorMesh(node: DoorNode, mesh: THREE.Mesh) {
  mesh.geometry.dispose()
  mesh.geometry = new THREE.BoxGeometry(node.width, node.height, node.frameDepth)
  mesh.material = hitboxMaterial

  mesh.position.set(node.position[0], node.position[1], node.position[2])
  mesh.rotation.set(node.rotation[0], node.rotation[1], node.rotation[2])

  for (const child of [...mesh.children]) {
    if (child.name === 'cutout') continue
    if (child instanceof THREE.Mesh) child.geometry.dispose()
    mesh.remove(child)
  }

  const {
    width,
    height,
    frameThickness,
    frameDepth,
    threshold,
    thresholdHeight,
    segments,
    handle,
    handleHeight,
    handleSide,
    doorCloser,
    panicBar,
    panicBarHeight,
    contentPadding,
    hingesSide,
  } = node
  const parentNode = node.parentId ? useScene.getState().nodes[node.parentId as AnyNodeId] : null
  const wallDepth = parentNode?.type === 'wall' ? getWallThickness(parentNode) : frameDepth

  const openingStyle = getRuntimeDoorOpeningStyle(node)
  const leafW = width - 2 * frameThickness
  const leafH = height - frameThickness
  const leafDepth = 0.04
  const leafCenterY = -frameThickness / 2
  const leafBottomY = leafCenterY - leafH / 2
  const leafTopY = leafCenterY + leafH / 2
  const hingeX = hingesSide === 'right' ? leafW / 2 - 0.012 : -leafW / 2 + 0.012
  const frameGroup = ensureGroup(mesh, 'door-frame-group')
  const leafPivot = ensureGroup(mesh, 'door-leaf-pivot')
  const leafGroup = ensureGroup(leafPivot, 'door-leaf-group')
  const navigationDoorAnimation = buildNavigationDoorAnimationState(
    node,
    openingStyle,
    hingeX,
    leafDepth,
    leafH,
    leafTopY,
    frameDepth,
    wallDepth,
  )

  frameGroup.clear()
  leafGroup.clear()
  leafPivot.position.set(...navigationDoorAnimation.closedPosition)
  leafPivot.rotation.set(...navigationDoorAnimation.closedRotation)
  leafPivot.userData.navigationDoor = navigationDoorAnimation
  leafGroup.position.set(
    ...(openingStyle === 'overhead'
      ? ([0, -leafH / 2, 0] as [number, number, number])
      : ([-hingeX, 0, 0] as [number, number, number])),
  )
  leafGroup.rotation.set(0, 0, 0)

  addBox(
    frameGroup,
    baseMaterial,
    frameThickness,
    height,
    frameDepth,
    -width / 2 + frameThickness / 2,
    0,
    0,
  )
  addBox(
    frameGroup,
    baseMaterial,
    frameThickness,
    height,
    frameDepth,
    width / 2 - frameThickness / 2,
    0,
    0,
  )
  addBox(
    frameGroup,
    baseMaterial,
    width,
    frameThickness,
    frameDepth,
    0,
    height / 2 - frameThickness / 2,
    0,
  )

  if (threshold) {
    addBox(
      frameGroup,
      baseMaterial,
      leafW,
      thresholdHeight,
      frameDepth,
      0,
      -height / 2 + thresholdHeight / 2,
      0,
    )
  }

  const cpX = contentPadding[0]
  const cpY = contentPadding[1]
  if (cpY > 0) {
    addBox(leafGroup, baseMaterial, leafW, cpY, leafDepth, 0, leafCenterY + leafH / 2 - cpY / 2, 0)
    addBox(leafGroup, baseMaterial, leafW, cpY, leafDepth, 0, leafCenterY - leafH / 2 + cpY / 2, 0)
  }
  if (cpX > 0) {
    const innerH = leafH - 2 * cpY
    addBox(leafGroup, baseMaterial, cpX, innerH, leafDepth, -leafW / 2 + cpX / 2, leafCenterY, 0)
    addBox(leafGroup, baseMaterial, cpX, innerH, leafDepth, leafW / 2 - cpX / 2, leafCenterY, 0)
  }

  const contentW = leafW - 2 * cpX
  const contentH = leafH - 2 * cpY
  const totalRatio = segments.reduce((sum, segment) => sum + segment.heightRatio, 0)
  const contentTop = leafCenterY + contentH / 2

  let segY = contentTop
  for (const segment of segments) {
    const segH = (segment.heightRatio / totalRatio) * contentH
    const segCenterY = segY - segH / 2
    const numCols = segment.columnRatios.length
    const colSum = segment.columnRatios.reduce((sum, ratio) => sum + ratio, 0)
    const usableW = contentW - (numCols - 1) * segment.dividerThickness
    const colWidths = segment.columnRatios.map((ratio) => (ratio / colSum) * usableW)

    const colXCenters: number[] = []
    let cursorX = -contentW / 2
    for (let colIndex = 0; colIndex < numCols; colIndex += 1) {
      colXCenters.push(cursorX + colWidths[colIndex]! / 2)
      cursorX += colWidths[colIndex]!
      if (colIndex < numCols - 1) cursorX += segment.dividerThickness
    }

    cursorX = -contentW / 2
    for (let colIndex = 0; colIndex < numCols - 1; colIndex += 1) {
      cursorX += colWidths[colIndex]!
      addBox(
        leafGroup,
        baseMaterial,
        segment.dividerThickness,
        segH,
        leafDepth + 0.001,
        cursorX + segment.dividerThickness / 2,
        segCenterY,
        0,
      )
      cursorX += segment.dividerThickness
    }

    for (let colIndex = 0; colIndex < numCols; colIndex += 1) {
      const colW = colWidths[colIndex]!
      const colX = colXCenters[colIndex]!

      if (segment.type === 'glass') {
        const glassDepth = Math.max(0.004, leafDepth * 0.15)
        addBox(leafGroup, glassMaterial, colW, segH, glassDepth, colX, segCenterY, 0)
      } else if (segment.type === 'panel') {
        addBox(leafGroup, baseMaterial, colW, segH, leafDepth, colX, segCenterY, 0)
        const panelW = colW - 2 * segment.panelInset
        const panelH = segH - 2 * segment.panelInset
        if (panelW > 0.01 && panelH > 0.01) {
          const effectiveDepth =
            Math.abs(segment.panelDepth) < 0.002 ? 0.005 : Math.abs(segment.panelDepth)
          const panelZ = leafDepth / 2 + effectiveDepth / 2
          addBox(leafGroup, baseMaterial, panelW, panelH, effectiveDepth, colX, segCenterY, panelZ)
        }
      } else {
        addBox(leafGroup, baseMaterial, colW, segH, leafDepth, colX, segCenterY, 0)
      }
    }

    segY -= segH
  }

  if (handle) {
    const handleY = handleHeight - height / 2
    const faceZ = leafDepth / 2
    const handleX =
      openingStyle === 'overhead'
        ? 0
        : handleSide === 'right'
          ? leafW / 2 - 0.045
          : -leafW / 2 + 0.045

    addBox(leafGroup, baseMaterial, 0.028, 0.14, 0.01, handleX, handleY, faceZ + 0.005)
    addBox(leafGroup, baseMaterial, 0.022, 0.1, 0.035, handleX, handleY, faceZ + 0.025)
  }

  if (openingStyle === 'swing' && doorCloser) {
    const closerY = leafCenterY + leafH / 2 - 0.04
    addBox(leafGroup, baseMaterial, 0.28, 0.055, 0.055, 0, closerY, leafDepth / 2 + 0.03)
    addBox(
      leafGroup,
      baseMaterial,
      0.14,
      0.015,
      0.015,
      leafW / 4,
      closerY + 0.025,
      leafDepth / 2 + 0.015,
    )
  }

  if (openingStyle === 'swing' && panicBar) {
    const barY = panicBarHeight - height / 2
    addBox(leafGroup, baseMaterial, leafW * 0.72, 0.04, 0.055, 0, barY, leafDepth / 2 + 0.03)
  }

  if (openingStyle === 'swing') {
    const hingeZ = 0
    const hingeH = 0.1
    const hingeW = 0.024
    const hingeD = leafDepth + 0.016
    addBox(frameGroup, baseMaterial, hingeW, hingeH, hingeD, hingeX, leafBottomY + 0.25, hingeZ)
    addBox(
      frameGroup,
      baseMaterial,
      hingeW,
      hingeH,
      hingeD,
      hingeX,
      (leafBottomY + leafTopY) / 2,
      hingeZ,
    )
    addBox(frameGroup, baseMaterial, hingeW, hingeH, hingeD, hingeX, leafTopY - 0.25, hingeZ)
  }

  optimizeDoorGroupMeshes(frameGroup)
  optimizeDoorGroupMeshes(leafGroup)

  const leafBounds = getObjectBoundsInParentSpace(leafGroup, leafPivot)
  if (leafBounds) {
    navigationDoorAnimation.localBounds = {
      max: [leafBounds.max.x, leafBounds.max.y, leafBounds.max.z],
      min: [leafBounds.min.x, leafBounds.min.y, leafBounds.min.z],
    }
  }

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
