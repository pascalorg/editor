import {
  type AnyNodeId,
  type FenceNode,
  getWallCurveFrameAt,
  getWallCurveLength,
  sceneRegistry,
  useScene,
} from '@pascal-app/core'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

type FencePart = {
  position: [number, number, number]
  rotationY?: number
  scale: [number, number, number]
  // A `pyramid` part is a 4-sided cone (square base aligned to the part axes),
  // used for peaked post caps. Defaults to a box.
  shape?: 'box' | 'pyramid'
}

const MIN_CURVE_SEGMENT_LENGTH = 0.18

function createFencePartGeometry(part: FencePart) {
  const geometry =
    part.shape === 'pyramid'
      ? new THREE.ConeGeometry(0.5, 1, 4, 1, false, Math.PI / 4)
      : new THREE.BoxGeometry(1, 1, 1)
  geometry.scale(part.scale[0], part.scale[1], part.scale[2])
  if (part.rotationY) {
    geometry.rotateY(part.rotationY)
  }
  geometry.translate(part.position[0], part.position[1], part.position[2])
  applyFenceUVs(geometry)
  return geometry
}

function getFencePointAt(fence: FenceNode, t: number) {
  const frame = getWallCurveFrameAt(fence, t)
  return {
    point: frame.point,
    tangentAngle: Math.atan2(frame.tangent.y, frame.tangent.x),
  }
}

function createStraightFenceSpanPart(
  start: [number, number],
  end: [number, number],
  centerY: number,
  height: number,
  depth: number,
): FencePart | null {
  const dx = end[0] - start[0]
  const dz = end[1] - start[1]
  const length = Math.hypot(dx, dz)
  if (length <= 1e-4) {
    return null
  }

  return {
    position: [(start[0] + end[0]) / 2, centerY, (start[1] + end[1]) / 2],
    rotationY: -Math.atan2(dz, dx),
    scale: [length, height, depth],
  }
}

function createFenceCurveSpanParts(
  fence: FenceNode,
  startT: number,
  endT: number,
  centerY: number,
  height: number,
  depth: number,
): FencePart[] {
  const parts: FencePart[] = []
  const frameCount = Math.max(
    1,
    Math.ceil(
      (getWallCurveLength(fence) * Math.max(1e-4, endT - startT)) / MIN_CURVE_SEGMENT_LENGTH,
    ),
  )

  let previous = getFencePointAt(fence, startT)
  for (let index = 1; index <= frameCount; index += 1) {
    const t = startT + (endT - startT) * (index / frameCount)
    const current = getFencePointAt(fence, t)
    const segment = createStraightFenceSpanPart(
      [previous.point.x, previous.point.y],
      [current.point.x, current.point.y],
      centerY,
      height,
      depth,
    )
    if (segment) {
      parts.push(segment)
    }
    previous = current
  }

  return parts
}

function applyFenceUVs(geometry: THREE.BufferGeometry) {
  const position = geometry.getAttribute('position')
  const normal = geometry.getAttribute('normal')

  if (!(position && normal)) return

  // World-scale triplanar UVs: 1 UV unit = 1 metre, sampled from the part's
  // local-space (already translated into fence space) coordinates with NO
  // per-part origin shift. A shared origin keeps a tiled finish continuous
  // across posts, rails, and infill instead of restarting the tile at each
  // part's own min corner (the previous behaviour, which broke the 1 m
  // contract and made adjacent parts mistile).
  const uvs = new Float32Array(position.count * 2)

  for (let index = 0; index < position.count; index += 1) {
    const px = position.getX(index)
    const py = position.getY(index)
    const pz = position.getZ(index)
    const nx = Math.abs(normal.getX(index))
    const ny = Math.abs(normal.getY(index))
    const nz = Math.abs(normal.getZ(index))

    let u = 0
    let v = 0

    if (ny >= nx && ny >= nz) {
      u = px
      v = pz
    } else if (nx >= nz) {
      u = pz
      v = py
    } else {
      u = px
      v = py
    }

    uvs[index * 2] = u
    uvs[index * 2 + 1] = v
  }

  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geometry.setAttribute('uv2', new THREE.Float32BufferAttribute(uvs.slice(), 2))
}

function getStyleDefaults(style: FenceNode['style']) {
  if (style === 'privacy') {
    return { spacingFactor: 0.42, postFactor: 1.35, baseFactor: 1.2, topFactor: 1.2 }
  }

  if (style === 'rail') {
    return { spacingFactor: 0.68, postFactor: 0.8, baseFactor: 0.85, topFactor: 0.85 }
  }

  return { spacingFactor: 0.3, postFactor: 0.55, baseFactor: 1, topFactor: 0.75 }
}

// Paint slots map 1:1 to the fence panel's build options (Structure + the
// showInfill toggle): the end posts, the infill slats between them, the base
// kickboard, and the top rail.
export type FenceSlotId = 'posts' | 'infill' | 'base' | 'rail'

export type FenceSlotParts = Record<FenceSlotId, FencePart[]>

/**
 * Horizontal-board fence — composite cladding boards stacked between square
 * intermediate posts (each capped), instead of the vertical pickets the other
 * styles draw. Posts march along the whole span at `postSpacing` (not just the
 * two ends), the boards run full-length so they curve with the fence, and a
 * thin reveal between boards leaves the groove shadow that reads as cladding.
 */
function createHorizontalFenceParts(fence: FenceNode): FenceSlotParts {
  const posts: FencePart[] = []
  const infill: FencePart[] = []
  const base: FencePart[] = []
  const rail: FencePart[] = []

  const length = Math.max(getWallCurveLength(fence), 0.01)
  const panelDepth = Math.max(fence.thickness, 0.03)
  const clearance = Math.max(fence.groundClearance, 0)
  const isFloating = fence.baseStyle === 'floating'
  const showInfill = fence.showInfill ?? true

  const baseHeight = Math.max(fence.baseHeight, 0.04)
  const topRailHeight = Math.max(fence.topRailHeight, 0.01)
  const verticalHeight = Math.max(fence.height - baseHeight - topRailHeight, 0.08)
  const baseY = isFloating ? clearance : 0

  // Square posts stand proud of the recessed boards on both faces.
  const postWidth = Math.max(fence.postSize * 1.4, 0.04)
  const postDepth = postWidth
  const boardDepth = Math.min(panelDepth, postDepth - 0.012)

  // Grounded fences get a kickboard along the bottom; floating ones don't.
  if (!isFloating) {
    base.push(
      ...createFenceCurveSpanParts(
        fence,
        0,
        1,
        baseY + baseHeight / 2,
        baseHeight,
        postDepth * 0.92,
      ),
    )
  }

  // Stack full-length boards between the kickboard and the top rail. The board
  // height is derived to evenly fill the panel around a ~0.145 m target, with a
  // constant reveal between each so the count adapts to any fence height.
  if (showInfill) {
    const reveal = Math.max(fence.slatGap ?? 0.01, 0)
    const infillBottom = baseY + baseHeight
    if (reveal < 0.002) {
      // No reveal → one flush panel, so the stacked-board edge seams don't
      // read as faint lines where the user asked for a smooth surface.
      infill.push(
        ...createFenceCurveSpanParts(
          fence,
          0,
          1,
          infillBottom + verticalHeight / 2,
          verticalHeight,
          boardDepth,
        ),
      )
    } else {
      const boardCount = Math.max(1, Math.round(verticalHeight / (0.145 + reveal)))
      const slabHeight = Math.max((verticalHeight - reveal * (boardCount - 1)) / boardCount, 0.02)
      for (let index = 0; index < boardCount; index += 1) {
        const centerY = infillBottom + slabHeight / 2 + index * (slabHeight + reveal)
        infill.push(...createFenceCurveSpanParts(fence, 0, 1, centerY, slabHeight, boardDepth))
      }
    }
  }

  // Top rail caps the boards.
  rail.push(
    ...createFenceCurveSpanParts(
      fence,
      0,
      1,
      baseY + baseHeight + verticalHeight + topRailHeight / 2,
      topRailHeight,
      Math.max(postDepth * 0.78, 0.02),
    ),
  )

  // Posts at every `postSpacing`, anchored at both ends, each with a flat cap.
  const spacing = Math.max(fence.postSpacing, postWidth * 1.4)
  const postCount = Math.max(2, Math.floor(length / spacing) + 1)
  const postHeight = baseHeight + verticalHeight + topRailHeight + clearance
  const capHeight = Math.max(postWidth * 0.32, 0.03)
  const cap = fence.postCap ?? 'pyramid'
  for (let index = 0; index < postCount; index += 1) {
    const t = postCount === 1 ? 0.5 : index / (postCount - 1)
    const frame = getFencePointAt(fence, t)
    posts.push({
      position: [frame.point.x, postHeight / 2, frame.point.y],
      rotationY: -frame.tangentAngle,
      scale: [postWidth, postHeight, postDepth],
    })
    if (cap === 'flat') {
      posts.push({
        position: [frame.point.x, postHeight + capHeight / 2, frame.point.y],
        rotationY: -frame.tangentAngle,
        scale: [postWidth * 1.22, capHeight, postDepth * 1.22],
      })
    } else if (cap === 'pyramid') {
      posts.push({
        position: [frame.point.x, postHeight + capHeight * 0.9, frame.point.y],
        rotationY: -frame.tangentAngle,
        scale: [postWidth * 1.18, capHeight * 1.8, postDepth * 1.18],
        shape: 'pyramid',
      })
    }
  }

  return { posts, infill, base, rail }
}

function createFenceParts(fence: FenceNode): FenceSlotParts {
  if (fence.style === 'horizontal') return createHorizontalFenceParts(fence)

  const posts: FencePart[] = []
  const infill: FencePart[] = []
  const base: FencePart[] = []
  const rail: FencePart[] = []
  const length = Math.max(getWallCurveLength(fence), 0.01)
  const panelDepth = Math.max(fence.thickness, 0.03)
  const clearance = Math.max(fence.groundClearance, 0)
  const styleDefaults = getStyleDefaults(fence.style)
  const baseHeight = Math.max(fence.baseHeight * styleDefaults.baseFactor, 0.04)
  const topRailHeight = Math.max(fence.topRailHeight * styleDefaults.topFactor, 0.01)
  const verticalHeight = Math.max(fence.height - baseHeight - topRailHeight, 0.08)
  const postWidth = Math.max(fence.postSize * styleDefaults.postFactor, 0.01)
  const spacing = Math.max(fence.postSpacing * styleDefaults.spacingFactor, postWidth * 1.2)
  const edgeInset = Math.max(fence.edgeInset ?? 0.015, 0.005)
  const isFloating = fence.baseStyle === 'floating'
  const showInfill = fence.showInfill ?? true
  const baseY = isFloating ? clearance : 0
  const effectiveBaseHeight = baseHeight
  const startInsetT = Math.min(0.499, edgeInset / length)
  const endInsetT = Math.max(0.501, 1 - edgeInset / length)

  if (!isFloating) {
    base.push(
      ...createFenceCurveSpanParts(
        fence,
        0,
        1,
        baseY + effectiveBaseHeight / 2,
        effectiveBaseHeight,
        panelDepth * 1.05,
      ),
    )
    base.push(
      ...createFenceCurveSpanParts(
        fence,
        0,
        1,
        baseY + effectiveBaseHeight + verticalHeight * 0.15,
        topRailHeight * 0.8,
        panelDepth * 0.35,
      ),
    )
  }

  const count = showInfill ? Math.max(2, Math.floor((length - edgeInset * 2) / spacing) + 1) : 2
  const verticalY = baseY + effectiveBaseHeight + verticalHeight / 2

  for (let index = 0; index < count; index += 1) {
    const t = count === 1 ? 0.5 : startInsetT + (endInsetT - startInsetT) * (index / (count - 1))
    const frame = getFencePointAt(fence, t)
    const isEdgePost = index === 0 || index === count - 1
    const fullHeightPost = !showInfill || (isFloating && isEdgePost)
    const postHeight = fullHeightPost
      ? effectiveBaseHeight + verticalHeight + topRailHeight + clearance
      : verticalHeight
    const postY = fullHeightPost ? postHeight / 2 : verticalY

    // End posts are the structural `posts` slot; the intermediate verticals are
    // the `infill` slats (only present when showInfill adds them).
    // Depth is 0.001 m shy of the accent rail's `panelDepth * 0.35` so the two
    // never share a coplanar face where they cross (kills the rail z-fighting).
    ;(isEdgePost ? posts : infill).push({
      position: [frame.point.x, postY, frame.point.y],
      rotationY: -frame.tangentAngle,
      scale: [postWidth, postHeight, Math.max(panelDepth * 0.35 - 0.001, 0.011)],
    })
  }

  rail.push(
    ...createFenceCurveSpanParts(
      fence,
      0,
      1,
      baseY + effectiveBaseHeight + verticalHeight + topRailHeight / 2,
      topRailHeight,
      Math.max(panelDepth * 0.55, 0.018),
    ),
  )

  if (isFloating) {
    rail.push(
      ...createFenceCurveSpanParts(
        fence,
        0,
        1,
        baseY + effectiveBaseHeight + topRailHeight / 2,
        topRailHeight,
        Math.max(panelDepth * 0.55, 0.018),
      ),
    )
  }

  return { posts, infill, base, rail }
}

function mergeFenceParts(parts: FencePart[]): THREE.BufferGeometry {
  // An empty slot group (e.g. infill with showInfill off, or base on a floating
  // fence) must not reach mergeGeometries — it throws on an empty array. The
  // empty geometry has no position attribute, so the renderer skips its mesh.
  if (parts.length === 0) return new THREE.BufferGeometry()
  const geometries = parts.map(createFencePartGeometry)
  const merged = mergeGeometries(geometries, false) ?? new THREE.BufferGeometry()
  geometries.forEach((geometry) => {
    geometry.dispose()
  })
  const mergedUv = merged.getAttribute('uv')
  if (mergedUv) {
    merged.setAttribute('uv2', new THREE.Float32BufferAttribute(Array.from(mergedUv.array), 2))
  }
  merged.computeVertexNormals()
  return merged
}

/**
 * Geometry split by paint slot — posts, infill, base, rail — each a separate
 * merged BufferGeometry (empty ones included) so the fence renderer can give
 * each its own material + `userData.slotId`. Slots match the panel's build
 * options 1:1.
 */
export function generateFenceSlotGeometries(
  fence: FenceNode,
): Record<FenceSlotId, THREE.BufferGeometry> {
  const parts = createFenceParts(fence)
  return {
    posts: mergeFenceParts(parts.posts),
    infill: mergeFenceParts(parts.infill),
    base: mergeFenceParts(parts.base),
    rail: mergeFenceParts(parts.rail),
  }
}

export function generateFenceGeometry(fence: FenceNode) {
  const { posts, infill, base, rail } = createFenceParts(fence)
  return mergeFenceParts([...posts, ...infill, ...base, ...rail])
}

function updateFenceGeometry(fenceId: FenceNode['id']) {
  const node = useScene.getState().nodes[fenceId]
  if (!node || node.type !== 'fence') return

  const mesh = sceneRegistry.nodes.get(fenceId) as THREE.Mesh | undefined
  if (!mesh) return

  const newGeometry = generateFenceGeometry(node)
  mesh.geometry.dispose()
  mesh.geometry = newGeometry
  mesh.position.set(0, 0, 0)
  mesh.rotation.set(0, 0, 0)
}

export const FenceSystem = () => {
  const dirtyNodes = useScene((state) => state.dirtyNodes)
  const clearDirty = useScene((state) => state.clearDirty)

  useFrame(() => {
    if (dirtyNodes.size === 0) return

    const nodes = useScene.getState().nodes
    dirtyNodes.forEach((id) => {
      const node = nodes[id]
      if (!node || node.type !== 'fence') return
      updateFenceGeometry(id as FenceNode['id'])
      clearDirty(id as AnyNodeId)
    })
  }, 4)

  return null
}
