'use client'

import { useViewer } from '@pascal-app/viewer'
import { Html } from '@react-three/drei'
import { memo, useEffect, useLayoutEffect, useMemo } from 'react'
import { BufferGeometry, Float32BufferAttribute, Line as ThreeLine } from 'three'
import { LineBasicNodeMaterial } from 'three/webgpu'
import { EDITOR_LAYER } from '../../lib/constants'
import useOpeningGuides, {
  type OpeningGuide3D,
  type OpeningGuideVec3,
} from '../../store/use-opening-guides'
import { formatMeasurement } from './measurement-pill'

const DIMENSION_COLOR = 0x81_8c_f8 // indigo — a neutral measurement
const ALIGN_COLOR = 0xef_44_44 // red — a snapped alignment (matches the 2D guide accent)
const DIMENSION_PILL = '#6366f1'
const BADGE_PILL = '#ec4899' // pink — matches the 2D equal-spacing badge

// Shared depth-test-off materials so the guides read on top of the wall and
// don't rebuild GPU buffers as guides churn during a drag.
const dimensionMaterial = new LineBasicNodeMaterial({
  color: DIMENSION_COLOR,
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

const mid = (a: OpeningGuideVec3, b: OpeningGuideVec3): OpeningGuideVec3 => [
  (a[0] + b[0]) / 2,
  (a[1] + b[1]) / 2,
  (a[2] + b[2]) / 2,
]

/**
 * Wall-plane proximity / alignment guides for the 3D editor — the spatial twin
 * of the floor-plan placement dimensions + equal-spacing badges. Subscribes to
 * `useOpeningGuides` (published by the door/window move, placement, and resize
 * interactions each drag tick) and draws sill/head + edge-proximity dimensions, a sill-alignment line, and
 * equal-spacing badges. Coordinates are already in the move tool's render frame
 * (the producer reuses the cursor's `wallLocalToWorld`, so they share the cursor's
 * building-local frame), so this layer mounts beside `Alignment3DGuideLayer` and
 * renders them as-is.
 */
export const OpeningGuides3DLayer = memo(function OpeningGuides3DLayer() {
  const guides = useOpeningGuides((s) => s.guides)
  const unit = useViewer((s) => s.unit)
  if (guides.length === 0) return null
  return (
    <>
      {guides.map((guide) => (
        <OpeningGuide guide={guide} key={guide.id} unit={unit} />
      ))}
    </>
  )
})

function OpeningGuide({ guide, unit }: { guide: OpeningGuide3D; unit: 'metric' | 'imperial' }) {
  if (guide.kind === 'badge') {
    return (
      <Html
        center
        position={guide.at}
        style={{ pointerEvents: 'none', userSelect: 'none' }}
        zIndexRange={[20, 0]}
      >
        <div
          className="whitespace-nowrap rounded-[3px] px-[5px] py-[2px] font-sans font-semibold text-[11px] text-white"
          style={{ backgroundColor: BADGE_PILL }}
        >
          {`= ${formatMeasurement(guide.value, unit)}`}
        </div>
      </Html>
    )
  }

  const material = guide.kind === 'align-line' ? alignMaterial : dimensionMaterial
  return (
    <>
      <GuideSegment from={guide.from} material={material} to={guide.to} />
      {guide.kind === 'dimension' ? (
        <Html
          center
          position={mid(guide.from, guide.to)}
          style={{ pointerEvents: 'none', userSelect: 'none' }}
          zIndexRange={[20, 0]}
        >
          <div
            className="whitespace-nowrap rounded-[3px] px-[5px] py-[2px] font-medium font-sans text-[11px] text-white"
            style={{ backgroundColor: DIMENSION_PILL }}
          >
            {formatMeasurement(guide.value, unit)}
          </div>
        </Html>
      ) : null}
    </>
  )
}

function GuideSegment({
  from,
  to,
  material,
}: {
  from: OpeningGuideVec3
  to: OpeningGuideVec3
  material: LineBasicNodeMaterial
}) {
  // Build the THREE.Line once with a preallocated 2-point position buffer and
  // mount it via <primitive> (the intrinsic <line> JSX element collides with
  // React's SVG <line>). `material` is a module-level constant, so this memo
  // runs exactly once per mounted slot; subsequent drag ticks mutate the
  // existing buffer in place via the layout effect below rather than rebuilding
  // the geometry, line, and GPU buffer every frame.
  const { line, position } = useMemo(() => {
    const position = new Float32BufferAttribute(new Float32Array(6), 3)
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', position)
    const line = new ThreeLine(geometry, material)
    line.frustumCulled = false
    line.layers.set(EDITOR_LAYER)
    line.renderOrder = 1000
    return { line, position }
  }, [material])

  const [fx, fy, fz] = from
  const [tx, ty, tz] = to
  useLayoutEffect(() => {
    position.setXYZ(0, fx, fy, fz)
    position.setXYZ(1, tx, ty, tz)
    position.needsUpdate = true
  }, [position, fx, fy, fz, tx, ty, tz])

  useEffect(() => () => line.geometry.dispose(), [line])
  return <primitive object={line} />
}
