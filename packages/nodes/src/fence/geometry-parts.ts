import {
  clampFencePicketRailProjection,
  type FenceFeatureData,
  type FenceNode,
  type FenceWithFeatures,
  getFenceCenterlineFrameAt,
  getFenceCenterlineLength,
  getFenceGateLeaves,
  type ResolvedFenceFeature,
  resolveFenceFeatures,
} from '@pascal-app/core'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

type FencePart = {
  geometry?: THREE.BufferGeometry
  position: [number, number, number]
  rotationY?: number
  rotationZ?: number
  scale: [number, number, number]
  // A `pyramid` part is a 4-sided cone (square base aligned to the part axes),
  // used for peaked post caps. Defaults to a box.
  shape?: 'box' | 'pyramid' | 'picket'
  picketTop?: FenceNode['picketTop']
  startT?: number
  endT?: number
  heightOverride?: number
  curveBlock?: { centerY: number; height: number; depth: number; lateralOffset: number }
  endpoint?: 'start' | 'end'
}

const MIN_CURVE_SEGMENT_LENGTH = 0.18
const HORIZONTAL_FENCE_CURVE_SEGMENT_LENGTH = 0.2

function createFencePartGeometry(part: FencePart) {
  if (part.geometry) {
    return part.geometry
  }
  const geometry =
    part.shape === 'pyramid'
      ? new THREE.ConeGeometry(0.5, 1, 4, 1, false, Math.PI / 4)
      : part.shape === 'picket'
        ? createPicketGeometry(part.scale[0], part.scale[1], part.scale[2], part.picketTop)
        : new THREE.BoxGeometry(1, 1, 1)
  if (part.shape !== 'picket') geometry.scale(part.scale[0], part.scale[1], part.scale[2])
  if (part.rotationZ) geometry.rotateZ(part.rotationZ)
  if (part.rotationY) {
    geometry.rotateY(part.rotationY)
  }
  geometry.translate(part.position[0], part.position[1], part.position[2])
  applyFenceUVs(geometry)
  return geometry
}

function createPicketGeometry(
  width: number,
  height: number,
  depth: number,
  top: FenceNode['picketTop'] = 'dog-ear',
) {
  const shape = new THREE.Shape()
  const halfWidth = width / 2
  const tip = height / 2
  const shoulder = tip - Math.min(halfWidth, height * 0.2)
  shape.moveTo(-halfWidth, -tip)
  shape.lineTo(halfWidth, -tip)
  if (top === 'flat') {
    shape.lineTo(halfWidth, tip)
    shape.lineTo(-halfWidth, tip)
  } else {
    shape.lineTo(halfWidth, shoulder)
    if (top === 'pointed') {
      shape.lineTo(0, tip)
    } else if (top === 'rounded') {
      shape.absellipse(0, shoulder, halfWidth, tip - shoulder, 0, Math.PI, false, 0)
    } else {
      shape.lineTo(width * 0.28, tip)
      shape.lineTo(-width * 0.28, tip)
    }
    shape.lineTo(-halfWidth, shoulder)
  }
  shape.closePath()
  const geometry = new THREE.ExtrudeGeometry(shape, {
    bevelEnabled: false,
    curveSegments: 8,
    depth,
    steps: 1,
  })
  geometry.translate(0, 0, -depth / 2)
  return geometry
}

function getInfillOffset(fence: FenceNode, supportDepth: number, infillDepth: number) {
  const direction =
    fence.infillPlacement === 'front' ? 1 : fence.infillPlacement === 'back' ? -1 : 0
  // A small overlap avoids coincident faces at the attachment surface.
  return direction * Math.max(0, (supportDepth + infillDepth) / 2 - 0.002)
}

function getFencePointAt(fence: FenceNode, t: number) {
  const frame = getFenceCenterlineFrameAt(fence, t)
  return {
    point: frame.point,
    tangentAngle: Math.atan2(frame.tangent.y, frame.tangent.x),
  }
}

function createFenceCurveBlockPart(
  fence: FenceNode,
  startT: number,
  endT: number,
  centerY: number,
  height: number,
  depth: number,
  lateralOffset = 0,
): FencePart | null {
  if (endT - startT <= 1e-5) return null
  const halfHeight = height / 2
  const halfDepth = depth / 2
  const centerlineLength = getFenceCenterlineLength(fence)
  const startDistance = startT * centerlineLength
  const endDistance = endT * centerlineLength
  const bottomY = centerY - halfHeight
  const topY = centerY + halfHeight
  const corners: Array<[number, number, number]> = []

  for (const t of [startT, endT]) {
    const frame = getFencePointAt(fence, t)
    const normalX = -Math.sin(frame.tangentAngle)
    const normalZ = Math.cos(frame.tangentAngle)

    const outerX = frame.point.x + normalX * (halfDepth + lateralOffset)
    const outerZ = frame.point.y + normalZ * (halfDepth + lateralOffset)
    const innerX = frame.point.x - normalX * (halfDepth - lateralOffset)
    const innerZ = frame.point.y - normalZ * (halfDepth - lateralOffset)

    corners.push(
      [outerX, bottomY, outerZ],
      [innerX, bottomY, innerZ],
      [outerX, topY, outerZ],
      [innerX, topY, innerZ],
    )
  }

  const positions: number[] = []
  const uvs: number[] = []
  const pushVertex = (index: number, uv: [number, number]) => {
    positions.push(...corners[index]!)
    uvs.push(...uv)
  }

  const pushQuad = (
    a: number,
    b: number,
    c: number,
    d: number,
    uvA: [number, number],
    uvB: [number, number],
    uvC: [number, number],
    uvD: [number, number],
  ) => {
    pushVertex(a, uvA)
    pushVertex(b, uvB)
    pushVertex(c, uvC)
    pushVertex(a, uvA)
    pushVertex(c, uvC)
    pushVertex(d, uvD)
  }

  const topOuterV = topY
  const topInnerV = topY + depth
  const innerTopV = topInnerV
  const innerBottomV = topInnerV + height
  const bottomInnerV = bottomY - depth

  pushQuad(
    0,
    4,
    6,
    2,
    [startDistance, bottomY],
    [endDistance, bottomY],
    [endDistance, topY],
    [startDistance, topY],
  )
  pushQuad(
    1,
    3,
    7,
    5,
    [startDistance, innerBottomV],
    [startDistance, innerTopV],
    [endDistance, innerTopV],
    [endDistance, innerBottomV],
  )
  pushQuad(
    2,
    6,
    7,
    3,
    [startDistance, topOuterV],
    [endDistance, topOuterV],
    [endDistance, topInnerV],
    [startDistance, topInnerV],
  )
  pushQuad(
    0,
    1,
    5,
    4,
    [startDistance, bottomY],
    [startDistance, bottomInnerV],
    [endDistance, bottomInnerV],
    [endDistance, bottomY],
  )
  pushQuad(0, 2, 3, 1, [0, bottomY], [0, topY], [depth, innerTopV], [depth, innerBottomV])
  pushQuad(4, 5, 7, 6, [0, bottomY], [depth, innerBottomV], [depth, innerTopV], [0, topY])

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(new Float32Array(positions), 3),
  )
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(uvs), 2))
  geometry.setAttribute('uv2', new THREE.Float32BufferAttribute(new Float32Array(uvs), 2))
  geometry.computeVertexNormals()

  return {
    geometry,
    position: [0, 0, 0],
    scale: [1, 1, 1],
    startT,
    endT,
    curveBlock: { centerY, height, depth, lateralOffset },
  }
}

function createFenceCurveBlockParts(
  fence: FenceNode,
  startT: number,
  endT: number,
  centerY: number,
  height: number,
  depth: number,
  maxSegmentLength = MIN_CURVE_SEGMENT_LENGTH,
  lateralOffset = 0,
): FencePart[] {
  const length = getFenceCenterlineLength(fence) * Math.max(1e-4, endT - startT)
  const segmentCount = Math.max(1, Math.ceil(length / Math.max(1e-4, maxSegmentLength)))
  const parts: FencePart[] = []

  for (let index = 0; index < segmentCount; index += 1) {
    const segmentStartT = startT + (endT - startT) * (index / segmentCount)
    const segmentEndT = startT + (endT - startT) * ((index + 1) / segmentCount)
    const part = createFenceCurveBlockPart(
      fence,
      segmentStartT,
      segmentEndT,
      centerY,
      height,
      depth,
      lateralOffset,
    )
    if (part) parts.push(part)
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

function getFenceInfillVerticalBounds(fence: FenceNode) {
  const height = fence.style === 'picket' ? Math.max(fence.height, 0.3) : fence.height
  if (fence.style === 'picket') {
    const baseHeight =
      fence.baseStyle === 'floating' ? 0 : Math.min(Math.max(fence.baseHeight, 0.04), height * 0.5)
    const bottom = Math.min(baseHeight + Math.max(fence.groundClearance, 0), height * 0.75)
    const topClearance = Math.min(
      Math.max(fence.picketTopClearance ?? 0, 0),
      height - bottom - 0.02,
    )
    return { bottom, top: height - topClearance }
  }

  const styleDefaults = getStyleDefaults(fence.style)
  const baseY = fence.baseStyle === 'floating' ? Math.max(fence.groundClearance, 0) : 0
  const baseHeight = Math.max(
    fence.baseHeight * (fence.style === 'horizontal' ? 1 : styleDefaults.baseFactor),
    0.04,
  )
  const topRailHeight = Math.max(
    fence.topRailHeight * (fence.style === 'horizontal' ? 1 : styleDefaults.topFactor),
    0.01,
  )
  const verticalHeight = Math.max(height - baseHeight - topRailHeight, 0.08)
  const bottom = baseY + baseHeight
  return { bottom, top: bottom + verticalHeight }
}

export function getFenceFeatureDimensions(fence: FenceNode, feature: FenceFeatureData) {
  const bounds = getFenceInfillVerticalBounds(fence)
  const fullPost =
    fence.style === 'picket' ||
    fence.style === 'horizontal' ||
    fence.baseStyle === 'floating' ||
    !fence.showInfill
  const postBottom = fullPost ? 0 : bounds.bottom
  const defaults = getStyleDefaults(fence.style)
  const railHeight = Math.max(
    fence.topRailHeight * (fence.style === 'horizontal' ? 1 : defaults.topFactor),
    0.01,
  )
  const postTop =
    fence.style === 'picket'
      ? Math.max(fence.height, 0.3)
      : fullPost
        ? bounds.top -
          (fence.baseStyle === 'floating' ? Math.max(fence.groundClearance, 0) : 0) +
          railHeight +
          Math.max(fence.groundClearance, 0)
        : bounds.top
  const matchesHeight = feature.matchFenceHeight ?? feature.matchFenceStyle !== false
  const bottom =
    feature.kind === 'opening'
      ? postBottom
      : matchesHeight
        ? bounds.bottom
        : (feature.clearance ?? bounds.bottom)
  const defaultHeight =
    feature.kind === 'opening' ? postTop - postBottom : bounds.top - bounds.bottom
  const height = matchesHeight ? defaultHeight : (feature.height ?? defaultHeight)
  const postHeight = Math.max(0.02, feature.kind === 'opening' ? height : postTop - postBottom)
  return { bottom, height, postBottom, postHeight }
}

function distributePattern(
  fence: FenceNode,
  start: number,
  end: number,
  targetSpacing: number,
  minimumSpacing: number,
  minimumCount = 1,
): number[] {
  const length = Math.max(0, end - start)
  if (length < 1e-5) return minimumCount > 1 ? [start, end] : [(start + end) / 2]
  const target = Math.max(targetSpacing, minimumSpacing)
  const maxCount = Math.max(minimumCount, Math.floor(length / minimumSpacing) + 1)
  const mode = fence.patternDistribution
  let count: number
  if (mode === 'fixed-count') {
    count = THREE.MathUtils.clamp(Math.round(fence.patternCount), minimumCount, maxCount)
  } else if (mode === 'maximum-spacing') {
    count = THREE.MathUtils.clamp(Math.ceil(length / target) + 1, minimumCount, maxCount)
  } else if (mode === 'equal-fit') {
    count = THREE.MathUtils.clamp(Math.round(length / target) + 1, minimumCount, maxCount)
  } else {
    count = THREE.MathUtils.clamp(Math.floor(length / target) + 1, minimumCount, maxCount)
  }
  if (count === 1) {
    return [
      mode === 'fixed-spacing' && fence.patternAlignment === 'start'
        ? start
        : mode === 'fixed-spacing' && fence.patternAlignment === 'end'
          ? end
          : (start + end) / 2,
    ]
  }
  const fixed = mode === 'fixed-spacing' && fence.patternRemainder === 'leave'
  const spacing = fixed ? target : length / (count - 1)
  const extra = Math.max(0, length - spacing * (count - 1))
  const origin = fixed
    ? start +
      (fence.patternAlignment === 'end'
        ? extra
        : fence.patternAlignment === 'center'
          ? extra / 2
          : 0)
    : start
  return Array.from({ length: count }, (_, index) => origin + index * spacing)
}

// Paint slots map 1:1 to the fence panel's build options (Structure + the
// showInfill toggle): the end posts, the infill slats between them, the base
// kickboard, and the top rail.
export type FenceSlotId = 'posts' | 'infill' | 'base' | 'rail'

export type FenceSlotParts = Record<FenceSlotId, FencePart[]>

export type FenceCornerNeighbors = Partial<Record<'start' | 'end', FenceNode>>

function miterFencePartEnd(
  fence: FenceNode,
  part: FencePart,
  endpoint: 'start' | 'end',
  neighbor: FenceNode,
) {
  if (!part.geometry || !part.curveBlock) return
  const t = endpoint === 'start' ? 0 : 1
  if (Math.abs(((endpoint === 'start' ? part.startT : part.endT) ?? -1) - t) > 1e-5) return
  const point = fence[endpoint]
  const frame = getFenceCenterlineFrameAt(fence, t)
  const sign = endpoint === 'start' ? 1 : -1
  const ux = frame.tangent.x * sign
  const uz = frame.tangent.y * sign
  const neighborAtStart =
    Math.hypot(neighbor.start[0] - point[0], neighbor.start[1] - point[1]) < 0.001
  const other = getFenceCenterlineFrameAt(neighbor, neighborAtStart ? 0 : 1)
  const vx = other.tangent.x * (neighborAtStart ? 1 : -1)
  const vz = other.tangent.y * (neighborAtStart ? 1 : -1)
  const cross = ux * vz - uz * vx
  if (Math.abs(cross) < 0.15) return
  const { depth, lateralOffset } = part.curveBlock
  const ratio = Math.max(neighbor.thickness, 0.03) / Math.max(fence.thickness, 0.03)
  const position = part.geometry.getAttribute('position')
  for (let index = 0; index < position.count; index += 1) {
    const x = position.getX(index)
    const z = position.getZ(index)
    for (const side of [-1, 1]) {
      const offset = lateralOffset + (side * depth) / 2
      const originalX = point[0] - uz * offset * sign
      const originalZ = point[1] + ux * offset * sign
      if (Math.hypot(x - originalX, z - originalZ) > 1e-4) continue
      const neighborOffset = -offset * sign * ratio
      const nx = -uz * offset * sign
      const nz = ux * offset * sign
      const mx = -vz * neighborOffset
      const mz = vx * neighborOffset
      const reach = ((mx - nx) * vz - (mz - nz) * vx) / cross
      if (Math.abs(reach) > Math.max(depth, depth * ratio) * 4) break
      position.setX(index, originalX + ux * reach)
      position.setZ(index, originalZ + uz * reach)
      break
    }
  }
  position.needsUpdate = true
  part.geometry.computeVertexNormals()
}

/**
 * Horizontal-board fence — composite cladding boards stacked between square
 * intermediate posts (each capped), instead of the vertical pickets the other
 * styles draw. Posts march along the whole span at `postSpacing` (not just the
 * two ends), the boards run full-length so they curve with the fence, and a
 * thin reveal between boards leaves the groove shadow that reads as cladding.
 */
function createHorizontalFenceParts(
  fence: FenceNode,
  sharedEndpoints?: ReadonlySet<'start' | 'end'>,
): FenceSlotParts {
  const posts: FencePart[] = []
  const infill: FencePart[] = []
  const base: FencePart[] = []
  const rail: FencePart[] = []

  const length = Math.max(getFenceCenterlineLength(fence), 0.01)
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
  const infillOffset = getInfillOffset(fence, postDepth, boardDepth)
  // Stop the horizontal boards / base / rail at the inner faces of the
  // end posts. Letting curved spans run all the way to t=0/1 makes them
  // overlap the terminal post mesh and creates the broken seam/notch seen
  // at curve ends.
  const edgeInset = Math.max(fence.edgeInset ?? 0.015, postWidth * 0.5)
  const startInsetT = sharedEndpoints?.has('start') ? 0 : Math.min(0.499, edgeInset / length)
  const endInsetT = sharedEndpoints?.has('end') ? 1 : Math.max(0.501, 1 - edgeInset / length)

  // Grounded fences get a kickboard along the bottom; floating ones don't.
  if (!isFloating) {
    base.push(
      ...createFenceCurveBlockParts(
        fence,
        startInsetT,
        endInsetT,
        baseY + baseHeight / 2,
        baseHeight,
        postDepth * 0.92,
        HORIZONTAL_FENCE_CURVE_SEGMENT_LENGTH,
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
        ...createFenceCurveBlockParts(
          fence,
          startInsetT,
          endInsetT,
          infillBottom + verticalHeight / 2,
          verticalHeight,
          boardDepth,
          HORIZONTAL_FENCE_CURVE_SEGMENT_LENGTH,
          infillOffset,
        ),
      )
    } else {
      const boardCount = Math.max(1, Math.round(verticalHeight / (0.145 + reveal)))
      const slabHeight = Math.max((verticalHeight - reveal * (boardCount - 1)) / boardCount, 0.02)
      for (let index = 0; index < boardCount; index += 1) {
        const centerY = infillBottom + slabHeight / 2 + index * (slabHeight + reveal)
        infill.push(
          ...createFenceCurveBlockParts(
            fence,
            startInsetT,
            endInsetT,
            centerY,
            slabHeight,
            boardDepth,
            HORIZONTAL_FENCE_CURVE_SEGMENT_LENGTH,
            infillOffset,
          ),
        )
      }
    }
  }

  // Top rail caps the boards.
  rail.push(
    ...createFenceCurveBlockParts(
      fence,
      startInsetT,
      endInsetT,
      baseY + baseHeight + verticalHeight + topRailHeight / 2,
      topRailHeight,
      Math.max(postDepth * 0.78, 0.02),
      HORIZONTAL_FENCE_CURVE_SEGMENT_LENGTH,
    ),
  )

  // Posts at every `postSpacing`, anchored at both ends, each with a flat cap.
  const spacing = Math.max(fence.postSpacing, postWidth * 1.4)
  const postCount = Math.max(2, Math.floor(length / spacing) + 1)
  const postDistances =
    fence.patternDistribution === 'automatic'
      ? Array.from({ length: postCount }, (_, index) => (length * index) / (postCount - 1))
      : distributePattern(fence, 0, length, spacing, postWidth * 1.4, 2)
  const anchoredPostDistances =
    fence.patternDistribution === 'fixed-spacing'
      ? [
          0,
          ...postDistances.filter(
            (distance) => distance > postWidth * 1.4 && length - distance > postWidth * 1.4,
          ),
          length,
        ]
      : postDistances
  const postHeight = baseHeight + verticalHeight + topRailHeight + clearance
  const capHeight = Math.max(postWidth * 0.32, 0.03)
  const cap = fence.postCap ?? 'pyramid'
  for (const distance of anchoredPostDistances) {
    const t = distance / length
    const frame = getFencePointAt(fence, t)
    posts.push({
      endpoint: distance === 0 ? 'start' : distance === length ? 'end' : undefined,
      position: [frame.point.x, postHeight / 2, frame.point.y],
      rotationY: -frame.tangentAngle,
      scale: [postWidth, postHeight, postDepth],
    })
    if (cap === 'flat') {
      posts.push({
        endpoint: distance === 0 ? 'start' : distance === length ? 'end' : undefined,
        position: [frame.point.x, postHeight + capHeight / 2, frame.point.y],
        rotationY: -frame.tangentAngle,
        scale: [postWidth * 1.22, capHeight, postDepth * 1.22],
      })
    } else if (cap === 'pyramid') {
      posts.push({
        endpoint: distance === 0 ? 'start' : distance === length ? 'end' : undefined,
        position: [frame.point.x, postHeight + capHeight * 0.9, frame.point.y],
        rotationY: -frame.tangentAngle,
        scale: [postWidth * 1.18, capHeight * 1.8, postDepth * 1.18],
        shape: 'pyramid',
      })
    }
  }

  return { posts, infill, base, rail }
}

function createFenceParts(
  fence: FenceNode,
  sharedEndpoints?: ReadonlySet<'start' | 'end'>,
): FenceSlotParts {
  if (fence.style === 'horizontal') return createHorizontalFenceParts(fence, sharedEndpoints)
  if (fence.style === 'picket') return createPicketFenceParts(fence, sharedEndpoints)

  const posts: FencePart[] = []
  const infill: FencePart[] = []
  const base: FencePart[] = []
  const rail: FencePart[] = []
  const length = Math.max(getFenceCenterlineLength(fence), 0.01)
  const panelDepth = Math.max(fence.thickness, 0.03)
  const clearance = Math.max(fence.groundClearance, 0)
  const styleDefaults = getStyleDefaults(fence.style)
  const baseHeight = Math.max(fence.baseHeight * styleDefaults.baseFactor, 0.04)
  const topRailHeight = Math.max(fence.topRailHeight * styleDefaults.topFactor, 0.01)
  const verticalHeight = Math.max(fence.height - baseHeight - topRailHeight, 0.08)
  const postWidth = Math.max(fence.postSize * styleDefaults.postFactor, 0.01)
  const spacing = Math.max(
    fence.postSpacing *
      (fence.patternDistribution === 'automatic' ? styleDefaults.spacingFactor : 1),
    postWidth * 1.2,
  )
  const edgeInset = Math.max(fence.edgeInset ?? 0.015, 0.005)
  const isFloating = fence.baseStyle === 'floating'
  const showInfill = fence.showInfill ?? true
  const baseY = isFloating ? clearance : 0
  const effectiveBaseHeight = baseHeight
  const startInsetT = Math.min(0.499, edgeInset / length)
  const endInsetT = Math.max(0.501, 1 - edgeInset / length)

  if (!isFloating) {
    base.push(
      ...createFenceCurveBlockParts(
        fence,
        0,
        1,
        baseY + effectiveBaseHeight / 2,
        effectiveBaseHeight,
        panelDepth * 1.05,
      ),
    )

    base.push(
      ...createFenceCurveBlockParts(
        fence,
        0,
        1,
        baseY + effectiveBaseHeight + verticalHeight * 0.15,
        topRailHeight * 0.8,
        panelDepth * 0.35,
      ),
    )
  }

  const count =
    showInfill && fence.style !== 'privacy'
      ? Math.max(2, Math.floor((length - edgeInset * 2) / spacing) + 1)
      : 2
  const interiorStart = edgeInset + postWidth * 1.5
  const interiorEnd = length - edgeInset - postWidth * 1.5
  const positions =
    !showInfill || fence.patternDistribution === 'automatic'
      ? Array.from({ length: count }, (_, index) =>
          count === 1 ? 0.5 : startInsetT + (endInsetT - startInsetT) * (index / (count - 1)),
        )
      : [
          startInsetT,
          ...(interiorEnd >= interiorStart
            ? distributePattern(fence, interiorStart, interiorEnd, spacing, postWidth * 1.2).map(
                (distance) => distance / length,
              )
            : []),
          endInsetT,
        ]
  const verticalY = baseY + effectiveBaseHeight + verticalHeight / 2

  for (let index = 0; index < positions.length; index += 1) {
    const t = positions[index]!
    const isEdgePost = index === 0 || index === positions.length - 1
    const fullHeightPost = !showInfill || (isFloating && isEdgePost)
    const postHeight = fullHeightPost
      ? effectiveBaseHeight + verticalHeight + topRailHeight + clearance
      : verticalHeight
    const postY = fullHeightPost ? postHeight / 2 : verticalY

    // End posts are the structural `posts` slot; the intermediate verticals are
    // the `infill` slats (only present when showInfill adds them).
    const slatHalfT = Math.max(0.0005, postWidth / (2 * length))
    const slatStartT = Math.max(0, t - slatHalfT)
    const slatEndT = Math.min(1, t + slatHalfT)
    const slat = createFenceCurveBlockPart(
      fence,
      slatStartT,
      slatEndT,
      postY,
      postHeight,
      Math.max(panelDepth * 0.35 - 0.001, 0.011),
      isEdgePost
        ? 0
        : getInfillOffset(
            fence,
            Math.max(panelDepth * 0.55, 0.018),
            Math.max(panelDepth * 0.35 - 0.001, 0.011),
          ),
    )
    if (slat) {
      if (isEdgePost) slat.endpoint = index === 0 ? 'start' : 'end'
      ;(isEdgePost ? posts : infill).push(slat)
    }
  }

  if (showInfill && fence.style === 'privacy') {
    infill.push(
      ...createFenceCurveBlockParts(
        fence,
        startInsetT,
        endInsetT,
        verticalY,
        verticalHeight,
        panelDepth * 0.7,
        MIN_CURVE_SEGMENT_LENGTH,
        getInfillOffset(fence, Math.max(panelDepth * 0.55, 0.018), panelDepth * 0.7),
      ),
    )
  }

  rail.push(
    ...createFenceCurveBlockParts(
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
      ...createFenceCurveBlockParts(
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

function createPicketFenceParts(
  fence: FenceNode,
  sharedEndpoints?: ReadonlySet<'start' | 'end'>,
): FenceSlotParts {
  const posts: FencePart[] = []
  const infill: FencePart[] = []
  const base: FencePart[] = []
  const rail: FencePart[] = []
  const length = Math.max(getFenceCenterlineLength(fence), 0.01)
  const height = Math.max(fence.height, 0.3)
  const postWidth = Math.max(fence.postSize, 0.02)
  const postDepth = Math.max(fence.thickness, postWidth)
  const baseHeight =
    fence.baseStyle === 'floating' ? 0 : Math.min(Math.max(fence.baseHeight, 0.04), height * 0.5)
  const picketBottom = Math.min(baseHeight + Math.max(fence.groundClearance, 0), height * 0.75)
  const topClearance = Math.min(
    Math.max(fence.picketTopClearance ?? 0, 0),
    height - picketBottom - 0.02,
  )
  const picketHeight = height - picketBottom - topClearance
  const railHeight = Math.min(Math.max(fence.topRailHeight, 0.01), picketHeight * 0.15)
  // Separate the exposed faces at post/base and post/rail intersections.
  const baseDepth = postDepth * 0.8
  const railDepth =
    postDepth + 2 * clampFencePicketRailProjection(fence.picketRailProjection, fence.postSize)
  const variation =
    fence.picketProfile === 'level'
      ? 0
      : Math.min(Math.max(fence.picketVariation, 0), picketHeight * 0.3)
  const shortestPicketHeight = picketHeight - variation
  const picketDepth = Math.max(Math.min(fence.thickness * 0.5, 0.052), 0.01)
  const picketWidth = Math.max(fence.picketWidth, 0.02)
  const isCurved = (fence.path?.length ?? 0) >= 2 || Math.abs(fence.curveOffset ?? 0) > 0.0001
  // Curved runs need more clearance as neighboring boards turn toward each other.
  const curveClearance = isCurved ? 0.03 : 0
  const spacing = Math.max(fence.picketSpacing, picketWidth + 0.01) + curveClearance
  const endInset = Math.max(fence.edgeInset, 0) + postWidth / 2
  const postCount = Math.max(1, Math.ceil(length / Math.max(fence.postSpacing, postWidth * 2)))

  for (let index = 0; index <= postCount; index += 1) {
    const frame = getFencePointAt(fence, index / postCount)
    posts.push({
      endpoint: index === 0 ? 'start' : index === postCount ? 'end' : undefined,
      position: [frame.point.x, height / 2, frame.point.y],
      rotationY: -frame.tangentAngle,
      scale: [postWidth, height, postDepth],
    })
    if (fence.postCap !== 'none') {
      const capHeight = postWidth * (fence.postCap === 'flat' ? 0.2 : 0.5)
      posts.push({
        endpoint: index === 0 ? 'start' : index === postCount ? 'end' : undefined,
        position: [frame.point.x, height + capHeight / 2, frame.point.y],
        rotationY: -frame.tangentAngle,
        scale: [postWidth * 1.5, capHeight, postDepth * 1.5],
        shape: fence.postCap === 'flat' ? 'box' : 'pyramid',
      })
    }
  }

  const startInsetT = sharedEndpoints?.has('start') ? 0 : Math.min(0.499, endInset / length)
  const endInsetT = sharedEndpoints?.has('end') ? 1 : Math.max(0.501, 1 - endInset / length)
  const railEndInset = Math.max(0, postWidth / 2 - Math.min(postWidth * 0.2, 0.015))
  const railStartT = sharedEndpoints?.has('start') ? 0 : Math.min(0.499, railEndInset / length)
  const railEndT = sharedEndpoints?.has('end') ? 1 : Math.max(0.501, 1 - railEndInset / length)
  if (baseHeight > 0) {
    base.push(
      ...createFenceCurveBlockParts(
        fence,
        startInsetT,
        endInsetT,
        baseHeight / 2,
        baseHeight,
        baseDepth,
      ),
    )
  }
  const railCount = Math.min(3, Math.max(2, Math.round(fence.picketRailCount)))
  for (let index = 0; index < railCount; index += 1) {
    const centerY = picketBottom + shortestPicketHeight * (0.2 + (0.55 * index) / (railCount - 1))
    rail.push(
      ...createFenceCurveBlockParts(
        fence,
        railStartT,
        railEndT,
        centerY,
        railHeight,
        railDepth,
        0.22,
      ),
    )
  }

  // Lay out each bay independently so boards never intersect the structural posts.
  const bayLength = length / postCount
  const usableLength = bayLength - 2 * endInset - picketWidth
  if (fence.showInfill && usableLength >= 0) {
    const faceOffset = getInfillOffset(fence, railDepth, picketDepth)
    for (let bay = 0; bay < postCount; bay += 1) {
      const distances =
        fence.patternDistribution === 'automatic'
          ? (() => {
              const count = Math.max(1, Math.floor(usableLength / spacing) + 1)
              const occupied = (count - 1) * spacing
              return Array.from(
                { length: count },
                (_, index) => bay * bayLength + (bayLength - occupied) / 2 + index * spacing,
              )
            })()
          : distributePattern(
              fence,
              bay * bayLength + endInset + picketWidth / 2,
              (bay + 1) * bayLength - endInset - picketWidth / 2,
              fence.picketSpacing,
              picketWidth + curveClearance + 0.01,
            )
      for (let index = 0; index < distances.length; index += 1) {
        const distance = distances[index]!
        const frame = getFenceCenterlineFrameAt(fence, distance / length)
        const u = distances.length === 1 ? 0.5 : index / (distances.length - 1)
        const arch = Math.sin(Math.PI * u)
        const reduction =
          fence.picketProfile === 'arched'
            ? 1 - arch
            : fence.picketProfile === 'scalloped'
              ? arch
              : fence.picketProfile === 'alternating'
                ? index % 2
                : 0
        const boardHeight = picketHeight - variation * reduction
        infill.push({
          position: [
            frame.point.x + frame.normal.x * faceOffset,
            picketBottom + boardHeight / 2,
            frame.point.y + frame.normal.y * faceOffset,
          ],
          rotationY: -Math.atan2(frame.tangent.y, frame.tangent.x),
          scale: [picketWidth, boardHeight, picketDepth],
          shape: 'picket',
          picketTop: fence.picketTop,
        })
      }
    }
  }
  return { posts, infill, base, rail }
}

type HeightTransition = {
  t: number
  before: number
  after: number
}

function fenceHeightTransitions(fence: FenceNode, heightAt: (x: number, z: number) => number) {
  const length = getFenceCenterlineLength(fence)
  const count = Math.max(2, Math.ceil(length / 0.06))
  const transitions: HeightTransition[] = []
  let previous = getFencePointAt(fence, 0).point
  let previousHeight = heightAt(previous.x, previous.y)
  for (let index = 1; index <= count; index += 1) {
    const point = getFencePointAt(fence, index / count).point
    const height = heightAt(point.x, point.y)
    if (Math.abs(height - previousHeight) >= 0.12) {
      const t = (index - 0.5) / count
      const last = transitions.at(-1)
      if (last && (t - last.t) * length < 0.18) {
        last.after = height
      } else {
        transitions.push({ t, before: previousHeight, after: height })
      }
    }
    previous = point
    previousHeight = height
  }
  return transitions
}

function createFencePathProgress(fence: FenceNode) {
  const length = getFenceCenterlineLength(fence)
  const count = Math.max(2, Math.ceil(length / 0.15))
  const points = Array.from(
    { length: count + 1 },
    (_, index) => getFencePointAt(fence, index / count).point,
  )
  return (x: number, z: number) => {
    let bestT = 0
    let bestDistance = Number.POSITIVE_INFINITY
    for (let index = 1; index <= count; index += 1) {
      const previous = points[index - 1]!
      const next = points[index]!
      const dx = next.x - previous.x
      const dz = next.y - previous.y
      const squared = dx * dx + dz * dz
      const fraction =
        squared > 1e-8
          ? THREE.MathUtils.clamp(((x - previous.x) * dx + (z - previous.y) * dz) / squared, 0, 1)
          : 0
      const px = previous.x + dx * fraction
      const pz = previous.y + dz * fraction
      const distance = (x - px) ** 2 + (z - pz) ** 2
      if (distance < bestDistance) {
        bestDistance = distance
        bestT = (index - 1 + fraction) / count
      }
    }
    return bestT
  }
}

function transitionRailHeight(
  fence: FenceNode,
  rawHeight: (x: number, z: number) => number,
  transitions: HeightTransition[],
) {
  const length = getFenceCenterlineLength(fence)
  const halfSpan = Math.max(0.1, fence.transitionWidth / 2) / Math.max(length, 0.01)
  const progress = createFencePathProgress(fence)
  const ramps = transitions.map((transition) => {
    const left = Math.max(0, transition.t - halfSpan)
    const right = Math.min(1, transition.t + halfSpan)
    const beforePoint = getFencePointAt(fence, left).point
    const afterPoint = getFencePointAt(fence, right).point
    return {
      left,
      right,
      before: rawHeight(beforePoint.x, beforePoint.y),
      after: rawHeight(afterPoint.x, afterPoint.y),
    }
  })
  return (x: number, z: number) => {
    const t = progress(x, z)
    for (const ramp of ramps) {
      if (t < ramp.left || t > ramp.right) continue
      return THREE.MathUtils.lerp(
        ramp.before,
        ramp.after,
        (t - ramp.left) / Math.max(ramp.right - ramp.left, 1e-6),
      )
    }
    return rawHeight(x, z)
  }
}

export function createFenceRailHeightSampler(
  fence: FenceNode,
  heightAt: (x: number, z: number) => number,
) {
  if (fence.surfaceMode === 'level' || fence.transitionMode !== 'slope') return heightAt
  const transitions = fenceHeightTransitions(fence, heightAt)
  return transitions.length > 0 ? transitionRailHeight(fence, heightAt, transitions) : heightAt
}

function addTransitionPosts(
  fence: FenceNode,
  parts: FenceSlotParts,
  transitions: HeightTransition[],
) {
  const length = getFenceCenterlineLength(fence)
  const width = Math.max(fence.postSize, fence.transitionMode === 'step' ? 0.22 : 0.07)
  const depth = Math.max(fence.thickness, width)
  for (const transition of transitions) {
    if (fence.transitionMode === 'break') {
      const offset = Math.min(0.08 / Math.max(length, 0.01), 0.2)
      for (const t of [Math.max(0, transition.t - offset), Math.min(1, transition.t + offset)]) {
        const frame = getFencePointAt(fence, t)
        parts.posts.push({
          position: [frame.point.x, fence.height / 2, frame.point.y],
          rotationY: -frame.tangentAngle,
          scale: [width, fence.height, depth],
        })
      }
    } else {
      const frame = getFencePointAt(fence, transition.t)
      const rise = Math.abs(transition.after - transition.before)
      parts.posts.push({
        position: [frame.point.x, (fence.height + rise) / 2, frame.point.y],
        rotationY: -frame.tangentAngle,
        scale: [width, fence.height + rise, depth],
        heightOverride: Math.min(transition.before, transition.after),
      })
    }
  }
}

function omitCrossingParts(parts: FencePart[], transitions: HeightTransition[]) {
  return parts.filter(
    (part) =>
      part.startT === undefined ||
      part.endT === undefined ||
      !transitions.some((transition) => transition.t > part.startT! && transition.t < part.endT!),
  )
}

function cutFenceParts(
  fence: FenceNode,
  parts: FenceSlotParts,
  features: ResolvedFenceFeature[],
  heightAt?: (x: number, z: number) => number,
  renderFeatures = true,
) {
  const progress = createFencePathProgress(fence)
  for (const slot of ['posts', 'infill', 'base', 'rail'] as const) {
    parts[slot] = parts[slot].flatMap((part) => {
      if (part.startT === undefined || part.endT === undefined || !part.curveBlock) {
        const t = progress(part.position[0], part.position[2])
        return features.some((feature) => t >= feature.startT && t <= feature.endT) ? [] : [part]
      }
      const ranges: Array<[number, number]> = []
      let cursor = part.startT
      for (const feature of features) {
        if (feature.endT <= cursor || feature.startT >= part.endT) continue
        if (feature.startT > cursor) ranges.push([cursor, Math.min(feature.startT, part.endT)])
        cursor = Math.max(cursor, feature.endT)
        if (cursor >= part.endT) break
      }
      if (cursor < part.endT) ranges.push([cursor, part.endT])
      if (ranges.length === 1 && ranges[0]![0] === part.startT && ranges[0]![1] === part.endT)
        return [part]
      part.geometry?.dispose()
      return ranges.flatMap(([start, end]) => {
        const block = part.curveBlock!
        const clipped = createFenceCurveBlockPart(
          fence,
          start,
          end,
          block.centerY,
          block.height,
          block.depth,
          block.lateralOffset,
        )
        return clipped ? [clipped] : []
      })
    })
  }

  if (!renderFeatures) return
  for (const feature of features) {
    const matchesFence = feature.matchFenceStyle !== false
    const styleDefaults = getStyleDefaults(fence.style)
    const postWidth = matchesFence
      ? fence.style === 'picket'
        ? Math.max(fence.postSize, 0.02)
        : fence.style === 'horizontal'
          ? Math.max(fence.postSize * 1.4, 0.04)
          : Math.max(fence.postSize * styleDefaults.postFactor, 0.01)
      : Math.max(fence.postSize, 0.05)
    const postDepth =
      matchesFence && fence.style === 'horizontal'
        ? postWidth
        : matchesFence && fence.style !== 'picket'
          ? Math.max(Math.max(fence.thickness, 0.03) * 0.35 - 0.001, 0.011)
          : Math.max(fence.thickness, postWidth)
    const { bottom, height, postBottom, postHeight } = getFenceFeatureDimensions(fence, feature)
    const top = bottom + height
    if (feature.showPosts !== false)
      for (const t of [feature.startT, feature.endT]) {
        const frame = getFencePointAt(fence, t)
        parts.posts.push({
          position: [frame.point.x, postBottom + postHeight / 2, frame.point.y],
          rotationY: -frame.tangentAngle,
          scale: [postWidth, postHeight, postDepth],
        })
        if (
          matchesFence &&
          fence.postCap !== 'none' &&
          (fence.style === 'picket' || fence.style === 'horizontal')
        ) {
          const horizontal = fence.style === 'horizontal'
          const capHeight = horizontal
            ? Math.max(postWidth * 0.32, 0.03)
            : postWidth * (fence.postCap === 'flat' ? 0.2 : 0.5)
          const capScale = horizontal ? 1.22 : 1.5
          parts.posts.push({
            position: [
              frame.point.x,
              postBottom +
                postHeight +
                (horizontal && fence.postCap === 'pyramid' ? capHeight * 0.9 : capHeight / 2),
              frame.point.y,
            ],
            rotationY: -frame.tangentAngle,
            scale: [
              postWidth * (horizontal && fence.postCap === 'pyramid' ? 1.18 : capScale),
              horizontal && fence.postCap === 'pyramid' ? capHeight * 1.8 : capHeight,
              postDepth * (horizontal && fence.postCap === 'pyramid' ? 1.18 : capScale),
            ],
            shape: fence.postCap === 'pyramid' ? 'pyramid' : 'box',
          })
        }
      }
    if (feature.kind !== 'gate') continue
    const style = matchesFence
      ? fence.style
      : !feature.style || feature.style === 'match'
        ? 'picket'
        : feature.style
    const hostPostWidth =
      fence.style === 'picket'
        ? Math.max(fence.postSize, 0.02)
        : fence.style === 'horizontal'
          ? Math.max(fence.postSize * 1.4, 0.04)
          : Math.max(fence.postSize * styleDefaults.postFactor, 0.01)
    const member = Math.min(
      matchesFence
        ? fence.style === 'rail'
          ? Math.max(fence.topRailHeight * styleDefaults.topFactor, 0.01)
          : Math.max(fence.picketWidth, hostPostWidth * 0.55)
        : (feature.frameWidth ?? 0.055),
      height / 4,
    )
    const matchedDepth =
      fence.style === 'picket'
        ? Math.max(Math.min(fence.thickness * 0.5, 0.052), 0.01)
        : fence.style === 'slat'
          ? Math.max(fence.thickness * 0.35, 0.011)
          : Math.max(fence.thickness, 0.03)
    const depth = matchesFence ? matchedDepth : (feature.thickness ?? 0.06)
    const leaves = getFenceGateLeaves(fence, feature)
    // A swinging leaf is rigid: both leaves share the higher jamb elevation.
    const support = Math.max(
      ...[feature.startT, feature.endT].map((t) => {
        const point = getFencePointAt(fence, t).point
        return heightAt?.(point.x, point.y) ?? 0
      }),
    )
    for (const leaf of leaves) {
      const width = leaf.width
      const frame = Math.min(member, width / 4)
      const innerWidth = width - frame * 2
      const innerHeight = height - frame * 2
      const cos = Math.cos(leaf.rotation)
      const sin = Math.sin(leaf.rotation)
      const add = (
        x: number,
        y: number,
        z: number,
        w: number,
        h: number,
        d: number,
        rotationZ = 0,
        picket = false,
      ) => {
        parts.infill.push({
          position: [leaf.hinge.x + cos * x - sin * z, y, leaf.hinge.y + sin * x + cos * z],
          rotationY: -leaf.rotation,
          rotationZ,
          scale: [w, h, d],
          heightOverride: support,
          shape: picket ? 'picket' : 'box',
          picketTop: fence.picketTop,
        })
      }
      for (const x of [frame / 2, width - frame / 2])
        add(x, bottom + height / 2, 0, frame, height, depth)
      const railThickness =
        matchesFence && style === 'rail'
          ? Math.max(fence.topRailHeight * styleDefaults.topFactor, 0.01)
          : frame
      for (const y of [
        bottom + railThickness / 2,
        top + (style === 'rail' && matchesFence ? railThickness / 2 : -railThickness / 2),
      ])
        add(width / 2, y, 0, innerWidth, railThickness, depth)
      const matchedSpacing =
        fence.style === 'picket'
          ? fence.picketSpacing
          : fence.style === 'slat'
            ? fence.postSpacing * styleDefaults.spacingFactor
            : fence.style === 'horizontal'
              ? 0.155 + Math.max(fence.slatGap, 0)
              : 0.15
      const spacing = Math.max(matchesFence ? matchedSpacing : (feature.spacing ?? 0.15), 0.04)
      const matchedBoardWidth =
        fence.style === 'picket'
          ? fence.picketWidth
          : fence.style === 'slat'
            ? hostPostWidth
            : fence.style === 'horizontal'
              ? 0.14
              : 0.055
      const board = Math.min(
        matchesFence ? matchedBoardWidth : (feature.boardWidth ?? 0.055),
        innerWidth,
      )
      if (style === 'privacy')
        add(width / 2, bottom + height / 2, 0, innerWidth, innerHeight, depth * 0.6)
      else if (style === 'horizontal') {
        const count = Math.max(1, Math.floor(innerHeight / spacing))
        const boardHeight = Math.min(board, (innerHeight / count) * 0.8)
        for (let i = 0; i < count; i++)
          add(
            width / 2,
            bottom + frame + (innerHeight * (i + 0.5)) / count,
            0,
            innerWidth,
            boardHeight,
            depth * 0.65,
          )
      } else if (style !== 'rail') {
        const count = Math.max(1, Math.floor(innerWidth / Math.max(spacing, board + 0.015)))
        for (let i = 0; i < count; i++)
          add(
            frame + (innerWidth * (i + 0.5)) / count,
            bottom + height / 2,
            0,
            Math.min(board, (innerWidth / count) * 0.8),
            innerHeight,
            depth * 0.65,
            0,
            style === 'picket',
          )
      }
      if (feature.brace && feature.brace !== 'none') {
        const angle = Math.atan2(innerHeight, innerWidth)
        add(
          width / 2,
          bottom + height / 2,
          depth * 0.65,
          Math.hypot(innerWidth, innerHeight),
          frame * 0.7,
          depth * 0.35,
          angle,
        )
        if (feature.brace === 'cross')
          add(
            width / 2,
            bottom + height / 2,
            -depth * 0.65,
            Math.hypot(innerWidth, innerHeight),
            frame * 0.7,
            depth * 0.35,
            -angle,
          )
      }
      if (feature.showHardware !== false) {
        for (const y of [bottom + height * 0.25, bottom + height * 0.75])
          add(0, y, depth * 0.7, frame * 1.3, 0.075, depth * 0.6)
        add(
          width - frame,
          bottom + height * 0.55,
          depth * 0.8,
          Math.min(0.12, width / 4),
          0.025,
          depth * 0.6,
        )
      }
    }
  }
}

function mergeFenceParts(
  parts: FencePart[],
  heightAt?: (x: number, z: number) => number,
): THREE.BufferGeometry {
  // An empty slot group (e.g. infill with showInfill off, or base on a floating
  // fence) must not reach mergeGeometries — it throws on an empty array. The
  // empty geometry has no position attribute, so the renderer skips its mesh.
  if (parts.length === 0) return new THREE.BufferGeometry()
  const geometries = parts.map((part) => {
    const geometry = createFencePartGeometry(part)
    if (heightAt) {
      const positions = geometry.getAttribute('position')
      if (positions) {
        for (let index = 0; index < positions.count; index += 1) {
          const x = positions.getX(index)
          const z = positions.getZ(index)
          const lift =
            part.heightOverride !== undefined
              ? part.heightOverride
              : part.geometry
                ? heightAt(x, z)
                : heightAt(part.position[0], part.position[2])
          positions.setY(index, positions.getY(index) + lift)
        }
        positions.needsUpdate = true
        geometry.computeVertexNormals()
      }
    }
    if (!geometry.index) return geometry
    const nonIndexed = geometry.toNonIndexed()
    geometry.dispose()
    return nonIndexed
  })
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
  fence: FenceWithFeatures,
  heightAt?: (x: number, z: number) => number,
  mode: 'all' | 'body' | 'features' = 'all',
  omitEndpointPosts?: ReadonlySet<'start' | 'end'>,
  cornerNeighbors?: FenceCornerNeighbors,
): Record<FenceSlotId, THREE.BufferGeometry> {
  const parts =
    mode === 'features'
      ? { posts: [], infill: [], base: [], rail: [] }
      : createFenceParts(fence, omitEndpointPosts)
  if (omitEndpointPosts?.size) {
    parts.posts = parts.posts.filter(
      (part) => !part.endpoint || !omitEndpointPosts.has(part.endpoint),
    )
  }
  if (cornerNeighbors) {
    for (const slot of ['base', 'rail', 'infill'] as const) {
      if (slot === 'infill' && fence.style !== 'horizontal') continue
      for (const part of parts[slot]) {
        for (const endpoint of ['start', 'end'] as const) {
          const neighbor = cornerNeighbors[endpoint]
          if (neighbor) miterFencePartEnd(fence, part, endpoint, neighbor)
        }
      }
    }
  }
  const features = resolveFenceFeatures(fence)
  if (features.length > 0) cutFenceParts(fence, parts, features, heightAt, mode !== 'body')
  const transitions =
    mode !== 'features' && heightAt && fence.surfaceMode !== 'level'
      ? fenceHeightTransitions(fence, heightAt)
      : []
  if (heightAt && transitions.length > 0 && fence.transitionMode !== 'slope') {
    addTransitionPosts(fence, parts, transitions)
    parts.rail = omitCrossingParts(parts.rail, transitions)
    parts.base = omitCrossingParts(parts.base, transitions)
    if (fence.style === 'horizontal') parts.infill = omitCrossingParts(parts.infill, transitions)
  }
  const railHeightAt =
    heightAt && transitions.length > 0 && fence.transitionMode === 'slope'
      ? transitionRailHeight(fence, heightAt, transitions)
      : heightAt
  return {
    posts: mergeFenceParts(parts.posts, heightAt),
    infill: mergeFenceParts(parts.infill, fence.style === 'horizontal' ? railHeightAt : heightAt),
    base: mergeFenceParts(parts.base, railHeightAt),
    rail: mergeFenceParts(parts.rail, railHeightAt),
  }
}

export function generateFenceGeometry(
  fence: FenceNode,
  heightAt?: (x: number, z: number) => number,
) {
  const slots = generateFenceSlotGeometries(fence, heightAt)
  const geometries = Object.values(slots).filter((geometry) => geometry.getAttribute('position'))
  const merged = mergeGeometries(geometries, false) ?? new THREE.BufferGeometry()
  for (const geometry of Object.values(slots)) geometry.dispose()
  return merged
}
