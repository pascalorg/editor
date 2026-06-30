import {
  type AnyNodeId,
  clampDoorOperationState,
  DEFAULT_WALL_THICKNESS,
  type DoorNode,
  DoorNode as DoorNodeSchema,
  getDoorRenderOpenAmount,
  getEffectiveNode,
  getWallThickness,
  type SceneMaterial,
  type SceneMaterialId,
  sceneRegistry,
  useInteractive,
  useLiveNodeOverrides,
  useScene,
  type WallNode,
} from '@pascal-app/core'
import { useFrame } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { applyWorldScaleBoxUVs } from '../../lib/box-uv'
import {
  type ColorPreset,
  createDefaultMaterial,
  createSurfaceRoleMaterial,
  glassMaterial as defaultGlassMaterial,
  baseMaterial as getBaseMaterial,
  type RenderShading,
  resolveMaterialRef,
} from '../../lib/materials'
import useViewer from '../../store/use-viewer'
import { getOpeningCutoutProxyDepth } from '../wall/opening-cutout-geometry'

// Invisible material for root mesh — used as selection hitbox only
const hitboxMaterial = new THREE.MeshBasicMaterial({ visible: false })
const defaultRevealMaterial = new THREE.MeshBasicMaterial({ color: '#7f766c' })
// Door hardware (handle / hinges / closer / panic bar) renders a catalog metal
// finish by default (chrome), separate from the door body. The flat material is
// only a fallback if the catalog ref ever fails to resolve.
const HARDWARE_DEFAULT_REF = 'library:metal-chrome'
// Door body defaults to a catalog colour (generic approach). Glass keeps the
// built-in FrontSide glass material — the catalog `preset-glass` is DoubleSide,
// which poisons the WebGPU MRT scene pass.
const PANEL_DEFAULT_REF = 'library:preset-softwhite'
const FRAME_DEFAULT_REF = 'library:preset-softwhite'
const GLASS_DEFAULT_REF = 'library:preset-glass'
const defaultHardwareMaterial = createDefaultMaterial('#3a3a3a', 0.4)
let baseMaterial = getBaseMaterial()
let frameMaterial: THREE.Material = getBaseMaterial()
let revealMaterial: THREE.Material = defaultRevealMaterial
let glassMaterial: THREE.Material = defaultGlassMaterial
let hardwareMaterial: THREE.Material = defaultHardwareMaterial
let currentDoorSlot: string | undefined
// Per-frame viewer state, captured so the per-node mesh builder (which runs
// outside React) can resolve each door's slot materials.
let currentShading: RenderShading = 'rendered'
let currentTextures = true
let currentColorPreset: ColorPreset = 'clay'
let currentSceneMaterials: Record<SceneMaterialId, SceneMaterial> | undefined

const DOOR_RENDER_DEFAULTS = DoorNodeSchema.parse({ id: 'door_render_default' })
const MAX_DOOR_REBUILDS_PER_FRAME = 16
const DOOR_PROGRESSIVE_DIRTY_THRESHOLD = MAX_DOOR_REBUILDS_PER_FRAME
const DOOR_PROGRESSIVE_TIME_BUDGET_MS = 8

// Legacy/unparsed door nodes can miss schema-defaulted fields (segments,
// columnRatios, dividerThickness, …) and crash the geometry build. Re-apply the
// Zod defaults; if the node is structurally invalid (e.g. a segment missing a
// required field) drop the bad segments, then fall back to defaults entirely.
function normalizeDoorNodeForRender(node: DoorNode): DoorNode {
  const parsed = DoorNodeSchema.safeParse(node)
  if (parsed.success) return parsed.data
  const retry = DoorNodeSchema.safeParse({ ...node, segments: undefined })
  if (retry.success) return retry.data
  return { ...DOOR_RENDER_DEFAULTS, id: node.id, parentId: node.parentId }
}

export const DoorSystem = () => {
  const dirtyNodes = useScene((state) => state.dirtyNodes)
  const clearDirty = useScene((state) => state.clearDirty)
  const shading = useViewer((state) => state.shading)
  const textures = useViewer((state) => state.textures)
  const colorPreset = useViewer((state) => state.colorPreset)
  const sceneMaterials = useScene((state) => state.materials)
  const materialRevisionRef = useRef<string | null>(null)
  // Subscribe so an override-only update (no scene write) still re-runs
  // the component, letting the gate below pick up the latest dirtyNodes
  // set from the same render pass that received the override-publishing
  // `markDirty` call. Mirrors WallSystem.
  useLiveNodeOverrides((s) => s.overrides)

  const joineryMaterial = createSurfaceRoleMaterial('joinery', colorPreset)
  baseMaterial = textures ? getBaseMaterial(shading) : joineryMaterial
  frameMaterial = textures ? getBaseMaterial(shading) : joineryMaterial
  revealMaterial = textures ? defaultRevealMaterial : joineryMaterial
  glassMaterial = textures ? defaultGlassMaterial : joineryMaterial
  hardwareMaterial = textures ? defaultHardwareMaterial : joineryMaterial

  useEffect(() => {
    const materialRevision = `${shading}:${textures ? 'textures' : 'solid'}:${colorPreset}`
    if (materialRevisionRef.current === materialRevision) return
    materialRevisionRef.current = materialRevision

    const nodes = useScene.getState().nodes
    for (const node of Object.values(nodes)) {
      if (node?.type === 'door') {
        useScene.getState().dirtyNodes.add(node.id as AnyNodeId)
      }
    }
  })

  // Editing a scene material a door slot references must rebuild that door
  // (door meshes are built by this system, not <GeometrySystem>).
  useEffect(() => {
    void sceneMaterials
    const nodes = useScene.getState().nodes
    for (const node of Object.values(nodes)) {
      if (node?.type !== 'door') continue
      if (!nodeReferencesSceneMaterial(node)) continue
      useScene.getState().dirtyNodes.add(node.id as AnyNodeId)
    }
  }, [sceneMaterials])

  useFrame(() => {
    if (dirtyNodes.size === 0) return
    const frameJoineryMaterial = createSurfaceRoleMaterial('joinery', colorPreset)
    baseMaterial = textures ? getBaseMaterial(shading) : frameJoineryMaterial
    frameMaterial = textures ? getBaseMaterial(shading) : frameJoineryMaterial
    revealMaterial = textures ? defaultRevealMaterial : frameJoineryMaterial
    glassMaterial = textures ? defaultGlassMaterial : frameJoineryMaterial
    hardwareMaterial = textures ? defaultHardwareMaterial : frameJoineryMaterial
    currentShading = shading
    currentTextures = textures
    currentColorPreset = colorPreset
    currentSceneMaterials = sceneMaterials

    const nodes = useScene.getState().nodes
    const dirtyDoorIds: AnyNodeId[] = []

    dirtyNodes.forEach((id) => {
      const node = nodes[id]
      if (node?.type !== 'door') return
      dirtyDoorIds.push(id as AnyNodeId)
    })

    const useProgressiveDoorRebuilds = dirtyDoorIds.length > DOOR_PROGRESSIVE_DIRTY_THRESHOLD
    const frameStartedAt = performance.now()
    let rebuiltDoorsThisFrame = 0

    for (const id of dirtyDoorIds) {
      if (useProgressiveDoorRebuilds) {
        if (rebuiltDoorsThisFrame >= MAX_DOOR_REBUILDS_PER_FRAME) {
          break
        }
        if (
          rebuiltDoorsThisFrame > 0 &&
          performance.now() - frameStartedAt >= DOOR_PROGRESSIVE_TIME_BUDGET_MS
        ) {
          break
        }
      }

      const node = nodes[id]
      if (node?.type !== 'door') continue
      const mesh = sceneRegistry.nodes.get(id) as THREE.Mesh
      if (!mesh) continue // Keep dirty until mesh mounts

      // Merge any live override (width / height / position) so the mesh
      // rebuild reflects the in-flight drag without zustand churn. When
      // no override is set this returns the scene node unchanged.
      const effectiveNode = getEffectiveNode(node as DoorNode)
      updateDoorMesh(effectiveNode, mesh)
      clearDirty(id as AnyNodeId)
      rebuiltDoorsThisFrame += 1

      // Rebuild the parent wall so its cutout reflects the updated door geometry
      // Avoid triggering expensive wall CSG rebuilds while the door is being interactively moved/duplicated.
      // The editor tools will request a final wall rebuild on commit.
      const isTransient = !!(node.metadata as Record<string, unknown> | null)?.isTransient
      if (!isTransient && effectiveNode.parentId) {
        useScene.getState().dirtyNodes.add(effectiveNode.parentId as AnyNodeId)
      }
    }
  }, 3)

  return null
}

function tagDoorSlot(mesh: THREE.Mesh): THREE.Mesh {
  mesh.userData.slotId = currentDoorSlot
  return mesh
}

const NO_RAYCAST = () => {}

// An open door leaf swings perpendicular to the wall, so in a top-down view its
// flat panel blankets the room interior and wins the selection raycast over the
// slab/items beneath it. Drop the swung leaf out of the raycast so a click on
// the floor falls through to what's underneath; the door stays selectable via
// its proud invisible cutout proxy at the opening (see syncDoorCutout).
function disableSubtreeRaycast(object: THREE.Object3D) {
  object.traverse((child) => {
    ;(child as unknown as { raycast: () => void }).raycast = NO_RAYCAST
  })
}

function nodeReferencesSceneMaterial(node: { slots?: Record<string, string> }): boolean {
  const slots = node.slots
  if (!slots) return false
  for (const ref of Object.values(slots)) {
    if (typeof ref === 'string' && ref.startsWith('scene:')) return true
  }
  return false
}

type DoorMaterialSlotId = 'panel' | 'frame' | 'glass' | 'hardware'

function doorSlotDefault(slotId: DoorMaterialSlotId): THREE.Material {
  if (!currentTextures) return createSurfaceRoleMaterial('joinery', currentColorPreset)
  if (slotId === 'glass') {
    return (
      resolveMaterialRef(GLASS_DEFAULT_REF, currentSceneMaterials, currentShading) ??
      defaultGlassMaterial
    )
  }
  if (slotId === 'hardware') {
    return (
      resolveMaterialRef(HARDWARE_DEFAULT_REF, currentSceneMaterials, currentShading) ??
      defaultHardwareMaterial
    )
  }
  if (slotId === 'frame') {
    return (
      resolveMaterialRef(FRAME_DEFAULT_REF, currentSceneMaterials, currentShading) ??
      getBaseMaterial(currentShading)
    )
  }
  return (
    resolveMaterialRef(PANEL_DEFAULT_REF, currentSceneMaterials, currentShading) ??
    getBaseMaterial(currentShading)
  )
}

// Resolve a door's slot to a material: the `node.slots` override (colored mode
// only) → the body/glass/hardware default. Textures-off ignores overrides — the
// monochrome escape hatch.
function resolveDoorSlotMaterial(node: DoorNode, slotId: DoorMaterialSlotId): THREE.Material {
  const fallback = doorSlotDefault(slotId)
  if (!currentTextures) return fallback
  const ref = node.slots?.[slotId]
  if (!ref) return fallback
  return resolveMaterialRef(ref, currentSceneMaterials, currentShading) ?? fallback
}

function addBox(
  parent: THREE.Object3D,
  material: THREE.Material,
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
) {
  const geometry = new THREE.BoxGeometry(w, h, d)
  applyWorldScaleBoxUVs(geometry, w, h, d)
  const m = new THREE.Mesh(geometry, material)
  m.position.set(x, y, z)
  tagDoorSlot(m)
  parent.add(m)
}

function addRotatedBox(
  parent: THREE.Object3D,
  material: THREE.Material,
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
  rotationY: number,
) {
  const geometry = new THREE.BoxGeometry(w, h, d)
  applyWorldScaleBoxUVs(geometry, w, h, d)
  const m = new THREE.Mesh(geometry, material)
  m.position.set(x, y, z)
  m.rotation.y = rotationY
  tagDoorSlot(m)
  parent.add(m)
}

function addShape(
  parent: THREE.Object3D,
  material: THREE.Material,
  shape: THREE.Shape,
  depth: number,
) {
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: false,
    curveSegments: 24,
  })
  geometry.translate(0, 0, -depth / 2)
  const mesh = new THREE.Mesh(geometry, material)
  tagDoorSlot(mesh)
  parent.add(mesh)
}

function addShapeAt(
  parent: THREE.Object3D,
  material: THREE.Material,
  shape: THREE.Shape,
  depth: number,
  x: number,
  y: number,
  z: number,
) {
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: false,
    curveSegments: 24,
  })
  geometry.translate(x, y, z - depth / 2)
  const mesh = new THREE.Mesh(geometry, material)
  tagDoorSlot(mesh)
  parent.add(mesh)
}

function getClampedArchHeight(width: number, height: number, archHeight: number | undefined) {
  return Math.min(Math.max(archHeight ?? width / 2, 0.01), Math.max(height, 0.01))
}

function createArchShape(
  left: number,
  right: number,
  bottom: number,
  top: number,
  archHeight: number,
) {
  const centerX = (left + right) / 2
  const halfWidth = (right - left) / 2
  const clampedArchHeight = getClampedArchHeight(right - left, top - bottom, archHeight)
  const springY = top - clampedArchHeight
  const shape = new THREE.Shape()
  const segments = 32

  shape.moveTo(left, bottom)
  shape.lineTo(right, bottom)
  shape.lineTo(right, springY)
  for (let index = 1; index <= segments; index += 1) {
    const x = right + (left - right) * (index / segments)
    shape.lineTo(x, getArchBoundaryY(x - centerX, halfWidth, springY, clampedArchHeight))
  }
  shape.lineTo(left, bottom)
  shape.closePath()
  return shape
}

function getArchBoundaryY(x: number, halfWidth: number, springY: number, archHeight: number) {
  if (halfWidth <= 1e-6) return springY
  const t = Math.min(Math.abs(x) / halfWidth, 1)
  return springY + archHeight * Math.sqrt(Math.max(1 - t * t, 0))
}

function getOneSidedArchBoundaryYAtX(
  x: number,
  left: number,
  right: number,
  top: number,
  archHeight: number,
  curvedSide: 'left' | 'right',
) {
  const width = right - left
  if (width <= 1e-6) return top
  const clampedArchHeight = getClampedArchHeight(width, Number.MAX_SAFE_INTEGER, archHeight)
  const springY = top - clampedArchHeight
  const distanceFromApex =
    curvedSide === 'left'
      ? Math.max(0, Math.min((right - x) / width, 1))
      : Math.max(0, Math.min((x - left) / width, 1))
  return (
    springY + clampedArchHeight * Math.sqrt(Math.max(1 - distanceFromApex * distanceFromApex, 0))
  )
}

function getRoundedBoundaryYAtX(
  x: number,
  left: number,
  right: number,
  top: number,
  radii: TopCornerRadii,
) {
  if (radii.topLeft > 1e-6 && x < left + radii.topLeft) {
    const centerX = left + radii.topLeft
    const centerY = top - radii.topLeft
    const dx = x - centerX
    return centerY + Math.sqrt(Math.max(radii.topLeft * radii.topLeft - dx * dx, 0))
  }

  if (radii.topRight > 1e-6 && x > right - radii.topRight) {
    const centerX = right - radii.topRight
    const centerY = top - radii.topRight
    const dx = x - centerX
    return centerY + Math.sqrt(Math.max(radii.topRight * radii.topRight - dx * dx, 0))
  }

  return top
}

function createArchBandShape(
  width: number,
  outerSpringY: number,
  outerTopY: number,
  innerSpringY: number,
  innerTopY: number,
  insetX: number,
) {
  const halfWidth = width / 2
  const innerHalfWidth = Math.max(halfWidth - insetX, 0)
  const outerArchHeight = Math.max(outerTopY - outerSpringY, 0)
  const safeInnerTopY = Math.min(innerTopY, outerTopY - 0.001)
  const safeInnerSpringY = Math.min(innerSpringY, safeInnerTopY - 0.001)
  const innerArchHeight = Math.max(safeInnerTopY - safeInnerSpringY, 0)
  const shape = new THREE.Shape()
  const segments = 32
  const getSafeInnerBoundaryY = (x: number) =>
    Math.min(
      getArchBoundaryY(x, innerHalfWidth, safeInnerSpringY, innerArchHeight),
      getArchBoundaryY(x, halfWidth, outerSpringY, outerArchHeight) - 0.001,
    )

  shape.moveTo(-halfWidth, outerSpringY)
  for (let index = 1; index <= segments; index += 1) {
    const x = -halfWidth + width * (index / segments)
    shape.lineTo(x, getArchBoundaryY(x, halfWidth, outerSpringY, outerArchHeight))
  }

  if (innerHalfWidth <= 0.001 || safeInnerTopY <= safeInnerSpringY + 0.001) {
    shape.lineTo(halfWidth, outerSpringY)
    shape.closePath()
    return shape
  }

  shape.lineTo(innerHalfWidth, outerSpringY)
  shape.lineTo(innerHalfWidth, getSafeInnerBoundaryY(innerHalfWidth))
  for (let index = segments - 1; index >= 0; index -= 1) {
    const x = -innerHalfWidth + innerHalfWidth * 2 * (index / segments)
    shape.lineTo(x, getSafeInnerBoundaryY(x))
  }
  shape.lineTo(-innerHalfWidth, outerSpringY)
  shape.lineTo(-halfWidth, outerSpringY)
  shape.closePath()

  return shape
}

function createArchHeadBarShape(width: number, bottomY: number, springY: number, topY: number) {
  const halfWidth = width / 2
  const archHeight = Math.max(topY - springY, 0)
  const shape = new THREE.Shape()
  const segments = 32

  shape.moveTo(-halfWidth, bottomY)
  shape.lineTo(halfWidth, bottomY)
  shape.lineTo(halfWidth, springY)
  for (let index = 1; index <= segments; index += 1) {
    const x = halfWidth - width * (index / segments)
    shape.lineTo(x, getArchBoundaryY(x, halfWidth, springY, archHeight))
  }
  shape.lineTo(-halfWidth, bottomY)
  shape.closePath()

  return shape
}

type TopCornerRadii = {
  topLeft: number
  topRight: number
}

function normalizeTopCornerRadii(
  radii: TopCornerRadii,
  width: number,
  height: number,
): TopCornerRadii {
  const next = { ...radii }
  const scale = Math.min(
    1,
    width / Math.max(next.topLeft + next.topRight, 1e-6),
    height / Math.max(next.topLeft, 1e-6),
    height / Math.max(next.topRight, 1e-6),
  )

  if (scale < 1) {
    next.topLeft *= scale
    next.topRight *= scale
  }

  return next
}

function getDoorTopRadii(node: DoorNode, width: number, height: number): TopCornerRadii {
  if (node.openingRadiusMode === 'individual') {
    const [topLeft = 0, topRight = 0] = node.openingTopRadii ?? [0.15, 0.15]
    return normalizeTopCornerRadii(
      {
        topLeft: Math.max(topLeft, 0),
        topRight: Math.max(topRight, 0),
      },
      width,
      height,
    )
  }

  const maxRadius = Math.min(width / 2, height)
  const radius = Math.min(Math.max(node.cornerRadius ?? 0.15, 0), maxRadius)
  return { topLeft: radius, topRight: radius }
}

function createRoundedTopShape(
  left: number,
  right: number,
  bottom: number,
  top: number,
  radii: TopCornerRadii,
) {
  const shape = new THREE.Shape()
  const { topLeft, topRight } = normalizeTopCornerRadii(radii, right - left, top - bottom)

  shape.moveTo(left, bottom)
  shape.lineTo(right, bottom)
  shape.lineTo(right, top - topRight)
  if (topRight > 1e-6) {
    shape.absarc(right - topRight, top - topRight, topRight, 0, Math.PI / 2, false)
  } else {
    shape.lineTo(right, top)
  }

  shape.lineTo(left + topLeft, top)
  if (topLeft > 1e-6) {
    shape.absarc(left + topLeft, top - topLeft, topLeft, Math.PI / 2, Math.PI, false)
  } else {
    shape.lineTo(left, top)
  }

  shape.lineTo(left, bottom)
  shape.closePath()
  return shape
}

function createRoundedDoorFrameShape(
  width: number,
  height: number,
  frameThickness: number,
  radii: TopCornerRadii,
) {
  const halfWidth = width / 2
  const bottom = -height / 2
  const top = height / 2
  const outerRadii = normalizeTopCornerRadii(radii, width, height)
  const outer = createRoundedTopShape(-halfWidth, halfWidth, bottom, top, outerRadii)
  const inset = Math.min(frameThickness, width / 2 - 0.005, height - 0.005)

  if (inset <= 0.001) return outer

  const innerLeft = -halfWidth + inset
  const innerRight = halfWidth - inset
  const innerTop = top - inset
  const innerRadii = normalizeTopCornerRadii(
    {
      topLeft: Math.max(outerRadii.topLeft - inset, 0),
      topRight: Math.max(outerRadii.topRight - inset, 0),
    },
    innerRight - innerLeft,
    innerTop - bottom,
  )
  const holeShape = createRoundedTopShape(innerLeft, innerRight, bottom, innerTop, innerRadii)
  const hole = new THREE.Path(holeShape.getPoints(32).reverse())
  outer.holes.push(hole)

  return outer
}

function shapeToReversedPath(shape: THREE.Shape) {
  return new THREE.Path(shape.getPoints(40).reverse())
}

function createRoundedLeafFrameShape(
  width: number,
  bottom: number,
  top: number,
  radii: TopCornerRadii,
  insetX: number,
  insetY: number,
) {
  const halfWidth = width / 2
  const outerRadii = normalizeTopCornerRadii(radii, width, top - bottom)
  const outer = createRoundedTopShape(-halfWidth, halfWidth, bottom, top, outerRadii)
  const innerLeft = -halfWidth + insetX
  const innerRight = halfWidth - insetX
  const innerBottom = bottom + insetY
  const innerTop = top - insetY

  if (innerRight <= innerLeft + 0.01 || innerTop <= innerBottom + 0.01) return outer

  const innerRadii = normalizeTopCornerRadii(
    {
      topLeft: Math.max(outerRadii.topLeft - Math.max(insetX, insetY), 0),
      topRight: Math.max(outerRadii.topRight - Math.max(insetX, insetY), 0),
    },
    innerRight - innerLeft,
    innerTop - innerBottom,
  )
  outer.holes.push(
    shapeToReversedPath(
      createRoundedTopShape(innerLeft, innerRight, innerBottom, innerTop, innerRadii),
    ),
  )

  return outer
}

function createRoundedClippedLeafFrameShape(
  left: number,
  right: number,
  bottom: number,
  top: number,
  fullLeft: number,
  fullRight: number,
  radii: TopCornerRadii,
  insetX: number,
  insetY: number,
) {
  const outerRadii = normalizeTopCornerRadii(radii, fullRight - fullLeft, top - bottom)
  const outer = createTopClippedRectShape(left, right, bottom, top, (x) =>
    getRoundedBoundaryYAtX(x, fullLeft, fullRight, top, {
      topLeft: outerRadii.topLeft,
      topRight: outerRadii.topRight,
    }),
  )

  if (!outer) return null

  const innerLeft = left + insetX
  const innerRight = right - insetX
  const innerBottom = bottom + insetY
  const innerTop = top - insetY

  if (innerRight <= innerLeft + 0.01 || innerTop <= innerBottom + 0.01) return outer

  const innerFullLeft = fullLeft + insetX
  const innerFullRight = fullRight - insetX
  const innerRadii = normalizeTopCornerRadii(
    {
      topLeft: Math.max(outerRadii.topLeft - Math.max(insetX, insetY), 0),
      topRight: Math.max(outerRadii.topRight - Math.max(insetX, insetY), 0),
    },
    innerFullRight - innerFullLeft,
    innerTop - innerBottom,
  )
  const holeShape = createTopClippedRectShape(innerLeft, innerRight, innerBottom, innerTop, (x) =>
    getRoundedBoundaryYAtX(x, innerFullLeft, innerFullRight, innerTop, {
      topLeft: innerRadii.topLeft,
      topRight: innerRadii.topRight,
    }),
  )

  if (holeShape) outer.holes.push(shapeToReversedPath(holeShape))

  return outer
}

function createArchedLeafFrameShape(
  width: number,
  bottom: number,
  top: number,
  archHeight: number,
  insetX: number,
  insetY: number,
) {
  const halfWidth = width / 2
  const outer = createArchShape(-halfWidth, halfWidth, bottom, top, archHeight)
  const innerLeft = -halfWidth + insetX
  const innerRight = halfWidth - insetX
  const innerBottom = bottom + insetY
  const innerTop = top - insetY

  if (innerRight <= innerLeft + 0.01 || innerTop <= innerBottom + 0.01) return outer

  const innerArchHeight = getClampedArchHeight(
    innerRight - innerLeft,
    innerTop - innerBottom,
    Math.max(archHeight - insetY, 0.01),
  )
  outer.holes.push(
    shapeToReversedPath(
      createArchShape(innerLeft, innerRight, innerBottom, innerTop, innerArchHeight),
    ),
  )

  return outer
}

function createArchedClippedLeafFrameShape(
  left: number,
  right: number,
  bottom: number,
  top: number,
  fullLeft: number,
  fullRight: number,
  archHeight: number,
  insetX: number,
  insetY: number,
) {
  const fullCenterX = (fullLeft + fullRight) / 2
  const fullHalfWidth = (fullRight - fullLeft) / 2
  const springY = top - archHeight
  const outer = createTopClippedRectShape(left, right, bottom, top, (x) =>
    getArchBoundaryY(x - fullCenterX, fullHalfWidth, springY, archHeight),
  )

  if (!outer) return null

  const innerLeft = left + insetX
  const innerRight = right - insetX
  const innerBottom = bottom + insetY
  const innerTop = top - insetY

  if (innerRight <= innerLeft + 0.01 || innerTop <= innerBottom + 0.01) return outer

  const innerFullLeft = fullLeft + insetX
  const innerFullRight = fullRight - insetX
  const innerArchHeight = getClampedArchHeight(
    innerFullRight - innerFullLeft,
    innerTop - innerBottom,
    Math.max(archHeight - insetY, 0.01),
  )
  const innerFullCenterX = (innerFullLeft + innerFullRight) / 2
  const innerFullHalfWidth = (innerFullRight - innerFullLeft) / 2
  const innerSpringY = innerTop - innerArchHeight
  const holeShape = createTopClippedRectShape(innerLeft, innerRight, innerBottom, innerTop, (x) =>
    getArchBoundaryY(x - innerFullCenterX, innerFullHalfWidth, innerSpringY, innerArchHeight),
  )

  if (holeShape) outer.holes.push(shapeToReversedPath(holeShape))

  return outer
}

function createOneSidedArchLeafFrameShape(
  left: number,
  right: number,
  bottom: number,
  top: number,
  archHeight: number,
  insetX: number,
  insetY: number,
  curvedSide: 'left' | 'right',
) {
  const outer = createTopClippedRectShape(left, right, bottom, top, (x) =>
    getOneSidedArchBoundaryYAtX(x, left, right, top, archHeight, curvedSide),
  )

  if (!outer) return null

  const innerLeft = left + insetX
  const innerRight = right - insetX
  const innerBottom = bottom + insetY
  const innerTop = top - insetY

  if (innerRight <= innerLeft + 0.01 || innerTop <= innerBottom + 0.01) return outer

  const innerArchHeight = getClampedArchHeight(
    innerRight - innerLeft,
    innerTop - innerBottom,
    Math.max(archHeight - insetY, 0.01),
  )
  const holeShape = createTopClippedRectShape(innerLeft, innerRight, innerBottom, innerTop, (x) =>
    getOneSidedArchBoundaryYAtX(x, innerLeft, innerRight, innerTop, innerArchHeight, curvedSide),
  )

  if (holeShape) outer.holes.push(shapeToReversedPath(holeShape))

  return outer
}

function createTopClippedRectShape(
  left: number,
  right: number,
  bottom: number,
  top: number,
  getBoundaryY: (x: number) => number,
) {
  const segments = 20
  const points: { x: number; y: number }[] = []

  for (let index = 0; index <= segments; index += 1) {
    const t = index / segments
    const x = right + (left - right) * t
    const y = Math.min(top, getBoundaryY(x))
    if (y > bottom + 0.001) points.push({ x, y })
  }

  if (points.length < 2) return null

  const shape = new THREE.Shape()
  shape.moveTo(left, bottom)
  shape.lineTo(right, bottom)
  for (const point of points) {
    shape.lineTo(point.x, point.y)
  }
  shape.closePath()
  return shape
}

function disposeObject(object: THREE.Object3D) {
  object.traverse((child) => {
    if (child instanceof THREE.Mesh) child.geometry.dispose()
  })
}

function addLeafSegmentContent({
  addLeafBox,
  addLeafShape,
  leafWidth,
  leafHeight,
  leafCenterX,
  leafCenterY,
  leafDepth,
  segments,
  contentPadding,
  keepFrameWhenEmpty = false,
  renderPerimeterFrame = true,
  openingShape = 'rectangle',
  openingTopRadii,
  archHeight,
  archOuterSide,
}: {
  addLeafBox: (
    material: THREE.Material,
    w: number,
    h: number,
    d: number,
    x: number,
    y: number,
    z: number,
  ) => void
  addLeafShape?: (material: THREE.Material, shape: THREE.Shape, depth: number) => void
  leafWidth: number
  leafHeight: number
  leafCenterX: number
  leafCenterY: number
  leafDepth: number
  segments: DoorNode['segments']
  contentPadding: DoorNode['contentPadding']
  keepFrameWhenEmpty?: boolean
  renderPerimeterFrame?: boolean
  openingShape?: DoorNode['openingShape']
  openingTopRadii?: TopCornerRadii
  archHeight?: number
  archOuterSide?: 'left' | 'right'
}) {
  const hasLeafContent = segments.some((seg) => seg.type !== 'empty')
  const shouldRenderFrame = hasLeafContent || keepFrameWhenEmpty
  const cpX = contentPadding[0]
  const cpY = contentPadding[1]
  if (renderPerimeterFrame && shouldRenderFrame && cpY > 0) {
    currentDoorSlot = 'panel'
    addLeafBox(
      baseMaterial,
      leafWidth,
      cpY,
      leafDepth,
      leafCenterX,
      leafCenterY + leafHeight / 2 - cpY / 2,
      0,
    )
    addLeafBox(
      baseMaterial,
      leafWidth,
      cpY,
      leafDepth,
      leafCenterX,
      leafCenterY - leafHeight / 2 + cpY / 2,
      0,
    )
  }
  if (renderPerimeterFrame && shouldRenderFrame && cpX > 0) {
    const innerH = leafHeight - 2 * cpY
    currentDoorSlot = 'panel'
    addLeafBox(
      baseMaterial,
      cpX,
      innerH,
      leafDepth,
      leafCenterX - leafWidth / 2 + cpX / 2,
      leafCenterY,
      0,
    )
    addLeafBox(
      baseMaterial,
      cpX,
      innerH,
      leafDepth,
      leafCenterX + leafWidth / 2 - cpX / 2,
      leafCenterY,
      0,
    )
  }

  const contentW = leafWidth - 2 * cpX
  const contentH = leafHeight - 2 * cpY
  const totalRatio = segments.reduce((sum, s) => sum + s.heightRatio, 0)
  const contentTop = leafCenterY + contentH / 2

  let segY = contentTop
  const leafLeft = leafCenterX - leafWidth / 2
  const leafRight = leafCenterX + leafWidth / 2
  const leafTop = leafCenterY + leafHeight / 2
  const hasShapedTop = openingShape === 'rounded' || openingShape === 'arch'
  const clampedLeafArchHeight =
    openingShape === 'arch' ? getClampedArchHeight(leafWidth, leafHeight, archHeight) : 0
  const leafSpringY = leafTop - clampedLeafArchHeight
  const topBoundaryAtX = (x: number) => {
    if (openingShape === 'rounded' && openingTopRadii) {
      return getRoundedBoundaryYAtX(x, leafLeft, leafRight, leafTop, {
        topLeft: openingTopRadii.topLeft,
        topRight: openingTopRadii.topRight,
      })
    }

    if (openingShape === 'arch') {
      if (archOuterSide) {
        return getOneSidedArchBoundaryYAtX(
          x,
          leafLeft,
          leafRight,
          leafTop,
          clampedLeafArchHeight,
          archOuterSide,
        )
      }

      return getArchBoundaryY(x - leafCenterX, leafWidth / 2, leafSpringY, clampedLeafArchHeight)
    }

    return leafTop
  }

  for (const seg of segments) {
    const segH = (seg.heightRatio / totalRatio) * contentH
    const segCenterY = segY - segH / 2
    const segTop = segY
    const segBottom = segY - segH
    const numCols = seg.columnRatios.length
    const colSum = seg.columnRatios.reduce((a, b) => a + b, 0)
    const usableW = contentW - (numCols - 1) * seg.dividerThickness
    const colWidths = seg.columnRatios.map((r) => (r / colSum) * usableW)

    const colXCenters: number[] = []
    let cx = leafCenterX - contentW / 2
    for (let c = 0; c < numCols; c++) {
      colXCenters.push(cx + colWidths[c]! / 2)
      cx += colWidths[c]!
      if (c < numCols - 1) cx += seg.dividerThickness
    }

    if (seg.type !== 'empty') {
      cx = leafCenterX - contentW / 2
      currentDoorSlot = 'panel'
      for (let c = 0; c < numCols - 1; c++) {
        cx += colWidths[c]!
        const dividerLeft = cx
        const dividerRight = cx + seg.dividerThickness
        const dividerShape =
          hasShapedTop && addLeafShape
            ? createTopClippedRectShape(
                dividerLeft,
                dividerRight,
                segBottom,
                segTop,
                topBoundaryAtX,
              )
            : null

        if (dividerShape && addLeafShape) {
          addLeafShape(baseMaterial, dividerShape, leafDepth + 0.001)
        } else {
          addLeafBox(
            baseMaterial,
            seg.dividerThickness,
            segH,
            leafDepth + 0.001,
            cx + seg.dividerThickness / 2,
            segCenterY,
            0,
          )
        }
        cx += seg.dividerThickness
      }
    }

    for (let c = 0; c < numCols; c++) {
      const colW = colWidths[c]!
      const colX = colXCenters[c]!

      if (seg.type === 'glass') {
        currentDoorSlot = 'glass'
        const glassDepth = Math.max(0.004, leafDepth * 0.15)
        const segmentLeft = colX - colW / 2
        const segmentRight = colX + colW / 2
        const glassShape =
          hasShapedTop && addLeafShape
            ? createTopClippedRectShape(
                segmentLeft,
                segmentRight,
                segBottom,
                segTop,
                topBoundaryAtX,
              )
            : null

        if (glassShape && addLeafShape) {
          addLeafShape(glassMaterial, glassShape, glassDepth)
        } else {
          addLeafBox(glassMaterial, colW, segH, glassDepth, colX, segCenterY, 0)
        }
      } else if (seg.type === 'panel') {
        currentDoorSlot = 'panel'
        const segmentLeft = colX - colW / 2
        const segmentRight = colX + colW / 2
        const outerPanelShape =
          hasShapedTop && addLeafShape
            ? createTopClippedRectShape(
                segmentLeft,
                segmentRight,
                segBottom,
                segTop,
                topBoundaryAtX,
              )
            : null

        if (outerPanelShape && addLeafShape) {
          addLeafShape(baseMaterial, outerPanelShape, leafDepth)
        } else {
          addLeafBox(baseMaterial, colW, segH, leafDepth, colX, segCenterY, 0)
        }
        const panelW = colW - 2 * seg.panelInset
        const panelH = segH - 2 * seg.panelInset
        if (panelW > 0.01 && panelH > 0.01) {
          const effectiveDepth = Math.abs(seg.panelDepth) < 0.002 ? 0.005 : Math.abs(seg.panelDepth)
          const panelZ = leafDepth / 2 + effectiveDepth / 2
          const insetLeft = colX - panelW / 2
          const insetRight = colX + panelW / 2
          const insetTop = segTop - seg.panelInset
          const insetBottom = segBottom + seg.panelInset
          const innerPanelShape =
            hasShapedTop && addLeafShape
              ? createTopClippedRectShape(
                  insetLeft,
                  insetRight,
                  insetBottom,
                  insetTop,
                  topBoundaryAtX,
                )
              : null

          if (innerPanelShape && addLeafShape) {
            addLeafShape(baseMaterial, innerPanelShape, effectiveDepth)
          } else {
            addLeafBox(baseMaterial, panelW, panelH, effectiveDepth, colX, segCenterY, panelZ)
          }
        }
      }
    }

    segY -= segH
  }
}

function addDoorLeaf(
  mesh: THREE.Mesh,
  {
    leafWidth,
    leafHeight,
    leafCenterX,
    leafCenterY,
    leafDepth,
    hingeX,
    hingeSide,
    swingRotation,
    openRotationY,
    segments,
    contentPadding,
    handle,
    handleBothSides = false,
    handleHeight,
    handleSide,
    doorCloser,
    panicBar,
    panicBarHeight,
    doorHeight,
    openingShape,
    openingTopRadii,
    archHeight,
    roundedBoundary,
    archedBoundary,
    archOuterSide,
  }: {
    leafWidth: number
    leafHeight: number
    leafCenterX: number
    leafCenterY: number
    leafDepth: number
    hingeX: number
    hingeSide: 'left' | 'right'
    swingRotation: number
    // Leaf rotation (radians, about the hinge Y axis) at fully-open. The GLB
    // exporter reads this off the leaf group to bake an open/close clip; it is
    // the kinematic endpoint, independent of the current `swingRotation`.
    openRotationY: number
    segments: DoorNode['segments']
    contentPadding: DoorNode['contentPadding']
    handle: boolean
    handleBothSides?: boolean
    handleHeight: number
    handleSide: DoorNode['handleSide']
    doorCloser: boolean
    panicBar: boolean
    panicBarHeight: number
    doorHeight: number
    openingShape: DoorNode['openingShape']
    openingTopRadii: TopCornerRadii
    archHeight: number
    roundedBoundary?: {
      fullLeft: number
      fullRight: number
      radii: TopCornerRadii
    }
    archedBoundary?: {
      fullLeft: number
      fullRight: number
      archHeight: number
    }
    archOuterSide?: 'left' | 'right'
  },
) {
  const hasLeafContent = segments.some((seg) => seg.type !== 'empty')
  const leafGroup = new THREE.Group()
  leafGroup.position.set(hingeX, 0, 0)
  leafGroup.rotation.y = swingRotation
  // Marks this group as the swing leaf and records its fully-open angle so the
  // GLB exporter can bake an open/close animation clip from a single pose. The
  // exporter strips this marker before writing the file.
  leafGroup.userData.pascalSwingLeaf = { axis: 'y', openRotationY }
  mesh.add(leafGroup)

  const addLeafBox = (
    material: THREE.Material,
    w: number,
    h: number,
    d: number,
    x: number,
    y: number,
    z: number,
  ) => addBox(leafGroup, material, w, h, d, x - hingeX, y, z)
  const addLeafShape = (material: THREE.Material, shape: THREE.Shape, depth: number) =>
    addShapeAt(leafGroup, material, shape, depth, -hingeX, 0, 0)

  const localLeafCenterX = leafCenterX - hingeX
  const leafBottom = leafCenterY - leafHeight / 2
  const leafTop = leafCenterY + leafHeight / 2
  const usesShapedLeafFrame = openingShape === 'rounded' || openingShape === 'arch'

  if (usesShapedLeafFrame && hasLeafContent) {
    currentDoorSlot = 'panel'
    if (openingShape === 'rounded') {
      const roundedLeafShape = roundedBoundary
        ? createRoundedClippedLeafFrameShape(
            leafCenterX - leafWidth / 2,
            leafCenterX + leafWidth / 2,
            leafBottom,
            leafTop,
            roundedBoundary.fullLeft,
            roundedBoundary.fullRight,
            roundedBoundary.radii,
            contentPadding[0],
            contentPadding[1],
          )
        : createRoundedLeafFrameShape(
            leafWidth,
            leafBottom,
            leafTop,
            openingTopRadii,
            contentPadding[0],
            contentPadding[1],
          )

      if (roundedLeafShape) {
        if (roundedBoundary) {
          addLeafShape(baseMaterial, roundedLeafShape, leafDepth)
        } else {
          addShapeAt(leafGroup, baseMaterial, roundedLeafShape, leafDepth, localLeafCenterX, 0, 0)
        }
      }
    } else if (openingShape === 'arch') {
      const archedLeafShape = archOuterSide
        ? createOneSidedArchLeafFrameShape(
            leafCenterX - leafWidth / 2,
            leafCenterX + leafWidth / 2,
            leafBottom,
            leafTop,
            archHeight,
            contentPadding[0],
            contentPadding[1],
            archOuterSide,
          )
        : archedBoundary
          ? createArchedClippedLeafFrameShape(
              leafCenterX - leafWidth / 2,
              leafCenterX + leafWidth / 2,
              leafBottom,
              leafTop,
              archedBoundary.fullLeft,
              archedBoundary.fullRight,
              archedBoundary.archHeight,
              contentPadding[0],
              contentPadding[1],
            )
          : createArchedLeafFrameShape(
              leafWidth,
              leafBottom,
              leafTop,
              getClampedArchHeight(leafWidth, leafHeight, archHeight),
              contentPadding[0],
              contentPadding[1],
            )

      if (archedLeafShape) {
        if (archOuterSide || archedBoundary) {
          addLeafShape(baseMaterial, archedLeafShape, leafDepth)
        } else {
          addShapeAt(leafGroup, baseMaterial, archedLeafShape, leafDepth, localLeafCenterX, 0, 0)
        }
      }
    }
  }

  addLeafSegmentContent({
    addLeafBox,
    addLeafShape,
    leafWidth,
    leafHeight,
    leafCenterX,
    leafCenterY,
    leafDepth,
    segments,
    contentPadding,
    renderPerimeterFrame: !usesShapedLeafFrame,
    openingShape,
    openingTopRadii,
    archHeight,
    archOuterSide,
  })

  if (hasLeafContent && handle) {
    currentDoorSlot = 'hardware'
    const handleY = handleHeight - doorHeight / 2
    const faceZ = leafDepth / 2
    const handleX =
      handleSide === 'right'
        ? leafCenterX + leafWidth / 2 - 0.045
        : leafCenterX - leafWidth / 2 + 0.045

    addLeafBox(hardwareMaterial, 0.028, 0.14, 0.01, handleX, handleY, faceZ + 0.005)
    addLeafBox(hardwareMaterial, 0.022, 0.1, 0.035, handleX, handleY, faceZ + 0.025)

    if (handleBothSides) {
      addLeafBox(hardwareMaterial, 0.028, 0.14, 0.01, handleX, handleY, -faceZ - 0.005)
      addLeafBox(hardwareMaterial, 0.022, 0.1, 0.035, handleX, handleY, -faceZ - 0.025)
    }
  }

  if (hasLeafContent && doorCloser) {
    currentDoorSlot = 'hardware'
    const closerY = leafCenterY + leafHeight / 2 - 0.04
    addLeafBox(hardwareMaterial, 0.28, 0.055, 0.055, leafCenterX, closerY, leafDepth / 2 + 0.03)
    addLeafBox(
      hardwareMaterial,
      0.14,
      0.015,
      0.015,
      leafCenterX + leafWidth / 4,
      closerY + 0.025,
      leafDepth / 2 + 0.015,
    )
  }

  if (hasLeafContent && panicBar) {
    currentDoorSlot = 'hardware'
    const barY = panicBarHeight - doorHeight / 2
    addLeafBox(
      hardwareMaterial,
      leafWidth * 0.72,
      0.04,
      0.055,
      leafCenterX,
      barY,
      leafDepth / 2 + 0.03,
    )
  }

  if (hasLeafContent) {
    currentDoorSlot = 'hardware'
    const hingeMarkerX = hingeSide === 'right' ? hingeX - 0.012 : hingeX + 0.012
    const hingeH = 0.1
    const hingeW = 0.024
    const hingeD = leafDepth + 0.016
    addBox(mesh, hardwareMaterial, hingeW, hingeH, hingeD, hingeMarkerX, leafBottom + 0.25, 0)
    addBox(
      mesh,
      hardwareMaterial,
      hingeW,
      hingeH,
      hingeD,
      hingeMarkerX,
      (leafBottom + leafTop) / 2,
      0,
    )
    addBox(mesh, hardwareMaterial, hingeW, hingeH, hingeD, hingeMarkerX, leafTop - 0.25, 0)
  }

  // When the leaf is swung open it projects into the room and would otherwise
  // win a top-down selection click over the floor beneath it. Drop only the
  // swung leaf out of the raycast; a closed leaf stays in the wall plane and
  // keeps its hit-eligibility (so paint-by-slot still works on it).
  if (Math.abs(swingRotation) > 1e-3) {
    disableSubtreeRaycast(leafGroup)
  }
}

// Names of the re-poseable moving groups each operation-door builder emits. The
// builder fills them with geometry at the CLOSED pose; `poseDoorMovingParts`
// then transforms the group to a given open fraction. This is the same
// build-once + pose-at-t split windows use (`poseWindowMovingParts`), and it is
// the single source of truth for door kinematics: the live system poses the
// registered mesh, and the GLB exporter poses an export clone to sample the
// open/close keyframes for a baked animation clip.
const SLIDING_ACTIVE_PANEL_NAME = 'door-sliding-active'
const POCKET_LEAF_NAME = 'door-pocket-leaf'
const BARN_LEAF_NAME = 'door-barn-leaf'
const TILTUP_LEAF_NAME = 'door-tiltup-leaf'
// Folding panels form a hinged chain; each `<name><index>` group is parented to
// the previous one so a single per-joint rotation reproduces the accordion.
const FOLDING_PANEL_NAME = 'door-fold-'
// Sectional panels each ride the overhead curve independently (non-rigid as a
// set), so each `<name><index>` group is posed on its own.
const SECTIONAL_PANEL_NAME = 'door-sectional-'
const ROLLUP_CURTAIN_NAME = 'door-rollup-curtain'

/**
 * Pose an operation door's moving parts (sliding/pocket/barn leaf, tilt-up and
 * sectional panels, folding chain, roll-up curtain) at `value` (0 = closed,
 * 1 = open) by transforming the named groups its builder emitted at the closed
 * pose. Returns true when the door type has a pose path and its groups exist.
 *
 * Mirrors `poseWindowMovingParts`: the live door system calls it after a
 * (re)build so `operationState` is reflected, and the GLB exporter calls it on a
 * clone to sample keyframes. Swing doors are not handled here — their leaf group
 * carries a `pascalSwingLeaf` marker the exporter reads directly.
 *
 * Roll-up is the one type whose live geometry changes (slats vanish onto a
 * drum), which a glTF clip can't express; the baked approximation scales the
 * curtain up into the lintel. The live roll-up animation keeps its full-detail
 * rebuild and is intentionally NOT routed through this scale.
 */
export function poseDoorMovingParts(
  node: DoorNode,
  mesh: THREE.Object3D | undefined,
  value: number,
): boolean {
  if (!mesh) return false
  const t = clampDoorOperationState(value)
  const frameThickness = node.frameThickness
  const insideWidth = node.width - 2 * frameThickness
  const leafHeight = node.height - frameThickness
  const leafCenterY = -frameThickness / 2

  switch (node.doorType) {
    case 'sliding': {
      const group = mesh.getObjectByName(SLIDING_ACTIVE_PANEL_NAME)
      if (!group) return false
      const activeSign = node.slideDirection === 'left' ? 1 : -1
      group.position.x = -activeSign * insideWidth * 0.44 * t
      return true
    }
    case 'pocket': {
      const group = mesh.getObjectByName(POCKET_LEAF_NAME)
      if (!group) return false
      const slideSign = node.slideDirection === 'right' ? 1 : -1
      group.position.x = slideSign * insideWidth * t
      return true
    }
    case 'barn': {
      const group = mesh.getObjectByName(BARN_LEAF_NAME)
      if (!group) return false
      const slideSign = node.slideDirection === 'right' ? 1 : -1
      group.position.x = slideSign * insideWidth * t
      return true
    }
    case 'garage-tiltup': {
      const group = mesh.getObjectByName(TILTUP_LEAF_NAME)
      if (!group) return false
      // Rigid hinge: the closed leaf hangs from the lintel; opening rotates it
      // about the top edge. `position` keeps the top edge tracking the hinge as
      // the group rotates about its own origin (see the closed build below).
      const angle = (Math.PI / 2) * t
      const hingeY = leafCenterY + leafHeight / 2
      group.rotation.set(-angle, 0, 0)
      group.position.set(0, hingeY * (1 - Math.cos(angle)), Math.sin(angle) * (hingeY - leafHeight))
      return true
    }
    case 'folding': {
      const panelCount = node.leafCount === 2 ? 2 : 4
      const foldAngle = Math.PI * 0.44 * t
      // Each panel group is parented to the previous, so its rotation is the
      // joint angle (the change in absolute segment direction), not the absolute
      // angle: alternating panels target ∓foldAngle, so joints fold by ±2·angle.
      // The leading sign folds the leaves toward −z (matching the original rig).
      let posed = false
      let prevDirection = 0
      for (let index = 0; index < panelCount; index++) {
        const group = mesh.getObjectByName(`${FOLDING_PANEL_NAME}${index}`)
        const direction = index % 2 === 0 ? -1 : 1
        if (group) {
          posed = true
          // Set the full triple (not just `.y`): when the export clones and
          // decomposes the door matrix, a |Y| > π/2 rotation re-derives into a
          // gimbal-flipped euler (x=z=π). Assigning only `.y` would leave that
          // π residue on x/z and bake a flipped rest pose.
          group.rotation.set(0, (prevDirection - direction) * foldAngle, 0)
        }
        prevDirection = direction
      }
      return posed
    }
    case 'garage-sectional': {
      const panelCount = Math.max(3, Math.min(12, Math.round(node.garagePanelCount)))
      const panelHeight = leafHeight / panelCount
      const curveRadius = panelHeight * 0.58
      const curveLength = (Math.PI / 2) * curveRadius
      const overheadY = leafCenterY + leafHeight / 2 - panelHeight / 2
      const openAmount = getDoorRenderOpenAmount('garage-sectional', t)
      const travel =
        openAmount * ((panelCount - 1) * panelHeight + curveLength + panelHeight * 0.65)
      let posed = false
      for (let index = 0; index < panelCount; index++) {
        const group = mesh.getObjectByName(`${SECTIONAL_PANEL_NAME}${index}`)
        if (!group) continue
        posed = true
        const orderFromTop = panelCount - 1 - index
        const pathPosition = travel - orderFromTop * panelHeight
        let y = overheadY + pathPosition
        let z = 0
        let rotationX = 0
        if (pathPosition > 0 && pathPosition <= curveLength) {
          const theta = pathPosition / curveRadius
          rotationX = -theta
          y = overheadY + curveRadius * Math.sin(theta)
          z = -curveRadius * (1 - Math.cos(theta))
        } else if (pathPosition > curveLength) {
          rotationX = -Math.PI / 2
          y = overheadY + curveRadius
          z = -(curveRadius + pathPosition - curveLength)
        }
        group.position.set(0, y, z)
        group.rotation.set(rotationX, 0, 0)
      }
      return posed
    }
    case 'garage-rollup': {
      const group = mesh.getObjectByName(ROLLUP_CURTAIN_NAME)
      if (!group) return false
      group.scale.y = Math.max(0.02, 1 - t)
      return true
    }
    default:
      return false
  }
}

function addFoldingDoor(
  mesh: THREE.Mesh,
  {
    insideWidth,
    leafHeight,
    leafCenterY,
    leafDepth,
    frameThickness,
    frameDepth,
    leafCount,
    doorHeight,
    handleHeight,
    segments,
    contentPadding,
  }: {
    insideWidth: number
    leafHeight: number
    leafCenterY: number
    leafDepth: number
    frameThickness: number
    frameDepth: number
    leafCount: DoorNode['leafCount']
    doorHeight: number
    handleHeight: number
    segments: DoorNode['segments']
    contentPadding: DoorNode['contentPadding']
  },
) {
  const panelCount = leafCount === 2 ? 2 : 4
  const panelLength = insideWidth / panelCount

  currentDoorSlot = 'hardware'
  addBox(
    mesh,
    hardwareMaterial,
    insideWidth,
    Math.min(frameThickness * 0.5, 0.025),
    Math.max(frameDepth * 0.45, 0.035),
    0,
    leafCenterY + leafHeight / 2 - 0.018,
    0,
  )

  // Build the panels as a hinged chain at the CLOSED pose: each panel group is
  // parented to the previous one at that panel's end (`panelLength` along local
  // x), starting from the left jamb. At rest every joint is straight, so the
  // panels lie flat across the opening; `poseDoorMovingParts` folds the joints.
  let parent: THREE.Object3D = mesh
  for (let index = 0; index < panelCount; index++) {
    const group = new THREE.Group()
    group.name = `${FOLDING_PANEL_NAME}${index}`
    group.position.set(index === 0 ? -insideWidth / 2 : panelLength, 0, 0)
    parent.add(group)

    // Panel content runs from local x=0 to x=panelLength, so it is centred at
    // panelLength/2 within the group (the segment helper centres on leafCenterX).
    currentDoorSlot = undefined
    const addFoldingLeafBox = (
      material: THREE.Material,
      w: number,
      h: number,
      d: number,
      x: number,
      y: number,
      z: number,
    ) => addBox(group, material, w, h, d, panelLength / 2 + x, y, z)

    addLeafSegmentContent({
      addLeafBox: addFoldingLeafBox,
      leafWidth: Math.max(0.08, panelLength),
      leafHeight,
      leafCenterX: 0,
      leafCenterY,
      leafDepth,
      segments,
      contentPadding,
      keepFrameWhenEmpty: true,
    })

    // Reveal posts at the panel's hinge edges (local x=0 and x=panelLength).
    currentDoorSlot = undefined
    for (const px of [0, panelLength]) {
      addBox(group, revealMaterial, 0.018, leafHeight * 0.92, leafDepth + 0.016, px, leafCenterY, 0)
    }

    parent = group
  }

  // Handle on the free end of the last panel (its local x=panelLength edge).
  const handleY = handleHeight - doorHeight / 2
  currentDoorSlot = 'hardware'
  addBox(
    parent,
    hardwareMaterial,
    0.035,
    0.16,
    leafDepth + 0.035,
    panelLength - 0.035,
    handleY,
    0.045,
  )
  addBox(
    parent,
    hardwareMaterial,
    0.035,
    0.16,
    leafDepth + 0.035,
    panelLength - 0.035,
    handleY,
    -0.045,
  )
}

function addPocketDoor(
  mesh: THREE.Mesh,
  {
    insideWidth,
    leafHeight,
    leafCenterY,
    leafDepth,
    frameThickness,
    frameDepth,
    slideDirection,
    doorHeight,
    handleHeight,
    segments,
    contentPadding,
  }: {
    insideWidth: number
    leafHeight: number
    leafCenterY: number
    leafDepth: number
    frameThickness: number
    frameDepth: number
    slideDirection: DoorNode['slideDirection']
    doorHeight: number
    handleHeight: number
    segments: DoorNode['segments']
    contentPadding: DoorNode['contentPadding']
  },
) {
  const slideSign = slideDirection === 'right' ? 1 : -1
  const leafWidth = insideWidth
  const topY = leafCenterY + leafHeight / 2
  const pocketCenterX = slideSign * insideWidth
  const handleY = handleHeight - doorHeight / 2
  // Leaf built closed (centred in the opening); `poseDoorMovingParts` slides the
  // group into the pocket. Handle rides inside the group at its closed offset.
  const handleX = -slideSign * (leafWidth / 2 - 0.055)

  currentDoorSlot = 'hardware'
  addBox(
    mesh,
    hardwareMaterial,
    insideWidth * 2,
    Math.min(frameThickness * 0.45, 0.024),
    Math.max(frameDepth * 0.38, 0.03),
    slideSign * (insideWidth / 2),
    topY - 0.018,
    0,
  )
  currentDoorSlot = undefined
  addBox(
    mesh,
    revealMaterial,
    insideWidth * 0.9,
    0.018,
    Math.max(frameDepth * 0.32, 0.026),
    pocketCenterX,
    topY - 0.055,
    0,
  )
  addBox(
    mesh,
    revealMaterial,
    0.018,
    leafHeight * 0.94,
    leafDepth + 0.014,
    slideSign * insideWidth * 0.5,
    leafCenterY,
    0,
  )

  const leafGroup = new THREE.Group()
  leafGroup.name = POCKET_LEAF_NAME
  mesh.add(leafGroup)

  const addPocketLeafBox = (
    material: THREE.Material,
    w: number,
    h: number,
    d: number,
    x: number,
    y: number,
    z: number,
  ) => addBox(leafGroup, material, w, h, d, x, y, z)

  addLeafSegmentContent({
    addLeafBox: addPocketLeafBox,
    leafWidth,
    leafHeight,
    leafCenterX: 0,
    leafCenterY,
    leafDepth,
    segments,
    contentPadding,
  })
  currentDoorSlot = 'hardware'
  addBox(
    leafGroup,
    hardwareMaterial,
    0.03,
    0.18,
    leafDepth + 0.03,
    handleX,
    handleY,
    leafDepth / 2 + 0.02,
  )
  addBox(
    leafGroup,
    hardwareMaterial,
    0.03,
    0.18,
    leafDepth + 0.03,
    handleX,
    handleY,
    -leafDepth / 2 - 0.02,
  )
}

function addBarnDoor(
  mesh: THREE.Mesh,
  {
    insideWidth,
    leafHeight,
    leafCenterY,
    leafDepth,
    frameThickness,
    frameDepth,
    slideDirection,
    doorHeight,
    handleHeight,
    segments,
    contentPadding,
  }: {
    insideWidth: number
    leafHeight: number
    leafCenterY: number
    leafDepth: number
    frameThickness: number
    frameDepth: number
    slideDirection: DoorNode['slideDirection']
    doorHeight: number
    handleHeight: number
    segments: DoorNode['segments']
    contentPadding: DoorNode['contentPadding']
  },
) {
  const slideSign = slideDirection === 'right' ? 1 : -1
  const leafWidth = insideWidth * 1.06
  const faceZ = frameDepth / 2 + leafDepth / 2 + 0.028
  const trackY = leafCenterY + leafHeight / 2 + Math.max(frameThickness * 0.55, 0.045)
  const railLength = insideWidth * 2.25
  const railCenterX = slideSign * (insideWidth * 0.56)
  const handleY = handleHeight - doorHeight / 2
  // Leaf + wheels + handle ride the BARN_LEAF group, built closed (leaf centred
  // in the opening); `poseDoorMovingParts` slides the group along the rail. The
  // rail and end stops stay static on the mesh.
  const handleX = -slideSign * (leafWidth / 2 - 0.075)
  const wheelY = trackY - 0.075

  currentDoorSlot = 'hardware'
  addBox(mesh, hardwareMaterial, railLength, 0.035, 0.035, railCenterX, trackY, faceZ + 0.01)
  addBox(mesh, hardwareMaterial, 0.05, 0.13, 0.035, -insideWidth / 2, trackY - 0.02, faceZ + 0.01)
  addBox(mesh, hardwareMaterial, 0.05, 0.13, 0.035, insideWidth / 2, trackY - 0.02, faceZ + 0.01)

  const leafGroup = new THREE.Group()
  leafGroup.name = BARN_LEAF_NAME
  mesh.add(leafGroup)

  const addBarnLeafBox = (
    material: THREE.Material,
    w: number,
    h: number,
    d: number,
    x: number,
    y: number,
    z: number,
  ) => addBox(leafGroup, material, w, h, d, x, y, faceZ + z)

  addLeafSegmentContent({
    addLeafBox: addBarnLeafBox,
    leafWidth,
    leafHeight,
    leafCenterX: 0,
    leafCenterY,
    leafDepth,
    segments,
    contentPadding,
    keepFrameWhenEmpty: true,
  })

  currentDoorSlot = undefined
  addRotatedBox(
    leafGroup,
    revealMaterial,
    0.018,
    leafHeight * 0.86,
    0.012,
    0,
    leafCenterY,
    faceZ + leafDepth / 2 + 0.014,
    -0.52,
  )
  addRotatedBox(
    leafGroup,
    revealMaterial,
    0.018,
    leafHeight * 0.86,
    0.012,
    0,
    leafCenterY,
    faceZ + leafDepth / 2 + 0.014,
    0.52,
  )

  currentDoorSlot = 'hardware'
  for (const offset of [-leafWidth * 0.28, leafWidth * 0.28]) {
    addBox(leafGroup, hardwareMaterial, 0.085, 0.085, 0.035, offset, wheelY, faceZ + 0.022)
    addBox(leafGroup, hardwareMaterial, 0.026, 0.16, 0.026, offset, wheelY - 0.075, faceZ + 0.022)
  }

  currentDoorSlot = 'hardware'
  addBox(
    leafGroup,
    hardwareMaterial,
    0.032,
    0.22,
    leafDepth + 0.034,
    handleX,
    handleY,
    faceZ + leafDepth / 2 + 0.02,
  )
  addBox(
    leafGroup,
    hardwareMaterial,
    0.032,
    0.22,
    leafDepth + 0.034,
    handleX,
    handleY,
    faceZ - leafDepth / 2 - 0.02,
  )
}

function addSlidingDoor(
  mesh: THREE.Mesh,
  {
    insideWidth,
    leafHeight,
    leafCenterY,
    leafDepth,
    frameThickness,
    frameDepth,
    slideDirection,
    doorHeight,
    handleHeight,
    segments,
    contentPadding,
  }: {
    insideWidth: number
    leafHeight: number
    leafCenterY: number
    leafDepth: number
    frameThickness: number
    frameDepth: number
    slideDirection: DoorNode['slideDirection']
    doorHeight: number
    handleHeight: number
    segments: DoorNode['segments']
    contentPadding: DoorNode['contentPadding']
  },
) {
  const activeOnRight = slideDirection === 'left'
  const fixedSign = activeOnRight ? -1 : 1
  const activeSign = activeOnRight ? 1 : -1
  const panelWidth = insideWidth * 0.54
  const panelHeight = leafHeight
  const closedActiveX = activeSign * insideWidth * 0.23
  const fixedX = fixedSign * insideWidth * 0.23
  const frontZ = leafDepth / 2 + 0.016
  const backZ = -leafDepth / 2 - 0.006
  const railY = leafCenterY + panelHeight / 2 - Math.min(frameThickness * 0.35, 0.02)
  const handleY = handleHeight - doorHeight / 2
  // Active panel + handle ride the SLIDING_ACTIVE_PANEL group, built at the
  // closed position; `poseDoorMovingParts` slides the group behind the fixed
  // panel. The fixed panel and rails stay static on the mesh.
  const handleX = closedActiveX + activeSign * (panelWidth / 2 - 0.06)

  currentDoorSlot = 'hardware'
  addBox(
    mesh,
    hardwareMaterial,
    insideWidth,
    0.024,
    Math.max(frameDepth * 0.32, 0.026),
    0,
    railY,
    0,
  )
  addBox(
    mesh,
    hardwareMaterial,
    insideWidth,
    0.018,
    Math.max(frameDepth * 0.28, 0.022),
    0,
    -leafHeight / 2 + 0.04,
    0,
  )

  const addFixedPanelBox = (
    material: THREE.Material,
    w: number,
    h: number,
    d: number,
    x: number,
    y: number,
    z: number,
  ) => addBox(mesh, material, w, h, d, x + fixedX, y, z + backZ)

  const activePanelGroup = new THREE.Group()
  activePanelGroup.name = SLIDING_ACTIVE_PANEL_NAME
  mesh.add(activePanelGroup)

  const addActivePanelBox = (
    material: THREE.Material,
    w: number,
    h: number,
    d: number,
    x: number,
    y: number,
    z: number,
  ) => addBox(activePanelGroup, material, w, h, d, x + closedActiveX, y, z + frontZ)

  addLeafSegmentContent({
    addLeafBox: addFixedPanelBox,
    leafWidth: panelWidth,
    leafHeight: panelHeight,
    leafCenterX: 0,
    leafCenterY,
    leafDepth,
    segments,
    contentPadding,
    keepFrameWhenEmpty: true,
  })
  addLeafSegmentContent({
    addLeafBox: addActivePanelBox,
    leafWidth: panelWidth,
    leafHeight: panelHeight,
    leafCenterX: 0,
    leafCenterY,
    leafDepth,
    segments,
    contentPadding,
    keepFrameWhenEmpty: true,
  })
  currentDoorSlot = 'hardware'
  addBox(
    activePanelGroup,
    hardwareMaterial,
    0.032,
    0.24,
    0.016,
    handleX,
    handleY,
    frontZ + leafDepth / 2 + 0.01,
  )
  addBox(
    activePanelGroup,
    hardwareMaterial,
    0.032,
    0.24,
    0.016,
    handleX,
    handleY,
    frontZ - leafDepth / 2 - 0.01,
  )
}

function addGarageSectionalDoor(
  mesh: THREE.Mesh,
  {
    insideWidth,
    leafHeight,
    leafCenterY,
    leafDepth,
    frameThickness,
    frameDepth,
    garagePanelCount,
  }: {
    insideWidth: number
    leafHeight: number
    leafCenterY: number
    leafDepth: number
    frameThickness: number
    frameDepth: number
    garagePanelCount: number
  },
) {
  const panelCount = Math.max(3, Math.min(12, Math.round(garagePanelCount)))
  const panelHeight = leafHeight / panelCount
  const panelGap = Math.min(0.012, panelHeight * 0.08)
  const travelDepth = Math.max(leafHeight, 1.4)
  const railY = leafCenterY + leafHeight / 2 - 0.04
  const railZ = -travelDepth / 2

  currentDoorSlot = 'hardware'
  addBox(
    mesh,
    hardwareMaterial,
    0.035,
    Math.max(0.04, frameThickness * 0.75),
    travelDepth,
    -insideWidth / 2 + 0.035,
    railY,
    railZ,
  )
  addBox(
    mesh,
    hardwareMaterial,
    0.035,
    Math.max(0.04, frameThickness * 0.75),
    travelDepth,
    insideWidth / 2 - 0.035,
    railY,
    railZ,
  )

  // Each panel is built flat (centred at its group origin) and the trims sit on
  // the panel's front face in local space; `poseDoorMovingParts` rides each
  // group along the overhead curve. Panel order, geometry and trim placement
  // match the inline curve math (which the pose function reuses).
  const revealOffset = (panelHeight - panelGap) * 0.22
  const trimDepth = 0.01
  const trimFaceOffset = leafDepth / 2 + trimDepth + 0.006
  for (let index = 0; index < panelCount; index++) {
    const group = new THREE.Group()
    group.name = `${SECTIONAL_PANEL_NAME}${index}`
    mesh.add(group)

    currentDoorSlot = 'panel'
    addBox(
      group,
      baseMaterial,
      insideWidth,
      Math.max(0.04, panelHeight - panelGap),
      leafDepth,
      0,
      0,
      0,
    )
    currentDoorSlot = undefined
    addBox(
      group,
      revealMaterial,
      insideWidth - 0.16,
      0.012,
      trimDepth,
      0,
      revealOffset,
      trimFaceOffset,
    )
    addBox(
      group,
      revealMaterial,
      insideWidth - 0.16,
      0.012,
      trimDepth,
      0,
      -revealOffset,
      trimFaceOffset,
    )
  }

  currentDoorSlot = 'hardware'
  addBox(mesh, hardwareMaterial, insideWidth, 0.032, Math.max(frameDepth * 0.36, 0.03), 0, railY, 0)
}

function addGarageRollupDoor(
  mesh: THREE.Mesh,
  {
    insideWidth,
    leafHeight,
    leafCenterY,
    leafDepth,
    frameThickness,
    frameDepth,
    operationState,
  }: {
    insideWidth: number
    leafHeight: number
    leafCenterY: number
    leafDepth: number
    frameThickness: number
    frameDepth: number
    operationState: number
  },
) {
  const openAmount = clampDoorOperationState(operationState)
  const slatHeight = Math.max(0.055, Math.min(0.11, leafHeight / 22))
  const visibleHeight = leafHeight * (1 - openAmount)
  const visibleSlatCount = Math.ceil(visibleHeight / slatHeight)
  const topY = leafCenterY + leafHeight / 2
  const drumMaxRadius = Math.max(0.12, Math.min(0.22, leafHeight * 0.075))
  const drumY = topY + drumMaxRadius * 0.12
  const drumZ = -frameDepth / 2 - drumMaxRadius * 0.72

  currentDoorSlot = 'hardware'
  addBox(
    mesh,
    hardwareMaterial,
    0.032,
    leafHeight,
    Math.max(frameDepth * 0.48, 0.035),
    -insideWidth / 2 + 0.03,
    leafCenterY,
    0,
  )
  addBox(
    mesh,
    hardwareMaterial,
    0.032,
    leafHeight,
    Math.max(frameDepth * 0.48, 0.035),
    insideWidth / 2 - 0.03,
    leafCenterY,
    0,
  )

  if (visibleHeight > 0.01) {
    // Wrap the visible curtain in a group pivoted at the lintel (topY). The live
    // door keeps rebuilding the full slat detail per `operationState` (this group
    // is just an organisational wrapper at scale 1 — world positions unchanged),
    // but it gives the GLB exporter a single node to scale up into the header as
    // an open clip, since the slats can't literally vanish in a glTF animation.
    const curtain = new THREE.Group()
    curtain.name = ROLLUP_CURTAIN_NAME
    curtain.position.set(0, topY, 0)
    mesh.add(curtain)

    currentDoorSlot = 'panel'
    addBox(curtain, baseMaterial, insideWidth, visibleHeight, leafDepth, 0, -visibleHeight / 2, 0)

    currentDoorSlot = undefined
    for (let index = 0; index < visibleSlatCount; index++) {
      const y = -Math.min(visibleHeight, index * slatHeight)
      addBox(curtain, revealMaterial, insideWidth - 0.08, 0.01, 0.012, 0, y, leafDepth / 2 + 0.012)
    }

    addBox(
      curtain,
      revealMaterial,
      insideWidth - 0.04,
      0.028,
      leafDepth + 0.018,
      0,
      -visibleHeight,
      leafDepth / 2 + 0.004,
    )
  }

  currentDoorSlot = 'panel'
  const drum = new THREE.Mesh(
    new THREE.CylinderGeometry(drumMaxRadius, drumMaxRadius, insideWidth + frameThickness, 36),
    baseMaterial,
  )
  drum.position.set(0, drumY, drumZ)
  drum.rotation.z = Math.PI / 2
  tagDoorSlot(drum)
  mesh.add(drum)

  currentDoorSlot = 'hardware'
  addBox(
    mesh,
    hardwareMaterial,
    insideWidth + frameThickness,
    0.026,
    Math.max(frameDepth * 0.52, 0.04),
    0,
    topY + 0.02,
    0,
  )
}

function addGarageTiltupDoor(
  mesh: THREE.Mesh,
  {
    insideWidth,
    leafHeight,
    leafCenterY,
    leafDepth,
    frameThickness,
    frameDepth,
  }: {
    insideWidth: number
    leafHeight: number
    leafCenterY: number
    leafDepth: number
    frameThickness: number
    frameDepth: number
  },
) {
  const hingeY = leafCenterY + leafHeight / 2
  // Leaf built closed (hanging from the lintel); `poseDoorMovingParts` rotates
  // the group about the top hinge to open it. Rails + top bar stay static.
  const panelCenterY = hingeY - leafHeight / 2
  const railLength = Math.max(leafHeight * 0.72, 1.2)
  const railY = hingeY - frameThickness * 0.35
  const railZ = -railLength / 2

  currentDoorSlot = 'hardware'
  addBox(
    mesh,
    hardwareMaterial,
    0.03,
    Math.max(frameThickness * 0.7, 0.035),
    railLength,
    -insideWidth / 2 + 0.04,
    railY,
    railZ,
  )
  addBox(
    mesh,
    hardwareMaterial,
    0.03,
    Math.max(frameThickness * 0.7, 0.035),
    railLength,
    insideWidth / 2 - 0.04,
    railY,
    railZ,
  )

  const leafGroup = new THREE.Group()
  leafGroup.name = TILTUP_LEAF_NAME
  mesh.add(leafGroup)

  currentDoorSlot = 'panel'
  addBox(leafGroup, baseMaterial, insideWidth, leafHeight, leafDepth, 0, panelCenterY, 0)

  const insetWidth = Math.max(0.1, insideWidth - 0.22)
  const insetHeight = Math.max(0.1, leafHeight - 0.28)
  const trimDepth = 0.012
  const trimFaceOffset = leafDepth / 2 + trimDepth + 0.006
  const addTiltupTrim = (localX: number, localY: number, trimWidth: number, trimHeight: number) => {
    currentDoorSlot = undefined
    addBox(
      leafGroup,
      revealMaterial,
      trimWidth,
      trimHeight,
      trimDepth,
      localX,
      panelCenterY + localY,
      trimFaceOffset,
    )
  }

  addTiltupTrim(0, insetHeight / 2, insetWidth, 0.018)
  addTiltupTrim(0, -insetHeight / 2, insetWidth, 0.018)
  addTiltupTrim(-insetWidth / 2, 0, 0.018, insetHeight)
  addTiltupTrim(insetWidth / 2, 0, 0.018, insetHeight)

  currentDoorSlot = 'hardware'
  addBox(
    mesh,
    hardwareMaterial,
    insideWidth,
    0.026,
    Math.max(frameDepth * 0.4, 0.035),
    0,
    hingeY,
    0,
  )
}

function getEffectiveOpeningShape(node: DoorNode): DoorNode['openingShape'] {
  return node.doorType === 'folding' ||
    node.doorType === 'pocket' ||
    node.doorType === 'barn' ||
    node.doorType === 'sliding'
    ? 'rectangle'
    : (node.openingShape ?? 'rectangle')
}

function updateDoorMesh(rawNode: DoorNode, mesh: THREE.Mesh) {
  const node = normalizeDoorNodeForRender(rawNode)
  currentDoorSlot = undefined

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
    disposeObject(child)
    mesh.remove(child)
  }

  // Point the builder-facing materials at this door's slot overrides for the
  // duration of its build (recomputed per node, so the next door resets cleanly
  // without a restore). Reveal keeps its own material.
  baseMaterial = resolveDoorSlotMaterial(node, 'panel')
  frameMaterial = resolveDoorSlotMaterial(node, 'frame')
  glassMaterial = resolveDoorSlotMaterial(node, 'glass')
  hardwareMaterial = resolveDoorSlotMaterial(node, 'hardware')

  const {
    width,
    height,
    openingKind,
    openingShape: rawOpeningShape,
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
    swingDirection,
    swingAngle: nodeSwingAngle = 0,
    doorType = 'hinged',
    operationState: nodeOperationState = 0,
    leafCount = 1,
    slideDirection = 'left',
    garagePanelCount = 4,
  } = node
  const openingShape = getEffectiveOpeningShape(node) ?? rawOpeningShape
  const runtimeDoorState = useInteractive.getState().doors[node.id]
  const swingAngle = runtimeDoorState?.swingAngle ?? nodeSwingAngle
  const operationState = runtimeDoorState?.operationState ?? nodeOperationState
  const clampedSwingAngle = Math.max(0, Math.min(Math.PI / 2, swingAngle))

  if (openingKind === 'opening') {
    syncDoorCutout(node, mesh)
    return
  }

  const insideWidth = width - 2 * frameThickness
  const leafH = height - frameThickness // only top frame
  const leafDepth = 0.04
  const leafCenterY = -frameThickness / 2
  const swingDirectionSign = swingDirection === 'inward' ? 1 : -1

  // ── Frame members ──
  currentDoorSlot = 'frame'
  if (openingShape === 'arch') {
    const frameBottom = -height / 2
    const frameTop = height / 2
    const frameArchHeight = getClampedArchHeight(width, height, node.archHeight)
    const frameSpringY = frameTop - frameArchHeight
    const frameInnerTopY = frameTop - frameThickness
    const frameInnerSpringY = Math.min(frameSpringY + frameThickness, frameInnerTopY)
    const useShallowHeadBar = frameArchHeight <= frameThickness * 2
    const frameHeadBottomY = useShallowHeadBar ? frameSpringY - frameThickness : frameSpringY
    const postHeight = Math.max(frameHeadBottomY - frameBottom, 0.01)

    addBox(
      mesh,
      frameMaterial,
      frameThickness,
      postHeight,
      frameDepth,
      -width / 2 + frameThickness / 2,
      frameBottom + postHeight / 2,
      0,
    )
    addBox(
      mesh,
      frameMaterial,
      frameThickness,
      postHeight,
      frameDepth,
      width / 2 - frameThickness / 2,
      frameBottom + postHeight / 2,
      0,
    )
    addShape(
      mesh,
      frameMaterial,
      useShallowHeadBar
        ? createArchHeadBarShape(width, frameHeadBottomY, frameSpringY, frameTop)
        : createArchBandShape(
            width,
            frameSpringY,
            frameTop,
            frameInnerSpringY,
            frameInnerTopY,
            frameThickness,
          ),
      frameDepth,
    )
  } else if (openingShape === 'rounded') {
    addShape(
      mesh,
      frameMaterial,
      createRoundedDoorFrameShape(
        width,
        height,
        frameThickness,
        getDoorTopRadii(node, width, height),
      ),
      frameDepth,
    )
  } else {
    // Left post — full height
    addBox(
      mesh,
      frameMaterial,
      frameThickness,
      height,
      frameDepth,
      -width / 2 + frameThickness / 2,
      0,
      0,
    )
    // Right post — full height
    addBox(
      mesh,
      frameMaterial,
      frameThickness,
      height,
      frameDepth,
      width / 2 - frameThickness / 2,
      0,
      0,
    )
    // Head (top bar) — full width
    addBox(
      mesh,
      frameMaterial,
      width,
      frameThickness,
      frameDepth,
      0,
      height / 2 - frameThickness / 2,
      0,
    )
  }

  // ── Threshold (inside the frame) ──
  if (threshold) {
    currentDoorSlot = 'frame'
    addBox(
      mesh,
      frameMaterial,
      insideWidth,
      thresholdHeight,
      frameDepth,
      0,
      -height / 2 + thresholdHeight / 2,
      0,
    )
  }

  if (doorType === 'garage-sectional') {
    addGarageSectionalDoor(mesh, {
      insideWidth,
      leafHeight: leafH,
      leafCenterY,
      leafDepth,
      frameThickness,
      frameDepth,
      garagePanelCount,
    })
  } else if (doorType === 'garage-rollup') {
    addGarageRollupDoor(mesh, {
      insideWidth,
      leafHeight: leafH,
      leafCenterY,
      leafDepth,
      frameThickness,
      frameDepth,
      operationState,
    })
  } else if (doorType === 'garage-tiltup') {
    addGarageTiltupDoor(mesh, {
      insideWidth,
      leafHeight: leafH,
      leafCenterY,
      leafDepth,
      frameThickness,
      frameDepth,
    })
  } else if (doorType === 'folding') {
    addFoldingDoor(mesh, {
      insideWidth,
      leafHeight: leafH,
      leafCenterY,
      leafDepth,
      frameThickness,
      frameDepth,
      leafCount,
      doorHeight: height,
      handleHeight,
      segments,
      contentPadding,
    })
  } else if (doorType === 'pocket') {
    addPocketDoor(mesh, {
      insideWidth,
      leafHeight: leafH,
      leafCenterY,
      leafDepth,
      frameThickness,
      frameDepth,
      slideDirection,
      doorHeight: height,
      handleHeight,
      segments,
      contentPadding,
    })
  } else if (doorType === 'barn') {
    addBarnDoor(mesh, {
      insideWidth,
      leafHeight: leafH,
      leafCenterY,
      leafDepth,
      frameThickness,
      frameDepth,
      slideDirection,
      doorHeight: height,
      handleHeight,
      segments,
      contentPadding,
    })
  } else if (doorType === 'sliding') {
    addSlidingDoor(mesh, {
      insideWidth,
      leafHeight: leafH,
      leafCenterY,
      leafDepth,
      frameThickness,
      frameDepth,
      slideDirection,
      doorHeight: height,
      handleHeight,
      segments,
      contentPadding,
    })
  } else if (doorType === 'double' || doorType === 'french') {
    const doubleLeafW = insideWidth / 2
    const fullLeafTopRadii = getDoorTopRadii(node, insideWidth, leafH)
    const roundedBoundary =
      openingShape === 'rounded'
        ? {
            fullLeft: -insideWidth / 2,
            fullRight: insideWidth / 2,
            radii: fullLeafTopRadii,
          }
        : undefined
    addDoorLeaf(mesh, {
      leafWidth: doubleLeafW,
      leafHeight: leafH,
      leafCenterX: -insideWidth / 4,
      leafCenterY,
      leafDepth,
      hingeX: -insideWidth / 2,
      hingeSide: 'left',
      swingRotation: -clampedSwingAngle * swingDirectionSign,
      openRotationY: (-Math.PI / 2) * swingDirectionSign,
      segments,
      contentPadding,
      handle,
      handleBothSides: doorType === 'double' || doorType === 'french',
      handleHeight,
      handleSide: 'right',
      doorCloser,
      panicBar,
      panicBarHeight,
      doorHeight: height,
      openingShape,
      openingTopRadii:
        openingShape === 'rounded'
          ? { topLeft: fullLeafTopRadii.topLeft, topRight: 0 }
          : fullLeafTopRadii,
      archHeight: node.archHeight ?? 0.45,
      roundedBoundary,
      archOuterSide: openingShape === 'arch' ? 'left' : undefined,
    })
    addDoorLeaf(mesh, {
      leafWidth: doubleLeafW,
      leafHeight: leafH,
      leafCenterX: insideWidth / 4,
      leafCenterY,
      leafDepth,
      hingeX: insideWidth / 2,
      hingeSide: 'right',
      swingRotation: clampedSwingAngle * swingDirectionSign,
      openRotationY: (Math.PI / 2) * swingDirectionSign,
      segments,
      contentPadding,
      handle,
      handleBothSides: doorType === 'double' || doorType === 'french',
      handleHeight,
      handleSide: 'left',
      doorCloser: false,
      panicBar,
      panicBarHeight,
      doorHeight: height,
      openingShape,
      openingTopRadii:
        openingShape === 'rounded'
          ? { topLeft: 0, topRight: fullLeafTopRadii.topRight }
          : fullLeafTopRadii,
      archHeight: node.archHeight ?? 0.45,
      roundedBoundary,
      archOuterSide: openingShape === 'arch' ? 'right' : undefined,
    })
  } else {
    const hingeX = hingesSide === 'right' ? insideWidth / 2 : -insideWidth / 2
    const hingeDirectionSign = hingesSide === 'right' ? 1 : -1
    addDoorLeaf(mesh, {
      leafWidth: insideWidth,
      leafHeight: leafH,
      leafCenterX: 0,
      leafCenterY,
      leafDepth,
      hingeX,
      hingeSide: hingesSide,
      swingRotation: clampedSwingAngle * swingDirectionSign * hingeDirectionSign,
      openRotationY: (Math.PI / 2) * swingDirectionSign * hingeDirectionSign,
      segments,
      contentPadding,
      handle,
      handleBothSides: doorType === 'hinged',
      handleHeight,
      handleSide,
      doorCloser,
      panicBar,
      panicBarHeight,
      doorHeight: height,
      openingShape,
      openingTopRadii: getDoorTopRadii(node, insideWidth, leafH),
      archHeight: node.archHeight ?? 0.45,
    })
  }

  // Operation doors build their moving parts at the closed pose inside named
  // groups; reflect the door's current `operationState` by posing them. Roll-up
  // is excluded: its live rebuild already renders the open state at full detail
  // (the named curtain group is only there for the GLB exporter's scale clip).
  if (doorType !== 'garage-rollup') {
    poseDoorMovingParts(node, mesh, operationState)
  }

  syncDoorCutout(node, mesh)

  // Guard: some degenerate door configs can leave a child mesh with an
  // empty (0-vertex) geometry — e.g. a zero-area extruded leaf frame.
  // Submitting such a mesh trips a WebGPU error ("Vertex buffer slot 0
  // … was not set" on a Draw(0, …)). Hide any empty mesh so it is never
  // drawn (it would render nothing anyway).
  hideEmptyGeometryMeshes(mesh)
}

function hideEmptyGeometryMeshes(root: THREE.Object3D) {
  root.traverse((obj) => {
    const child = obj as THREE.Mesh
    if (!child.isMesh || !child.geometry) return
    const position = child.geometry.getAttribute('position')
    if (!position || position.count === 0) child.visible = false
  })
}

function syncDoorCutout(node: DoorNode, mesh: THREE.Mesh) {
  // ── Cutout: invisible raycast hit target for the whole opening ──
  let cutout = mesh.getObjectByName('cutout') as THREE.Mesh | undefined
  if (!cutout) {
    cutout = new THREE.Mesh()
    cutout.name = 'cutout'
    // The cutout (invisible) is proud of the wall on both faces, so it wins the
    // scene raycast over the wall in front of the recessed door body — making it
    // the selection AND paint hit target for the whole opening. The paint
    // capability then re-raycasts the door's parts to find the slot. Its depth
    // is snug to the wall (not 1m) so it no longer blankets the room floor in a
    // top-down view; the wall CSG ignores this depth (see getOpeningCutoutProxyDepth).
    mesh.add(cutout)
  }
  cutout.geometry.dispose()
  const depth = resolveOpeningCutoutProxyDepth(node)
  const openingShape = getEffectiveOpeningShape(node)
  if (openingShape === 'arch') {
    cutout.geometry = new THREE.ExtrudeGeometry(
      createArchShape(
        -node.width / 2,
        node.width / 2,
        -node.height / 2,
        node.height / 2,
        getClampedArchHeight(node.width, node.height, node.archHeight),
      ),
      {
        depth,
        bevelEnabled: false,
        curveSegments: 24,
      },
    )
    cutout.geometry.translate(0, 0, -depth / 2)
  } else if (openingShape === 'rounded') {
    cutout.geometry = new THREE.ExtrudeGeometry(
      createRoundedTopShape(
        -node.width / 2,
        node.width / 2,
        -node.height / 2,
        node.height / 2,
        getDoorTopRadii(node, node.width, node.height),
      ),
      {
        depth,
        bevelEnabled: false,
        curveSegments: 24,
      },
    )
    cutout.geometry.translate(0, 0, -depth / 2)
  } else {
    cutout.geometry = new THREE.BoxGeometry(node.width, node.height, depth)
  }
  cutout.visible = false
}

// Resolve the cutout proxy depth from the opening's parent wall thickness so
// the proxy stays proud of both wall faces (front/back selection) without the
// old 1m depth that blanketed the floor. Falls back to the default thickness
// when the parent wall isn't a resolvable wall node.
function resolveOpeningCutoutProxyDepth(node: DoorNode): number {
  const parentId = node.parentId
  const parent = parentId ? useScene.getState().nodes[parentId as AnyNodeId] : undefined
  const wallThickness =
    parent?.type === 'wall' ? getWallThickness(parent as WallNode) : DEFAULT_WALL_THICKNESS
  return getOpeningCutoutProxyDepth(wallThickness)
}

/**
 * Build a fresh door mesh for preview/ghost rendering.
 * Returns a mesh with an invisible hitbox root and visible children (frame, panels, hardware).
 */
export function buildDoorPreviewMesh(node: DoorNode): THREE.Mesh {
  const mesh = new THREE.Mesh()
  updateDoorMesh(node, mesh)
  return mesh
}
