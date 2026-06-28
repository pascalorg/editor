'use client'

import type { RoofSegmentNode } from '@pascal-app/core'
import { EDITOR_LAYER, formatMeasurement } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { Html } from '@react-three/drei'
import { useEffect, useMemo } from 'react'
import { BufferGeometry, Float32BufferAttribute, Line as ThreeLine } from 'three'
import { LineBasicNodeMaterial } from 'three/webgpu'
import { getRoofSurfaceFaceBoundsAt } from '../shared/roof-surface'
import {
  roofFaceKey,
  roofGuideBounds,
  roofSiblingSpacing,
} from '../shared/roof-surface-placement-guides'

// Indigo — matches the wall/window 3D proximity guide accent so every
// "distance to edge" readout reads the same across the app.
const GUIDE_COLOR = 0x81_8c_f8
const ALIGN_COLOR = 0xef_44_44
const PILL_BG = '#6366f1'
const BADGE_BG = '#ec4899'
// Lift the lines a hair off the sloped surface so they don't z-fight the
// roof + dormer ghost.
const SURFACE_LIFT = 0.02
// Hide a gap that has collapsed (dormer edge flush to / past the roof edge)
// so we don't draw a degenerate "0m" pill.
const MIN_GAP_M = 0.02

const guideMaterial = new LineBasicNodeMaterial({
  color: GUIDE_COLOR,
  depthTest: false,
  depthWrite: false,
  toneMapped: false,
  transparent: true,
})
const alignMaterial = new LineBasicNodeMaterial({
  color: ALIGN_COLOR,
  depthTest: false,
  depthWrite: false,
  toneMapped: false,
  transparent: true,
})

type Vec3 = [number, number, number]
type DormerGuide =
  | {
      id: string
      from: Vec3
      to: Vec3
      kind: 'align-line' | 'dimension'
      value?: number
    }
  | {
      id: string
      at: Vec3
      kind: 'badge'
      value: number
    }

/**
 * Live "distance to roof edge" guides shown while a dormer ghost is being
 * placed or dragged — the roof-plane analog of the window's sill/head +
 * edge-proximity pills. Renders measured lines from each side-center of
 * the dormer's occupied roof area out to the active roof face edges, each
 * with a distance pill at its midpoint.
 *
 * Mounted as a sibling of `<DormerPreview>` INSIDE the segment-local frame
 * (the `segmentXform` group) but OUTSIDE the dormer's `hitLocal` + rotation
 * groups, so its coordinates are segment-local. The roof-face boundary is
 * resolved from the actual visible top face under `center`, not from the
 * wall footprint dimensions.
 *
 * Normal roof accessories use side-center readouts. Linear accessories
 * like ridge vents and gutters use their own two-end guide mode.
 */
export function DormerPlacementGuides({
  segment,
  center,
  width,
  depth,
  rotation,
  movingId,
}: {
  segment: RoofSegmentNode
  center: Vec3
  width: number
  depth: number
  rotation: number
  movingId?: string
}) {
  const unit = useViewer((s) => s.unit)

  const [cx, , cz] = center
  const faceBounds = getRoofSurfaceFaceBoundsAt(segment, cx, cz)
  const halfW = Math.max(0, width) / 2
  const halfD = Math.max(0, depth) / 2
  const cos = Math.cos(rotation)
  const sin = Math.sin(rotation)
  const halfX = Math.abs(cos) * halfW + Math.abs(sin) * halfD
  const halfZ = Math.abs(sin) * halfW + Math.abs(cos) * halfD
  const movingBounds = roofGuideBounds(center, { width, depth, rotation })

  const surfaceY = (x: number, z: number): number => faceBounds.surfaceYAt(x, z) + SURFACE_LIFT

  const xInterval = faceBounds.xIntervalAtZ(cz)
  const zInterval = faceBounds.zIntervalAtX(cx)

  const guides: DormerGuide[] = []
  const push = (id: string, ax: number, az: number, bx: number, bz: number) => {
    const from: Vec3 = [ax, surfaceY(ax, az), az]
    const to: Vec3 = [bx, surfaceY(bx, bz), bz]
    const value = Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2])
    if (value < MIN_GAP_M) return
    guides.push({
      id,
      from,
      to,
      kind: 'dimension',
      value,
    })
  }
  const siblingSpacing = roofSiblingSpacing<DormerGuide>({
    segment,
    movingId,
    movingBounds,
    faceKey: roofFaceKey(faceBounds.polygon),
    dimension: (id, [ax, az], [bx, bz]) => {
      const from: Vec3 = [ax, surfaceY(ax, az), az]
      const to: Vec3 = [bx, surfaceY(bx, bz), bz]
      const value = Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2])
      if (value < MIN_GAP_M) return null
      return { id, from, to, kind: 'dimension', value }
    },
    alignLine: (id, [ax, az], [bx, bz]) => {
      const from: Vec3 = [ax, surfaceY(ax, az), az]
      const to: Vec3 = [bx, surfaceY(bx, bz), bz]
      const value = Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2])
      if (value < MIN_GAP_M) return null
      return { id, from, to, kind: 'align-line' }
    },
    badge: (id, [x, z], value) => {
      if (value < MIN_GAP_M) return null
      return {
        id,
        at: [x, surfaceY(x, z), z],
        kind: 'badge',
        value,
      }
    },
    measure: ([ax, az], [bx, bz]) => {
      const ay = surfaceY(ax, az)
      const by = surfaceY(bx, bz)
      return Math.hypot(bx - ax, by - ay, bz - az)
    },
  })
  if (xInterval) {
    const [faceMinX, faceMaxX] = xInterval
    const itemMinX = Math.max(faceMinX, Math.min(faceMaxX, cx - halfX))
    const itemMaxX = Math.max(faceMinX, Math.min(faceMaxX, cx + halfX))
    if (!siblingSpacing.blockedSides.left && itemMinX > faceMinX + MIN_GAP_M) {
      push('left', faceMinX, cz, itemMinX, cz)
    }
    if (!siblingSpacing.blockedSides.right && itemMaxX < faceMaxX - MIN_GAP_M) {
      push('right', itemMaxX, cz, faceMaxX, cz)
    }
  }
  if (zInterval) {
    const [faceMinZ, faceMaxZ] = zInterval
    const itemMinZ = Math.max(faceMinZ, Math.min(faceMaxZ, cz - halfZ))
    const itemMaxZ = Math.max(faceMinZ, Math.min(faceMaxZ, cz + halfZ))
    if (!siblingSpacing.blockedSides.bottom && itemMinZ > faceMinZ + MIN_GAP_M) {
      push('back', cx, faceMinZ, cx, itemMinZ)
    }
    if (!siblingSpacing.blockedSides.top && itemMaxZ < faceMaxZ - MIN_GAP_M) {
      push('front', cx, itemMaxZ, cx, faceMaxZ)
    }
  }
  guides.push(...siblingSpacing.guides)

  return (
    <>
      {guides.map((g) => (
        <Guide key={g.id} guide={g} unit={unit} />
      ))}
    </>
  )
}

function Guide({ guide, unit }: { guide: DormerGuide; unit: 'metric' | 'imperial' }) {
  if (guide.kind === 'badge') {
    return <GuideBadge at={guide.at} pill={`= ${formatMeasurement(guide.value, unit)}`} />
  }

  return (
    <GuideLine
      from={guide.from}
      kind={guide.kind}
      pill={guide.value === undefined ? undefined : formatMeasurement(guide.value, unit)}
      to={guide.to}
    />
  )
}

function GuideBadge({ at, pill }: { at: Vec3; pill: string }) {
  return (
    <Html
      center
      position={at}
      style={{ pointerEvents: 'none', userSelect: 'none' }}
      zIndexRange={[20, 0]}
    >
      <div
        className="whitespace-nowrap rounded-[3px] px-[5px] py-[2px] font-semibold font-sans text-[11px] text-white"
        style={{ backgroundColor: BADGE_BG }}
      >
        {pill}
      </div>
    </Html>
  )
}

function GuideLine({
  from,
  to,
  pill,
  kind,
}: {
  from: Vec3
  to: Vec3
  pill?: string
  kind: DormerGuide['kind']
}) {
  const { line, position } = useMemo(() => {
    const position = new Float32BufferAttribute(new Float32Array(6), 3)
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', position)
    const line = new ThreeLine(geometry, kind === 'align-line' ? alignMaterial : guideMaterial)
    line.frustumCulled = false
    line.layers.set(EDITOR_LAYER)
    line.renderOrder = 1000
    return { line, position }
  }, [kind])

  position.setXYZ(0, from[0], from[1], from[2])
  position.setXYZ(1, to[0], to[1], to[2])
  position.needsUpdate = true

  useEffect(() => () => line.geometry.dispose(), [line])

  const mid: Vec3 = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2, (from[2] + to[2]) / 2]

  return (
    <>
      <primitive object={line} />
      {pill ? (
        <Html
          center
          position={mid}
          style={{ pointerEvents: 'none', userSelect: 'none' }}
          zIndexRange={[20, 0]}
        >
          <div
            className="whitespace-nowrap rounded-[3px] px-[5px] py-[2px] font-medium font-sans text-[11px] text-white"
            style={{ backgroundColor: PILL_BG }}
          >
            {pill}
          </div>
        </Html>
      ) : null}
    </>
  )
}
