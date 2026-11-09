import {
  type AnyNodeId,
  clampDoorOperationState,
  DEFAULT_WALL_THICKNESS,
  type DoorNode,
  DoorNode as DoorNodeSchema,
  doorHandleStyle,
  getDoorOpeningSize,
  getDoorRenderOpenAmount,
  getEffectiveNode,
  getOpeningWallPlacement,
  getWallThickness,
  nodeRegistry,
  resolveOpeningCasingHost,
  resolveOpeningFrameDepth,
  type SceneMaterial,
  type SceneMaterialId,
  sceneRegistry,
  scriptedSize,
  useInteractive,
  useLiveNodeOverrides,
  useScene,
  type WallNode,
} from '@pascal-app/core'
import { doorStyleLook, doorStylesOf, isLegacyDefaultDoorLook } from '@pascal-app/core/building'
import { useFrame } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { applyWorldScaleBoxUVs } from '../../lib/box-uv'
import {
  flushPull,
  hingeJambPart,
  hingeLeafPart,
  knobOnRose,
  leverOnPlate,
  leverOnRose,
  leverOnRoseCurved,
  pullBar,
  roller,
  roundedBox,
  sphere,
  tube,
} from '../../lib/hardware-geometry'
import {
  type ColorPreset,
  createDefaultMaterial,
  createMaterial,
  createSurfaceRoleMaterial,
  glassMaterial as defaultGlassMaterial,
  baseMaterial as getBaseMaterial,
  type RenderShading,
  resolveMaterialRef,
} from '../../lib/materials'
import { timeSpan } from '../../lib/perf-tracks'
import { settleScriptedOpening } from '../../lib/scripted-opening'
import useViewer from '../../store/use-viewer'
import { buildOpeningCasingMeshes } from '../wall/opening-casing-geometry'
import { getOpeningCutoutProxyDepth } from '../wall/opening-cutout-geometry'
import { buildPanelField, panelProfile } from './leaf-profile'

// Invisible material for root mesh — used as selection hitbox only
const hitboxMaterial = new THREE.MeshBasicMaterial({ visible: false })
const defaultRevealMaterial = new THREE.MeshBasicMaterial({ color: '#7f766c' })
// Door hardware (handle / hinges / closer / panic bar) renders a catalog metal
// finish by default (chrome), separate from the door body. The flat material is
// only a fallback if the catalog ref ever fails to resolve.
const HARDWARE_DEFAULT_REF = 'library:metal-chrome'
// Door body defaults to a catalog colour (generic approach). Glass keeps the
// built-in FrontSide glass material. Glass overrides must also stay FrontSide:
// DoubleSide glass poisons the WebGPU MRT scene pass.
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
    // Doors mid-swing rebuild every tick via their `doorAnimations` entry —
    // the tween is a needs-frame signal, not dirty-set work (the set must be
    // able to reach zero while an animation runs).
    const animatingDoorIds = Object.keys(useInteractive.getState().doorAnimations) as AnyNodeId[]
    if (dirtyNodes.size === 0 && animatingDoorIds.length === 0) return
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
    for (const id of animatingDoorIds) {
      if (nodes[id]?.type === 'door' && !dirtyDoorIds.includes(id)) dirtyDoorIds.push(id)
    }

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
      const built = timeSpan('door', () => updateDoorMesh(effectiveNode, mesh), {
        properties: [['node', id]],
      })
      // A scripted opening stays dirty until its artifact has loaded.
      if (!built) continue
      clearDirty(id as AnyNodeId)
      rebuiltDoorsThisFrame += 1

      // Rebuild the parent wall so its cutout reflects the updated door geometry
      // Avoid triggering expensive wall CSG rebuilds while the door is being interactively moved/duplicated.
      // The editor tools will request a final wall rebuild on commit.
      const metadata = effectiveNode.metadata as Record<string, unknown> | null
      const deferParentRebuild = !!metadata?.isTransient || !!metadata?.deferParentRebuild
      if (!deferParentRebuild && effectiveNode.parentId) {
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
// only) → the door-wide `material` for the body (panel and frame; glass and
// hardware keep their own finish) → the body/glass/hardware default.
// Textures-off ignores overrides — the monochrome escape hatch.
function resolveDoorSlotMaterial(node: DoorNode, slotId: DoorMaterialSlotId): THREE.Material {
  const fallback = doorSlotDefault(slotId)
  if (!currentTextures) return fallback
  const ref = node.slots?.[slotId]
  const painted = ref ? resolveMaterialRef(ref, currentSceneMaterials, currentShading) : null
  if (painted) return painted
  if (node.material && (slotId === 'panel' || slotId === 'frame')) {
    return createMaterial(node.material, currentShading)
  }
  return fallback
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
  customGeometry?: THREE.BufferGeometry,
) {
  const geometry =
    customGeometry ??
    (currentDoorSlot === 'hardware' ? roundedBox(w, h, d) : new THREE.BoxGeometry(w, h, d))
  if (geometry instanceof THREE.BoxGeometry && !geometry.userData.shared) {
    applyWorldScaleBoxUVs(geometry, w, h, d)
  }
  const m = new THREE.Mesh(geometry, material)
  m.position.set(x, y, z)
  tagDoorSlot(m)
  parent.add(m)
  return m
}

function addHardware(
  parent: THREE.Object3D,
  geometry: THREE.BufferGeometry,
  x: number,
  y: number,
  z: number,
) {
  const part = new THREE.Mesh(geometry, hardwareMaterial)
  part.userData.slotId = 'hardware'
  part.position.set(x, y, z)
  parent.add(part)
  return part
}

function addPulls(
  parent: THREE.Object3D,
  x: number,
  y: number,
  faceZ: number,
  centerZ = 0,
  recessed = false,
) {
  for (const face of [-1, 1]) {
    const pull = addHardware(
      parent,
      recessed ? flushPull() : pullBar(),
      x,
      y,
      centerZ + face * faceZ,
    )
    if (face < 0) pull.rotateY(Math.PI)
  }
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
  rotationZ: number,
) {
  const geometry = new THREE.BoxGeometry(w, h, d)
  applyWorldScaleBoxUVs(geometry, w, h, d)
  const m = new THREE.Mesh(geometry, material)
  m.position.set(x, y, z)
  m.rotation.z = rotationZ
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
    if (child instanceof THREE.Mesh && !child.geometry.userData.shared) child.geometry.dispose()
  })
}

function addLeafSegmentContent({
  addLeafBox: buildLeafBox,
  addLeafShape,
  leafWidth,
  leafHeight,
  leafCenterX,
  leafCenterY,
  leafDepth,
  segments,
  contentPadding,
  keepFrameWhenEmpty = false,
  flushPullAt,
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
    geometry?: THREE.BufferGeometry,
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
  flushPullAt?: { x: number; y: number }
  renderPerimeterFrame?: boolean
  openingShape?: DoorNode['openingShape']
  openingTopRadii?: TopCornerRadii
  archHeight?: number
  archOuterSide?: 'left' | 'right'
}) {
  leafWidth = Math.max(0.001, leafWidth - 0.006)
  leafHeight = Math.max(0.001, leafHeight - 0.006)
  let pullFaceZ = leafDepth / 2
  const addLeafBox: typeof buildLeafBox = (material, w, h, d, x, y, z, geometry) => {
    if (geometry) {
      if (flushPullAt) {
        geometry.computeBoundingBox()
        pullFaceZ = Math.max(pullFaceZ, geometry.boundingBox!.max.z)
      }
      return buildLeafBox(material, w, h, d, x, y, z, geometry)
    }
    if (!flushPullAt) return buildLeafBox(material, w, h, d, x, y, z)
    const left = x - w / 2
    const right = x + w / 2
    const bottom = y - h / 2
    const top = y + h / 2
    const cutLeft = Math.max(left, flushPullAt.x - 0.02)
    const cutRight = Math.min(right, flushPullAt.x + 0.02)
    const cutBottom = Math.max(bottom, flushPullAt.y - 0.06)
    const cutTop = Math.min(top, flushPullAt.y + 0.06)
    if (cutLeft >= cutRight || cutBottom >= cutTop) {
      return buildLeafBox(material, w, h, d, x, y, z)
    }
    pullFaceZ = Math.max(pullFaceZ, Math.abs(z) + d / 2)
    for (const [l, r, b, t] of [
      [left, cutLeft, bottom, top],
      [cutRight, right, bottom, top],
      [cutLeft, cutRight, bottom, cutBottom],
      [cutLeft, cutRight, cutTop, top],
    ] as const) {
      if (r > l && t > b) buildLeafBox(material, r - l, t - b, d, (l + r) / 2, (b + t) / 2, z)
    }
  }
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
        const dividerDepth = seg.type === 'panel' ? leafDepth : leafDepth + 0.001
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
          addLeafShape(baseMaterial, dividerShape, dividerDepth)
        } else {
          addLeafBox(
            baseMaterial,
            seg.dividerThickness,
            segH,
            dividerDepth,
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
        currentDoorSlot = 'panel'
        const beadWidth = Math.min(0.012, colW / 4, segH / 4)
        if (glassShape && addLeafShape) {
          const bead = glassShape.clone()
          const hole = createTopClippedRectShape(
            segmentLeft + beadWidth,
            segmentRight - beadWidth,
            segBottom + beadWidth,
            segTop - beadWidth,
            (x) => topBoundaryAtX(x) - beadWidth,
          )
          if (hole) bead.holes.push(shapeToReversedPath(hole))
          addLeafShape(baseMaterial, bead, leafDepth + 0.012)
        } else {
          for (const face of [-1, 1])
            for (const side of [-1, 1]) {
              const z = face * (leafDepth / 2 + 0.003)
              addLeafBox(
                baseMaterial,
                colW,
                beadWidth,
                0.006,
                colX,
                segCenterY + (side * (segH - beadWidth)) / 2,
                z,
              )
              addLeafBox(
                baseMaterial,
                beadWidth,
                segH - 2 * beadWidth,
                0.006,
                colX + (side * (colW - beadWidth)) / 2,
                segCenterY,
                z,
              )
            }
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

        const panelW = colW - 2 * seg.panelInset
        const panelH = segH - 2 * seg.panelInset
        if (panelW <= 0.01 || panelH <= 0.01 || seg.panelDepth === 0) {
          if (outerPanelShape && addLeafShape)
            addLeafShape(baseMaterial, outerPanelShape, leafDepth)
          else addLeafBox(baseMaterial, colW, segH, leafDepth, colX, segCenterY, 0)
          continue
        }
        const fieldShape = createTopClippedRectShape(
          colX - panelW / 2,
          colX + panelW / 2,
          segBottom + seg.panelInset,
          segTop - seg.panelInset,
          hasShapedTop ? topBoundaryAtX : () => segTop,
        )
        if (!fieldShape) continue
        if (outerPanelShape && addLeafShape) {
          outerPanelShape.holes.push(shapeToReversedPath(fieldShape))
          addLeafShape(baseMaterial, outerPanelShape, leafDepth)
        } else {
          for (const side of [-1, 1]) {
            addLeafBox(
              baseMaterial,
              colW,
              seg.panelInset,
              leafDepth,
              colX,
              segCenterY + (side * (segH - seg.panelInset)) / 2,
              0,
            )
            addLeafBox(
              baseMaterial,
              seg.panelInset,
              panelH,
              leafDepth,
              colX + (side * (colW - seg.panelInset)) / 2,
              segCenterY,
              0,
            )
          }
        }
        addLeafBox(
          baseMaterial,
          panelW,
          panelH,
          leafDepth,
          0,
          0,
          0,
          buildPanelField(
            fieldShape.getPoints(),
            leafDepth,
            seg.panelDepth,
            seg.panelInset,
            flushPullAt,
          ),
        )
      }
    }

    segY -= segH
  }
  return pullFaceZ
}

function addDoorLeaf(
  mesh: THREE.Mesh,
  {
    leafWidth,
    leafHeight,
    leafCenterX,
    leafCenterY,
    leafDepth,
    frameDepth,
    hingeX,
    hingeSide,
    swingRotation,
    openRotationY,
    segments,
    contentPadding,
    handle,
    handleStyle,
    handleBothSides = false,
    handleHeight,
    handleSide,
    doorCloser,
    panicBar,
    panicBarStyle,
    panicBarRods,
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
    frameDepth: number
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
    handleStyle: ReturnType<typeof doorHandleStyle>
    handleBothSides?: boolean
    handleHeight: number
    handleSide: DoorNode['handleSide']
    doorCloser: boolean
    panicBar: boolean
    panicBarStyle: DoorNode['panicBarStyle']
    panicBarRods: boolean
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
  const swingFace = Math.sign(openRotationY) * (hingeSide === 'right' ? 1 : -1)
  const pivotZ = (swingFace * leafDepth) / 2
  leafGroup.position.set(hingeX, 0, pivotZ)
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
    geometry?: THREE.BufferGeometry,
  ) => addBox(leafGroup, material, w, h, d, x - hingeX, y, z - pivotZ, geometry)
  const addLeafShape = (material: THREE.Material, shape: THREE.Shape, depth: number) =>
    addShapeAt(leafGroup, material, shape, depth, -hingeX, 0, -pivotZ)

  const localLeafCenterX = leafCenterX - hingeX
  const leafBottom = leafCenterY - leafHeight / 2
  const leafTop = leafCenterY + leafHeight / 2
  const usesShapedLeafFrame = openingShape === 'rounded' || openingShape === 'arch'
  const clearLeafWidth = Math.max(0.001, leafWidth - 0.006)
  const clearLeafHeight = Math.max(0.001, leafHeight - 0.006)

  if (usesShapedLeafFrame && hasLeafContent) {
    const clearLeafBottom = leafCenterY - clearLeafHeight / 2
    const clearLeafTop = leafCenterY + clearLeafHeight / 2
    currentDoorSlot = 'panel'
    if (openingShape === 'rounded') {
      const roundedLeafShape = roundedBoundary
        ? createRoundedClippedLeafFrameShape(
            leafCenterX - clearLeafWidth / 2,
            leafCenterX + clearLeafWidth / 2,
            clearLeafBottom,
            clearLeafTop,
            roundedBoundary.fullLeft,
            roundedBoundary.fullRight,
            roundedBoundary.radii,
            contentPadding[0],
            contentPadding[1],
          )
        : createRoundedLeafFrameShape(
            clearLeafWidth,
            clearLeafBottom,
            clearLeafTop,
            openingTopRadii,
            contentPadding[0],
            contentPadding[1],
          )

      if (roundedLeafShape) {
        if (roundedBoundary) {
          addLeafShape(baseMaterial, roundedLeafShape, leafDepth)
        } else {
          addShapeAt(
            leafGroup,
            baseMaterial,
            roundedLeafShape,
            leafDepth,
            localLeafCenterX,
            0,
            -pivotZ,
          )
        }
      }
    } else if (openingShape === 'arch') {
      const archedLeafShape = archOuterSide
        ? createOneSidedArchLeafFrameShape(
            leafCenterX - clearLeafWidth / 2,
            leafCenterX + clearLeafWidth / 2,
            clearLeafBottom,
            clearLeafTop,
            archHeight,
            contentPadding[0],
            contentPadding[1],
            archOuterSide,
          )
        : archedBoundary
          ? createArchedClippedLeafFrameShape(
              leafCenterX - clearLeafWidth / 2,
              leafCenterX + clearLeafWidth / 2,
              clearLeafBottom,
              clearLeafTop,
              archedBoundary.fullLeft,
              archedBoundary.fullRight,
              archedBoundary.archHeight,
              contentPadding[0],
              contentPadding[1],
            )
          : createArchedLeafFrameShape(
              clearLeafWidth,
              clearLeafBottom,
              clearLeafTop,
              getClampedArchHeight(clearLeafWidth, clearLeafHeight, archHeight),
              contentPadding[0],
              contentPadding[1],
            )

      if (archedLeafShape) {
        if (archOuterSide || archedBoundary) {
          addLeafShape(baseMaterial, archedLeafShape, leafDepth)
        } else {
          addShapeAt(
            leafGroup,
            baseMaterial,
            archedLeafShape,
            leafDepth,
            localLeafCenterX,
            0,
            -pivotZ,
          )
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
    const handleX =
      handleSide === 'right'
        ? leafCenterX + leafWidth / 2 - 0.06
        : leafCenterX - leafWidth / 2 + 0.06
    const contentH = clearLeafHeight - 2 * contentPadding[1]
    const totalRatio = segments.reduce((sum, segment) => sum + segment.heightRatio, 0)
    let segmentTop = leafCenterY + contentH / 2
    let panelDepth = 0
    for (const segment of segments) {
      const segmentBottom = segmentTop - (contentH * segment.heightRatio) / totalRatio
      if (handleY >= segmentBottom && handleY <= segmentTop && segment.type === 'panel') {
        const contentW = clearLeafWidth - 2 * contentPadding[0]
        const sum = segment.columnRatios.reduce((a, b) => a + b, 0)
        const usableW = contentW - (segment.columnRatios.length - 1) * segment.dividerThickness
        let columnLeft = leafCenterX - contentW / 2
        for (const ratio of segment.columnRatios) {
          const columnW = (usableW * ratio) / sum
          const fieldW = columnW - 2 * segment.panelInset
          const fieldH = segmentTop - segmentBottom - 2 * segment.panelInset
          const edgeDistance = Math.min(
            fieldW / 2 - Math.abs(handleX - columnLeft - columnW / 2),
            fieldH / 2 - Math.abs(handleY - (segmentTop + segmentBottom) / 2),
          )
          if (edgeDistance > 0 && fieldW > 0.01 && fieldH > 0.01 && segment.panelDepth !== 0) {
            const profile = panelProfile(
              leafDepth,
              segment.panelDepth,
              segment.panelInset,
              fieldW,
              fieldH,
            )
            panelDepth = profile[profile.length - 1]!.depth
            for (let i = 1; i < profile.length; i++) {
              const outside = profile[i - 1]!
              const inside = profile[i]!
              if (edgeDistance <= inside.inset) {
                const t = (edgeDistance - outside.inset) / (inside.inset - outside.inset)
                panelDepth = outside.depth + t * (inside.depth - outside.depth)
                break
              }
            }
            break
          }
          columnLeft += columnW + segment.dividerThickness
        }
        break
      }
      segmentTop = segmentBottom
    }
    const faceZ = leafDepth / 2 + panelDepth
    // Panic hardware owns the push face (+z): no lever beside the bar there.
    const leverFaces = (handleBothSides ? [1, -1] : [1]).filter((face) => !(panicBar && face > 0))
    for (const face of leverFaces) {
      const lever = addHardware(
        leafGroup,
        handleStyle === 'knob'
          ? knobOnRose()
          : handleStyle === 'bar'
            ? pullBar(true)
            : handleStyle === 'plate'
              ? leverOnPlate()
              : handleStyle === 'lever-curved'
                ? leverOnRoseCurved()
                : leverOnRose(),
        handleX - hingeX,
        handleY,
        face * faceZ - pivotZ,
      )
      if (face < 0) lever.rotateY(Math.PI)
      const gripDirection = face * (hingeSide === 'left' ? -1 : 1)
      if (gripDirection < 0 && handleStyle !== 'bar' && handleStyle !== 'knob')
        lever.rotateZ(Math.PI)
    }
  }

  if (hasLeafContent && doorCloser) {
    currentDoorSlot = 'hardware'
    const latchSign = hingeSide === 'left' ? 1 : -1
    const offsetScale = Math.min(1, leafWidth / 0.4)
    const closerY = leafTop - 0.04
    const bodyX = hingeX + latchSign * 0.16 * offsetScale
    const pullFace = -swingFace
    const bodyZ = pullFace * (leafDepth / 2 + 0.03)
    addLeafBox(hardwareMaterial, 0.28, 0.055, 0.055, bodyX, closerY, bodyZ)
    const armY = closerY + 0.0275
    // The latch-end spindle recedes from the head shoe as the leaf opens.
    const closedPivot = new THREE.Vector3(hingeX + latchSign * 0.27 * offsetScale, armY, bodyZ)
    const closedElbow = new THREE.Vector3(
      hingeX + latchSign * 0.18 * offsetScale,
      armY,
      pullFace * (frameDepth / 2 + 0.19),
    )
    const shoe = new THREE.Vector3(
      hingeX + latchSign * 0.34 * offsetScale,
      armY,
      pullFace * (frameDepth / 2 + 0.015),
    )
    // The shoe overlaps the head face; its underside shares the body pivot's plane below the soffit.
    addHardware(mesh, roundedBox(0.09, 0.025, 0.03), shoe.x, armY + 0.0125, shoe.z)
    const pivotOffset = new THREE.Vector3(hingeX, 0, pivotZ)
    const axis = new THREE.Vector3(0, 1, 0)
    const pivot = closedPivot
      .clone()
      .sub(pivotOffset)
      .applyAxisAngle(axis, swingRotation)
      .add(pivotOffset)
    // Use the cached tubes' millimetre lengths as the actual linkage lengths.
    const l1 = Math.round(closedPivot.distanceTo(closedElbow) * 1000) / 1000
    const l2 = Math.round(shoe.distanceTo(closedElbow) * 1000) / 1000
    const delta = shoe.clone().sub(pivot)
    const distance = delta.length()
    const direction =
      distance > 1e-9 ? delta.divideScalar(distance) : new THREE.Vector3(latchSign, 0, 0)
    // Unreachable anchors keep fixed-length links collinear rather than stretching them.
    const reach = Math.max(Math.abs(l1 - l2), Math.min(l1 + l2, distance))
    const along = reach > 1e-9 ? (l1 * l1 - l2 * l2 + reach * reach) / (2 * reach) : 0
    const bow = Math.sqrt(Math.max(0, l1 * l1 - along * along))
    const normal = new THREE.Vector3(-direction.z, 0, direction.x)
    if (normal.z * pullFace < 0) normal.negate()
    const elbow = pivot.clone().addScaledVector(direction, along).addScaledVector(normal, bow)
    for (const [parent, radius, start, end] of [
      [leafGroup, 0.0075, pivot, elbow],
      [mesh, 0.006, shoe, elbow],
    ] as const) {
      const localStart = start.clone()
      const localEnd = end.clone()
      if (parent === leafGroup) {
        localStart.sub(pivotOffset).applyAxisAngle(axis, -swingRotation)
        localEnd.sub(pivotOffset).applyAxisAngle(axis, -swingRotation)
      }
      const vector = localEnd.clone().sub(localStart)
      const length = parent === leafGroup ? l1 : l2
      const center = localStart.clone().addScaledVector(vector.clone().normalize(), length / 2)
      const arm = addHardware(parent, tube(radius, length), center.x, center.y, center.z)
      arm.quaternion.setFromUnitVectors(axis, vector.normalize())
    }
    addHardware(mesh, sphere(0.009), elbow.x, elbow.y, elbow.z)
  }

  if (hasLeafContent && panicBar) {
    const barY = panicBarHeight - doorHeight / 2
    const latchSign = hingeSide === 'left' ? 1 : -1
    const latchX = leafCenterX + latchSign * (leafWidth / 2 - 0.055)
    const hingeEndX = leafCenterX - latchSign * (leafWidth / 2 - 0.04)
    const faceZ = (swingFace * leafDepth) / 2
    const device = (geometry: THREE.BufferGeometry, x: number, y: number, offFace: number) => {
      const part = addHardware(
        leafGroup,
        geometry,
        x - hingeX,
        y,
        faceZ + swingFace * offFace - pivotZ,
      )
      if (swingFace < 0) part.rotateY(Math.PI)
      return part
    }
    const touchbar = panicBarStyle === 'touchbar'
    const caseHeight = touchbar ? 0.1 : 0.07
    device(
      roundedBox(touchbar ? 0.09 : 0.075, caseHeight, touchbar ? 0.055 : 0.06),
      latchX,
      barY,
      touchbar ? 0.0275 : 0.03,
    )
    device(roundedBox(touchbar ? 0.035 : 0.04, 0.07, 0.05), hingeEndX, barY, 0.025)
    const barLength = Math.abs(latchX - hingeEndX)
    const bar = device(
      touchbar ? roundedBox(barLength, 0.06, 0.03) : tube(0.0125, barLength),
      (latchX + hingeEndX) / 2,
      barY,
      touchbar ? 0.035 : 0.045,
    )
    if (!touchbar) bar.rotateZ(Math.PI / 2)
    if (panicBarRods) {
      for (const end of [-1, 1]) {
        const latchY = end > 0 ? leafTop - 0.05 : leafBottom + 0.05
        device(roundedBox(0.035, 0.06, 0.04), latchX, latchY, 0.02)
        const startY = barY + (end * caseHeight) / 2
        const endY = latchY - end * 0.03
        const rodY = (startY + endY) / 2
        device(tube(0.006, Math.abs(endY - startY)), latchX, rodY, 0.025)
        device(roundedBox(0.03, 0.02, 0.03), latchX, rodY, 0.015)
      }
    }
  }

  if (hasLeafContent) {
    currentDoorSlot = 'hardware'
    const leafHinges = new THREE.Group()
    leafHinges.name = 'door-leaf-hinges'
    leafGroup.add(leafHinges)
    const hingeH = 0.1
    const hingeRadii = roundedBoundary?.radii ?? openingTopRadii
    const cornerDrop =
      openingShape === 'rounded'
        ? hingeSide === 'left'
          ? hingeRadii.topLeft
          : hingeRadii.topRight
        : openingShape === 'arch'
          ? getClampedArchHeight(leafWidth, leafHeight, archHeight)
          : 0
    // Hinges need their full height supported by the straight jamb below the curve.
    const straightEdgeTop = leafTop - cornerDrop
    for (const hingeY of [leafBottom + 0.25, (leafBottom + leafTop) / 2, leafTop - 0.25]) {
      if (hingeY + hingeH / 2 > straightEdgeTop + 1e-6) continue
      const jambPart = addHardware(mesh, hingeJambPart(), hingeX, hingeY, pivotZ)
      const leafPart = addHardware(leafHinges, hingeLeafPart(), 0, hingeY, 0)
      for (const part of [jambPart, leafPart]) {
        if (hingeSide === 'right') part.rotateZ(Math.PI)
        if (swingFace < 0) part.rotateX(Math.PI)
      }
    }
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

function slidingPanels(
  node: Pick<DoorNode, 'leafCount' | 'slideDirection' | 'slidingStyle'>,
  width: number,
) {
  const count = Math.max(2, Math.min(4, node.leafCount ?? 2))
  const sign = node.slideDirection === 'right' ? 1 : -1
  const pitch = width / count
  return Array.from({ length: count }, (_, index) => {
    const front =
      node.slidingStyle === 'bypass'
        ? index % 2 === (count === 3 || sign < 0 ? 1 : 0)
        : count === 4
          ? index === 1 || index === 2
          : count === 3
            ? index === 1
            : index === (sign < 0 ? 1 : 0)
    const travel = front
      ? (count === 4 && node.slidingStyle !== 'bypass' ? (index === 1 ? -1 : 1) : sign) *
        (count === 2 ? width * 0.44 : pitch)
      : 0
    return {
      index,
      front,
      travel,
      x: count === 2 ? (index === 0 ? -1 : 1) * width * 0.23 : -width / 2 + pitch * (index + 0.5),
      width: count === 2 ? width * 0.54 : pitch + 0.02,
    }
  })
}

function slidingPanelName(index: number, first: number) {
  return index === first ? SLIDING_ACTIVE_PANEL_NAME : `${SLIDING_ACTIVE_PANEL_NAME}-${index}`
}
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
      const panels = slidingPanels(node, insideWidth)
      const first = panels.find((panel) => panel.front)!.index
      let posed = false
      for (const panel of panels) {
        const group = mesh.getObjectByName(slidingPanelName(panel.index, first))
        if (!group) continue
        group.position.x = panel.travel * t
        posed = true
      }
      return posed
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
      const panelCount = node.leafCount >= 6 ? node.leafCount : node.leafCount === 2 ? 2 : 4
      const foldAngle = Math.PI * 0.44 * t
      // Each panel group is parented to the previous, so its rotation is the
      // joint angle (the change in absolute segment direction), not the absolute
      // angle: alternating panels target ∓foldAngle, so joints fold by ±2·angle.
      // The leading sign folds the leaves toward −z (matching the original rig).
      let posed = false
      let prevDirection = 0
      for (let index = 0; index < panelCount; index++) {
        const group = mesh.getObjectByName(`${FOLDING_PANEL_NAME}${index}`)
        const direction =
          (index % 2 === 0 ? -1 : 1) * (panelCount > 4 && node.slideDirection === 'right' ? -1 : 1)
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
    leafCount: DoorNode['leafCount']
    slideDirection: DoorNode['slideDirection']
    doorHeight: number
    handleHeight: number
    segments: DoorNode['segments']
    contentPadding: DoorNode['contentPadding']
  },
) {
  const panelCount = leafCount >= 6 ? leafCount : leafCount === 2 ? 2 : 4
  const sign = panelCount > 4 && slideDirection === 'right' ? -1 : 1
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
  let pullFaceZ = leafDepth / 2
  const handleY = handleHeight - doorHeight / 2
  for (let index = 0; index < panelCount; index++) {
    const group = new THREE.Group()
    group.name = `${FOLDING_PANEL_NAME}${index}`
    group.position.set(index === 0 ? (-sign * insideWidth) / 2 : sign * panelLength, 0, 0)
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
      geometry?: THREE.BufferGeometry,
    ) => addBox(group, material, w, h, d, sign * (panelLength / 2 + x), y, z, geometry)

    pullFaceZ = addLeafSegmentContent({
      addLeafBox: addFoldingLeafBox,
      flushPullAt:
        index === panelCount - 1 ? { x: panelLength / 2 - 0.035, y: handleY } : undefined,
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
      addBox(
        group,
        revealMaterial,
        0.018,
        leafHeight * 0.92,
        leafDepth + 0.016,
        sign * px,
        leafCenterY,
        0,
      )
    }

    parent = group
  }

  // Handle on the free end of the last panel (its local x=panelLength edge).
  currentDoorSlot = 'hardware'
  addPulls(parent, sign * (panelLength - 0.035), handleY, pullFaceZ, 0, true)
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
    geometry?: THREE.BufferGeometry,
  ) => addBox(leafGroup, material, w, h, d, x, y, z, geometry)

  const pullFaceZ = addLeafSegmentContent({
    addLeafBox: addPocketLeafBox,
    flushPullAt: { x: handleX, y: handleY },
    leafWidth,
    leafHeight,
    leafCenterX: 0,
    leafCenterY,
    leafDepth,
    segments,
    contentPadding,
  })
  currentDoorSlot = 'hardware'
  addPulls(leafGroup, handleX, handleY, pullFaceZ, 0, true)
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
  const wheelY = trackY + 0.035 / 2 + 0.0425

  currentDoorSlot = 'hardware'
  addBox(mesh, hardwareMaterial, railLength, 0.035, 0.035, railCenterX, trackY, faceZ + 0.01)
  for (const end of [-1, 1]) {
    addHardware(
      mesh,
      roller(0.02, 0.03),
      railCenterX + (end * railLength) / 2,
      trackY,
      faceZ + 0.01,
    )
  }

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
    geometry?: THREE.BufferGeometry,
  ) => addBox(leafGroup, material, w, h, d, x, y, faceZ + z, geometry)

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
    addHardware(leafGroup, roller(0.0425, 0.02), offset, wheelY, faceZ + 0.01)
    addBox(leafGroup, hardwareMaterial, 0.026, 0.16, 0.026, offset, wheelY - 0.075, faceZ + 0.033)
  }

  currentDoorSlot = 'hardware'
  for (const face of [-1, 1]) {
    const pull = addHardware(
      leafGroup,
      pullBar(),
      handleX,
      handleY,
      faceZ + face * (leafDepth / 2 + 0.023),
    )
    if (face < 0) pull.rotateY(Math.PI)
  }
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
    leafCount,
    slidingStyle,
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
    leafCount: DoorNode['leafCount']
    slidingStyle: DoorNode['slidingStyle']
    doorHeight: number
    handleHeight: number
    segments: DoorNode['segments']
    contentPadding: DoorNode['contentPadding']
  },
) {
  const panels = slidingPanels({ leafCount, slideDirection, slidingStyle }, insideWidth)
  const first = panels.find((panel) => panel.front)!.index
  const handleY = handleHeight - doorHeight / 2
  currentDoorSlot = 'hardware'
  addBox(
    mesh,
    hardwareMaterial,
    insideWidth,
    0.024,
    Math.max(frameDepth * 0.32, 0.026),
    0,
    leafCenterY + leafHeight / 2 - Math.min(frameThickness * 0.35, 0.02),
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
  for (const panel of panels) {
    const group = new THREE.Group()
    group.name = slidingPanelName(panel.index, first)
    mesh.add(group)
    const z = panel.front ? leafDepth / 2 + 0.016 : -leafDepth / 2 - 0.006
    const hasPull = panel.front || slidingStyle === 'bypass'
    const handleX = (slideDirection === 'left' ? 1 : -1) * (panel.width / 2 - 0.06)
    const addPanelBox = (
      material: THREE.Material,
      w: number,
      h: number,
      d: number,
      x: number,
      y: number,
      depth: number,
      geometry?: THREE.BufferGeometry,
    ) => addBox(group, material, w, h, d, x + panel.x, y, depth + z, geometry)
    currentDoorSlot = undefined
    const pullFaceZ = addLeafSegmentContent({
      addLeafBox: addPanelBox,
      ...(hasPull ? { flushPullAt: { x: handleX, y: handleY } } : {}),
      leafWidth: panel.width,
      leafHeight,
      leafCenterX: 0,
      leafCenterY,
      leafDepth,
      segments,
      contentPadding,
      keepFrameWhenEmpty: true,
    })
    if (hasPull) {
      currentDoorSlot = 'hardware'
      addPulls(group, panel.x + handleX, handleY, pullFaceZ, z, true)
    }
  }
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

    const bottomBarHeight = 0.028
    addBox(
      curtain,
      revealMaterial,
      insideWidth - 0.04,
      bottomBarHeight,
      leafDepth + 0.018,
      0,
      -visibleHeight + bottomBarHeight / 2,
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
  const size = getDoorOpeningSize(node)
  return size.width !== node.width ||
    size.height !== node.height ||
    node.doorType === 'folding' ||
    node.doorType === 'pocket' ||
    node.doorType === 'barn' ||
    node.doorType === 'sliding'
    ? 'rectangle'
    : (node.openingShape ?? 'rectangle')
}

function updateDoorMesh(rawNode: DoorNode, mesh: THREE.Mesh): boolean {
  const normalized = normalizeDoorNodeForRender(rawNode)
  currentDoorSlot = undefined

  // The frame runs through its host wall: an auto depth is the wall's thickness
  // exactly, so every builder below reads one resolved number.
  const parent = normalized.parentId
    ? useScene.getState().nodes[normalized.parentId as AnyNodeId]
    : undefined
  const wall = parent?.type === 'wall' ? getEffectiveNode(parent as WallNode) : undefined
  const node: DoorNode & { frameDepth: number } = {
    ...normalized,
    frameDepth: resolveOpeningFrameDepth(
      normalized,
      wall ? getWallThickness(wall) : DEFAULT_WALL_THICKNESS,
    ),
  }

  // Root mesh is an invisible hitbox; all visuals live in child meshes
  mesh.geometry.dispose()
  const openingSize = getDoorOpeningSize(node)
  mesh.geometry = new THREE.BoxGeometry(openingSize.width, openingSize.height, node.frameDepth)
  mesh.geometry.translate(-openingSize.leafOffsetX, (openingSize.height - node.height) / 2, 0)
  mesh.material = hitboxMaterial

  // Sync transform from node (React may lag behind the system by a frame during drag)
  const placement =
    wall && !node.roofSegmentId
      ? getOpeningWallPlacement(wall, node, useScene.getState().nodes)
      : node
  mesh.position.set(...placement.position)
  mesh.rotation.set(...placement.rotation)

  // Built from a script: the renderer shows its artifact, not the parametric
  // frame, and the hit box is what the script built.
  if (node.source) {
    mesh.geometry.dispose()
    mesh.geometry = new THREE.BoxGeometry(...scriptedSize(node.source.manifest))
    return settleScriptedOpening(mesh)
  }

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

  // The casing sits on the wall faces around the opening, whatever fills it.
  addDoorCasing(node, mesh)

  const {
    width,
    height,
    openingKind,
    openingShape: rawOpeningShape,
    frameThickness,
    frameDepth,
    threshold,
    thresholdHeight,
    segments: storedSegments,
    handle,
    handleHeight,
    handleSide,
    doorCloser,
    panicBar,
    panicBarStyle,
    panicBarRods,
    panicBarHeight,
    contentPadding: storedPadding,
    hingesSide,
    swingDirection,
    swingAngle: nodeSwingAngle = 0,
    doorType = 'hinged',
    operationState: nodeOperationState = 0,
    leafCount = 1,
    slideDirection = 'left',
    slidingStyle,
    garagePanelCount = 4,
  } = node
  const { segments, contentPadding } = isLegacyDefaultDoorLook({
    segments: storedSegments,
    contentPadding: storedPadding,
  })
    ? doorStyleLook('panel')
    : { segments: storedSegments, contentPadding: storedPadding }
  const openingShape = getEffectiveOpeningShape(node) ?? rawOpeningShape
  const runtimeDoorState = useInteractive.getState().doors[node.id]
  const swingAngle = runtimeDoorState?.swingAngle ?? nodeSwingAngle
  const operationState = runtimeDoorState?.operationState ?? nodeOperationState
  const clampedSwingAngle = Math.max(0, Math.min(Math.PI / 2, swingAngle))

  const renderContent = parent
    ? nodeRegistry.get(parent.type)?.capabilities.surfaces?.renderOpeningContent?.(parent)
    : undefined
  if (openingKind === 'opening' || renderContent === false) {
    syncDoorCutout(node, mesh)
    return true
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

  // Curved heads need a matching curved rebate; arched/rounded frames have no stop.
  if (openingShape === 'rectangle' && ['hinged', 'double', 'french'].includes(doorType)) {
    const stopZ = -swingDirectionSign * (leafDepth / 2 + 0.016)
    for (const side of [-1, 1]) {
      addBox(
        mesh,
        frameMaterial,
        0.012,
        leafH,
        0.032,
        side * (insideWidth / 2 - 0.006),
        leafCenterY,
        stopZ,
      ).name = 'door-jamb-stop'
    }
    addBox(
      mesh,
      frameMaterial,
      insideWidth - 0.024,
      0.012,
      0.032,
      0,
      height / 2 - frameThickness - 0.006,
      stopZ,
    ).name = 'door-jamb-stop'
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
      slideDirection,
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
      leafCount,
      slidingStyle,
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
      frameDepth,
      hingeX: -insideWidth / 2,
      hingeSide: 'left',
      swingRotation: -clampedSwingAngle * swingDirectionSign,
      openRotationY: (-Math.PI / 2) * swingDirectionSign,
      segments,
      contentPadding,
      handle,
      handleStyle: doorHandleStyle(node),
      handleBothSides: doorType === 'double' || doorType === 'french',
      handleHeight,
      handleSide: 'right',
      doorCloser,
      panicBar,
      panicBarStyle,
      panicBarRods,
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
      frameDepth,
      hingeX: insideWidth / 2,
      hingeSide: 'right',
      swingRotation: clampedSwingAngle * swingDirectionSign,
      openRotationY: (Math.PI / 2) * swingDirectionSign,
      segments,
      contentPadding,
      handle,
      handleStyle: doorHandleStyle(node),
      handleBothSides: doorType === 'double' || doorType === 'french',
      handleHeight,
      handleSide: 'left',
      doorCloser: false,
      panicBar,
      panicBarStyle,
      panicBarRods,
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
      frameDepth,
      hingeX,
      hingeSide: hingesSide,
      swingRotation: clampedSwingAngle * swingDirectionSign * hingeDirectionSign,
      openRotationY: (Math.PI / 2) * swingDirectionSign * hingeDirectionSign,
      segments,
      contentPadding,
      handle,
      handleStyle: doorHandleStyle(node),
      handleBothSides: doorType === 'hinged',
      handleHeight,
      handleSide,
      doorCloser,
      panicBar,
      panicBarStyle,
      panicBarRods,
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

  addDoorFixedLights(node, mesh)
  syncDoorCutout(node, mesh)

  // Guard: some degenerate door configs can leave a child mesh with an
  // empty (0-vertex) geometry — e.g. a zero-area extruded leaf frame.
  // Submitting such a mesh trips a WebGPU error ("Vertex buffer slot 0
  // … was not set" on a Draw(0, …)). Hide any empty mesh so it is never
  // drawn (it would render nothing anyway).
  hideEmptyGeometryMeshes(mesh)
  return true
}

function hideEmptyGeometryMeshes(root: THREE.Object3D) {
  root.traverse((obj) => {
    const child = obj as THREE.Mesh
    if (!(child.isMesh && child.geometry)) return
    const position = child.geometry.getAttribute('position')
    if (!position || position.count === 0) child.visible = false
  })
}

/**
 * The door's casing (head and legs) on the faces of its wall (or gable) around
 * the cutout, inheriting the frame until each side is painted. Read from the live host, so it stays on
 * the faces while the wall's thickness is dragged.
 */
function addDoorCasing(node: DoorNode, mesh: THREE.Mesh) {
  const nodes = useScene.getState().nodes
  const hostId = node.roofSegmentId ?? node.parentId
  const hostNode = hostId ? nodes[hostId as AnyNodeId] : undefined
  const host = resolveOpeningCasingHost(
    node,
    nodes,
    hostNode ? getEffectiveNode(hostNode) : undefined,
  )
  if (!host) return
  for (const casing of buildOpeningCasingMeshes(node, host, frameMaterial)) {
    const ref = node.slots?.[casing.userData.slotId]
    casing.material =
      (currentTextures && ref
        ? resolveMaterialRef(ref, currentSceneMaterials, currentShading)
        : null) ?? frameMaterial
    mesh.add(casing)
  }
}

function addDoorFixedLights(node: DoorNode & { frameDepth: number }, mesh: THREE.Mesh) {
  const size = getDoorOpeningSize(node)
  if (size.width === node.width && size.height === node.height) return
  const group = new THREE.Group()
  group.name = 'door-fixed-lights'
  mesh.add(group)
  const f = node.frameThickness
  const bottom = -node.height / 2
  const top = bottom + size.height
  const left = -size.width / 2 - size.leafOffsetX
  const right = left + size.width
  const box = (slot: 'frame' | 'glass' | 'panel', w: number, h: number, x: number, y: number) => {
    if (w <= 0 || h <= 0) return
    currentDoorSlot = slot
    addBox(
      group,
      slot === 'glass' ? glassMaterial : slot === 'panel' ? baseMaterial : frameMaterial,
      w,
      h,
      slot === 'glass' ? 0.008 : node.frameDepth,
      x,
      y,
      0,
    )
  }
  const paneled = doorStylesOf(node).includes('paneled-glass')
  for (const [side, extra] of [
    [-1, node.sidelightLeft ?? 0],
    [1, node.sidelightRight ?? 0],
  ] as const) {
    if (!extra) continue
    const outerX = side < 0 ? left + f / 2 : right - f / 2
    box('frame', f, node.height, outerX, 0)
    const x = side * (node.width / 2 + extra / 2 - f / 2)
    const w = extra - f
    const glassBottom = bottom + (paneled ? 0.3 : f)
    const glassTop = node.height / 2 - f
    box('frame', extra, f, side * (node.width / 2 + extra / 2), node.height / 2 - f / 2)
    box(paneled ? 'panel' : 'frame', w, paneled ? 0.3 : f, x, bottom + (paneled ? 0.15 : f / 2))
    const mid = node.height > 1.2 ? (glassBottom + glassTop) / 2 : undefined
    if (mid === undefined) box('glass', w, glassTop - glassBottom, x, (glassTop + glassBottom) / 2)
    else {
      box('frame', w, f, x, mid)
      box('glass', w, mid - f / 2 - glassBottom, x, (glassBottom + mid - f / 2) / 2)
      box('glass', w, glassTop - mid - f / 2, x, (glassTop + mid + f / 2) / 2)
    }
  }
  const transom = size.height - node.height
  if (transom > 0) {
    box('frame', size.width, f, -size.leafOffsetX, node.height / 2 - f / 2)
    box('frame', size.width, f, -size.leafOffsetX, top - f / 2)
    box('frame', f, transom, left + f / 2, node.height / 2 + transom / 2)
    box('frame', f, transom, right - f / 2, node.height / 2 + transom / 2)
    box(
      'glass',
      size.width - 2 * f,
      transom - f,
      -size.leafOffsetX,
      node.height / 2 + (transom - f) / 2,
    )
  }
  currentDoorSlot = undefined
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
  const { depth, center } = resolveOpeningCutoutProxy(node)
  cutout.position.set(0, 0, 0)
  if (center) {
    // Curved and justified walls place openings off the reference line. Remove
    // only the visual plane offset, preserving the frame's resolved floor datum.
    cutout.position
      .set(center[0] - mesh.position.x, 0, center[2] - mesh.position.z)
      .applyQuaternion(mesh.quaternion.clone().invert())
  }
  const { width, height, leafOffsetX } = getDoorOpeningSize(node)
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
    cutout.geometry = new THREE.BoxGeometry(width, height, depth)
  }
  cutout.geometry.translate(-leafOffsetX, (height - node.height) / 2, 0)
  cutout.visible = false
}

// Resolve the cutout proxy depth from the opening's parent wall thickness so
// the proxy stays proud of both wall faces (front/back selection) without the
// old 1m depth that blanketed the floor. Falls back to the default thickness
// when the parent wall isn't a resolvable wall node.
function resolveOpeningCutoutProxy(node: DoorNode): {
  depth: number
  center: [number, number, number] | undefined
} {
  const parentId = node.parentId
  const nodes = useScene.getState().nodes
  const parent = parentId ? nodes[parentId as AnyNodeId] : undefined
  const wall = parent?.type === 'wall' ? getEffectiveNode(parent as WallNode) : undefined
  const wallThickness = wall ? getWallThickness(wall) : DEFAULT_WALL_THICKNESS
  return {
    depth: getOpeningCutoutProxyDepth(wallThickness),
    center:
      wall && !node.roofSegmentId && node.position[2] !== 0
        ? getOpeningWallPlacement(
            wall,
            { ...node, position: [node.position[0], node.position[1], 0] },
            nodes,
          ).position
        : undefined,
  }
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
