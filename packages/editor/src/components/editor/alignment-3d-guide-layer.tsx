'use client'

import { type AlignmentGuide, sceneRegistry, useAlignmentGuides } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { Html } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { memo, useMemo, useRef } from 'react'
import { BoxGeometry, CircleGeometry, type Group } from 'three'
import { MeshBasicNodeMaterial } from 'three/webgpu'
import { EDITOR_LAYER } from '../../lib/constants'

/**
 * Figma-style alignment guides for the 3D editor — the spatial twin of
 * `FloorplanAlignmentGuideLayer`. Subscribes to the shared
 * `useAlignmentGuides` store (published by the move / placement / wall tools
 * during a drag) and draws each guide as a dashed ribbon on the floor with a
 * flat circular marker at each endpoint and a distance pill.
 *
 * The dashes + dots lie flat on the floor plane (XZ) — a ground ribbon, like
 * the design reference — so they're real 3D geometry, not screen billboards.
 * Only the distance pill is screen-space (`<Html>`).
 *
 * Guide coordinates are XZ meters in the building-local frame; this layer is
 * mounted inside ToolManager's building-local group so they render at the
 * right world position (and line up with the cursor). The whole ribbon is
 * lifted to the active level's building-local Y each frame so it lies on the
 * floor being edited — not the building base — when floors are stacked.
 */

const LINE_COLOR = 0x81_8c_f8 // indigo-400 — matches the editor's selection accent (box-select / wall highlights)
const PILL_COLOR = '#6366f1' // indigo-500 — same hue, darker for white-text contrast
const GUIDE_Y = 0.03 // small lift so guides read above the floor grid
const DASH_LEN = 0.18 // world-meter dash length
const DASH_GAP = 0.12 // world-meter gap between dashes
const LINE_WIDTH = 0.06 // world-meter ribbon thickness
const DOT_RADIUS = 0.11 // world-meter radius of the endpoint markers
const MAX_DASHES = 80 // cap so a very long guide can't spawn thousands of quads

// Shared resources — one violet material + unit geometries scaled per
// instance, so guide churn during a drag doesn't rebuild GPU buffers.
const guideMaterial = new MeshBasicNodeMaterial({
  color: LINE_COLOR,
  depthTest: false,
  depthWrite: false,
  toneMapped: false,
  transparent: true,
})
const DASH_GEOMETRY = new BoxGeometry(1, 1, 1)
const DOT_GEOMETRY = new CircleGeometry(1, 24)

type Vec3 = [number, number, number]

export const Alignment3DGuideLayer = memo(function Alignment3DGuideLayer() {
  const guides = useAlignmentGuides((s) => s.guides)
  const levelId = useViewer((s) => s.selection.levelId)
  const groupRef = useRef<Group>(null)

  // Guides carry only XZ (building-local plan coords); their Y has to track
  // the active level so the ground ribbon lies on the floor being edited,
  // not the building base. Read the level mesh's building-local Y each frame
  // — the same source `grid.tsx` uses, so the ribbon stays locked to the
  // grid plane (and lerps with it during a level switch).
  useFrame(() => {
    const group = groupRef.current
    if (!group) return
    const levelMesh = levelId ? sceneRegistry.nodes.get(levelId) : null
    group.position.y = levelMesh ? levelMesh.position.y : 0
  })

  if (guides.length === 0) return null
  return (
    <group ref={groupRef}>
      {guides.map((guide, i) => (
        <GuideLine guide={guide} key={i} />
      ))}
    </group>
  )
})

function GuideLine({ guide }: { guide: AlignmentGuide }) {
  const { x: fx, z: fz } = guide.from
  const { x: tx, z: tz } = guide.to
  const distLabel = formatMeters(guide.distance)

  // Lay out the dash centres along the from→to direction. The ribbon
  // stretches the dash period up if the line is long enough to exceed the
  // dash cap, so it always reads as a continuous dashed line.
  const { dashes, angleY } = useMemo(() => {
    const dx = tx - fx
    const dz = tz - fz
    const length = Math.hypot(dx, dz)
    const angle = -Math.atan2(dz, dx)
    if (length < 1e-4) return { dashes: [] as Vec3[], angleY: angle }
    const ux = dx / length
    const uz = dz / length
    const period = Math.max(DASH_LEN + DASH_GAP, length / MAX_DASHES)
    const centres: Vec3[] = []
    for (let d = period / 2; d - DASH_LEN / 2 <= length; d += period) {
      centres.push([fx + ux * d, GUIDE_Y, fz + uz * d])
    }
    return { dashes: centres, angleY: angle }
  }, [fx, fz, tx, tz])

  const mid: Vec3 = [(fx + tx) / 2, GUIDE_Y, (fz + tz) / 2]

  return (
    <>
      {dashes.map((centre, i) => (
        <mesh
          geometry={DASH_GEOMETRY}
          key={i}
          layers={EDITOR_LAYER}
          material={guideMaterial}
          position={centre}
          renderOrder={1000}
          rotation={[0, angleY, 0]}
          scale={[DASH_LEN, 0.002, LINE_WIDTH]}
        />
      ))}
      <Dot position={[fx, GUIDE_Y + 0.001, fz]} />
      <Dot position={[tx, GUIDE_Y + 0.001, tz]} />
      {guide.distance > 1e-4 && (
        <Html
          center
          position={mid}
          style={{ pointerEvents: 'none', userSelect: 'none' }}
          zIndexRange={[20, 0]}
        >
          <div
            className="whitespace-nowrap rounded-[3px] px-[5px] py-[2px] font-medium font-sans text-[11px] text-white"
            style={{ backgroundColor: PILL_COLOR }}
          >
            {distLabel}
          </div>
        </Html>
      )}
    </>
  )
}

/** Flat circular marker lying on the floor plane at a guide endpoint. */
function Dot({ position }: { position: Vec3 }) {
  return (
    <mesh
      geometry={DOT_GEOMETRY}
      layers={EDITOR_LAYER}
      material={guideMaterial}
      position={position}
      renderOrder={1001}
      rotation={[-Math.PI / 2, 0, 0]}
      scale={[DOT_RADIUS, DOT_RADIUS, DOT_RADIUS]}
    />
  )
}

function formatMeters(meters: number): string {
  // Sub-centimetre = "0"; otherwise up to 2 decimals, trimmed. Matches the
  // 2D floor-plan guide layer's pill formatting.
  if (meters < 0.005) return '0'
  const fixed = meters.toFixed(2)
  return `${fixed.replace(/\.?0+$/, '')}m`
}
