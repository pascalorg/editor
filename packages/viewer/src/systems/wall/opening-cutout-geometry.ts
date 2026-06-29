import type { DoorNode, WindowNode } from '@pascal-app/core'
import * as THREE from 'three'

export type OpeningCutoutNode = DoorNode | WindowNode

export type OpeningCutoutRect = {
  left: number
  right: number
  bottom: number
  top: number
}

// The cutout proxy doubles as the invisible raycast hit target for an opening:
// centered on the wall and extending past both faces so it wins the scene
// raycast over the recessed door/window body for front AND back selection +
// paint. It only needs to clear the wall thickness plus a small proud margin —
// the wall CSG brush ignores this proxy's depth entirely (it rebuilds its own
// full-thickness box from the proxy's X/Y bounds in `collectCutoutBrushes`), so
// a snug depth keeps the cut intact while no longer blanketing the room floor in
// a top-down view (the bug a 1m-deep proxy caused in narrow hallways).
const OPENING_CUTOUT_PROXY_PROUD_MARGIN = 0.08

export function getOpeningCutoutProxyDepth(wallThickness: number): number {
  return Math.max(wallThickness, 0) + OPENING_CUTOUT_PROXY_PROUD_MARGIN
}

type CornerRadii = {
  topLeft: number
  topRight: number
  bottomRight: number
  bottomLeft: number
}

/**
 * Pure cutout profile for a shaped door / window opening. `rect` is in
 * the caller's coordinate frame — the wall CSG pipeline passes wall-local
 * coords, the roof-wall pipeline an origin-centered rect — so the same
 * radii / arch math serves both hosts.
 */
export function buildOpeningCutoutShape(
  opening: OpeningCutoutNode,
  rect: OpeningCutoutRect,
): THREE.Shape {
  const { left, right, bottom, top } = rect
  const width = Math.max(right - left, 1e-6)
  const height = Math.max(top - bottom, 1e-6)
  const shape = new THREE.Shape()

  if (opening.openingShape === 'arch') {
    const halfWidth = width / 2
    const centerX = (left + right) / 2
    const archHeight = Math.min(Math.max(opening.archHeight ?? width / 2, 0.01), height)
    const springY = top - archHeight
    const segments = 32

    shape.moveTo(left, bottom)
    shape.lineTo(right, bottom)
    shape.lineTo(right, springY)
    for (let index = 1; index <= segments; index += 1) {
      const x = right + (left - right) * (index / segments)
      const normalizedX = Math.min(Math.abs((x - centerX) / halfWidth), 1)
      const y = springY + archHeight * Math.sqrt(Math.max(1 - normalizedX * normalizedX, 0))
      shape.lineTo(x, y)
    }
    shape.lineTo(left, bottom)
    shape.closePath()
    return shape
  }

  if (opening.openingShape === 'rounded') {
    const radii = getRoundedOpeningRadii(opening, width, height)
    applyRoundedOpeningShape(shape, left, right, bottom, top, radii)
    return shape
  }

  shape.moveTo(left, bottom)
  shape.lineTo(right, bottom)
  shape.lineTo(right, top)
  shape.lineTo(left, top)
  shape.closePath()
  return shape
}

export function buildOpeningCutoutGeometry(
  opening: OpeningCutoutNode,
  rect: OpeningCutoutRect,
  depth: number,
  wallThickness: number,
): THREE.BufferGeometry {
  const shape = buildOpeningCutoutShape(opening, rect)
  const bevelSize =
    opening.openingShape === 'rounded'
      ? Math.min(
          Math.max(opening.openingRevealRadius ?? 0.025, 0),
          Math.max(wallThickness * 0.45, 0.001),
          Math.max((opening.cornerRadius ?? 0.15) * 0.45, 0.001),
        )
      : 0
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: bevelSize > 0,
    bevelSegments: bevelSize > 0 ? 8 : 0,
    bevelSize,
    bevelThickness: bevelSize,
    curveSegments: 24,
  })

  geometry.translate(0, 0, -depth / 2)
  return geometry
}

/**
 * Whether the cutout profile's bottom edge is a flat chord. Cuts whose
 * bottom sits coplanar with the host wall base get extended slightly
 * downward to keep CSG away from coplanar faces — but only a flat chord
 * may extend; shifting a rounded bottom would distort the profile.
 */
export function hasFlatOpeningCutoutBottom(opening: OpeningCutoutNode): boolean {
  if (opening.openingShape !== 'rounded' || opening.type !== 'window') return true

  if (opening.openingRadiusMode === 'individual') {
    const [, , bottomRight = 0, bottomLeft = 0] = opening.openingCornerRadii ?? [
      0.15, 0.15, 0.15, 0.15,
    ]
    return bottomRight <= 1e-6 && bottomLeft <= 1e-6
  }

  return Math.max(opening.cornerRadius ?? 0.15, 0) <= 1e-6
}

function getRoundedOpeningRadii(
  opening: OpeningCutoutNode,
  width: number,
  height: number,
): CornerRadii {
  if (opening.type !== 'window') {
    if (opening.openingRadiusMode === 'individual') {
      const [topLeft = 0, topRight = 0] = opening.openingTopRadii ?? [0.15, 0.15]

      return normalizeCornerRadii(
        {
          topLeft: Math.max(topLeft, 0),
          topRight: Math.max(topRight, 0),
          bottomRight: 0,
          bottomLeft: 0,
        },
        width,
        height,
      )
    }

    const maxRadius = Math.min(width / 2, height)
    const radius = Math.min(Math.max(opening.cornerRadius ?? 0.15, 0), maxRadius)
    return { topLeft: radius, topRight: radius, bottomRight: 0, bottomLeft: 0 }
  }

  if (opening.openingRadiusMode === 'individual') {
    const [topLeft = 0, topRight = 0, bottomRight = 0, bottomLeft = 0] =
      opening.openingCornerRadii ?? [0.15, 0.15, 0.15, 0.15]

    return normalizeCornerRadii(
      {
        topLeft: Math.max(topLeft, 0),
        topRight: Math.max(topRight, 0),
        bottomRight: Math.max(bottomRight, 0),
        bottomLeft: Math.max(bottomLeft, 0),
      },
      width,
      height,
    )
  }

  const maxRadius = Math.min(width / 2, height / 2)
  const radius = Math.min(Math.max(opening.cornerRadius ?? 0.15, 0), maxRadius)
  return { topLeft: radius, topRight: radius, bottomRight: radius, bottomLeft: radius }
}

function normalizeCornerRadii(radii: CornerRadii, width: number, height: number): CornerRadii {
  const next = { ...radii }
  const maxScale = Math.min(
    1,
    width / Math.max(next.topLeft + next.topRight, 1e-6),
    width / Math.max(next.bottomLeft + next.bottomRight, 1e-6),
    height / Math.max(next.topLeft + next.bottomLeft, 1e-6),
    height / Math.max(next.topRight + next.bottomRight, 1e-6),
  )

  if (maxScale < 1) {
    next.topLeft *= maxScale
    next.topRight *= maxScale
    next.bottomRight *= maxScale
    next.bottomLeft *= maxScale
  }

  return next
}

function applyRoundedOpeningShape(
  shape: THREE.Shape,
  left: number,
  right: number,
  bottom: number,
  top: number,
  radii: CornerRadii,
) {
  const { topLeft, topRight, bottomRight, bottomLeft } = radii

  shape.moveTo(left + bottomLeft, bottom)
  shape.lineTo(right - bottomRight, bottom)
  if (bottomRight > 1e-6) {
    shape.absarc(right - bottomRight, bottom + bottomRight, bottomRight, -Math.PI / 2, 0, false)
  } else {
    shape.lineTo(right, bottom)
  }

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

  shape.lineTo(left, bottom + bottomLeft)
  if (bottomLeft > 1e-6) {
    shape.absarc(left + bottomLeft, bottom + bottomLeft, bottomLeft, Math.PI, Math.PI * 1.5, false)
  } else {
    shape.lineTo(left, bottom)
  }

  shape.closePath()
}
