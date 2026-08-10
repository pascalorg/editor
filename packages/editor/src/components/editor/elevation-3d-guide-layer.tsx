'use client'

import { sceneRegistry } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { Html } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { memo, useMemo, useRef } from 'react'
import { BoxGeometry, CircleGeometry, type Group } from 'three'
import { MeshBasicNodeMaterial } from 'three/webgpu'
import { EDITOR_LAYER } from '../../lib/constants'
import useElevationGuides from '../../store/use-elevation-guides'
import { formatMeasurement } from './measurement-pill'

const LINE_COLOR = 0x81_8c_f8
const PILL_COLOR = '#6366f1'
const GUIDE_LIFT = 0.025
const GUIDE_LENGTH = 2.4
const DASH_LENGTH = 0.16
const DASH_GAP = 0.1
const LINE_WIDTH = 0.035
const DOT_RADIUS = 0.07

const guideMaterial = new MeshBasicNodeMaterial({
  color: LINE_COLOR,
  depthTest: false,
  depthWrite: false,
  toneMapped: false,
  transparent: true,
  opacity: 0.9,
})
const dotMaterial = new MeshBasicNodeMaterial({
  color: LINE_COLOR,
  depthTest: false,
  depthWrite: false,
  toneMapped: false,
  transparent: true,
  opacity: 0.95,
})
const DASH_GEOMETRY = new BoxGeometry(1, 1, 1)
const DOT_GEOMETRY = new CircleGeometry(1, 24)

type Vec3 = [number, number, number]

export const Elevation3DGuideLayer = memo(function Elevation3DGuideLayer() {
  const guide = useElevationGuides((state) => state.guide)
  const unit = useViewer((state) => state.unit)
  const metricNotation = useViewer((state) => state.metricNotation)
  const groupRef = useRef<Group>(null)

  useFrame(() => {
    const group = groupRef.current
    if (!(group && guide)) return
    const levelObject = sceneRegistry.nodes.get(guide.levelId)
    group.position.y = (levelObject?.position.y ?? 0) + guide.elevation + GUIDE_LIFT
  })

  const dashes = useMemo(() => {
    if (!guide) return [] as Vec3[]
    const [cx, cz] = guide.center
    const [dx, dz] = guide.direction
    const start = -GUIDE_LENGTH / 2
    const period = DASH_LENGTH + DASH_GAP
    const centers: Vec3[] = []
    for (let offset = start + DASH_LENGTH / 2; offset < GUIDE_LENGTH / 2; offset += period) {
      centers.push([cx + dx * offset, 0, cz + dz * offset])
    }
    return centers
  }, [guide])

  if (!guide) return null

  const angleY = -Math.atan2(guide.direction[1], guide.direction[0])
  const labelPosition: Vec3 = [
    guide.center[0] - guide.direction[1] * 0.65,
    0.16,
    guide.center[1] + guide.direction[0] * 0.65,
  ]
  const elevationText =
    Math.abs(guide.elevation) < 1e-6
      ? formatMeasurement(0, unit, metricNotation)
      : `${guide.elevation < 0 ? '-' : '+'}${formatMeasurement(Math.abs(guide.elevation), unit, metricNotation)}`

  return (
    <group ref={groupRef}>
      {dashes.map((position, index) => (
        <mesh
          geometry={DASH_GEOMETRY}
          key={index}
          layers={EDITOR_LAYER}
          material={guideMaterial}
          position={position}
          renderOrder={1010}
          rotation={[0, angleY, 0]}
          scale={[DASH_LENGTH, 0.002, LINE_WIDTH]}
        />
      ))}
      <mesh
        geometry={DOT_GEOMETRY}
        layers={EDITOR_LAYER}
        material={dotMaterial}
        position={[guide.center[0], 0.002, guide.center[1]]}
        renderOrder={1011}
        rotation={[-Math.PI / 2, 0, 0]}
        scale={[DOT_RADIUS, DOT_RADIUS, DOT_RADIUS]}
      />
      <Html
        center
        position={labelPosition}
        style={{ pointerEvents: 'none', userSelect: 'none' }}
        zIndexRange={[25, 0]}
      >
        <div
          className="whitespace-nowrap rounded-[3px] px-[5px] py-[2px] font-medium font-sans text-[11px] text-white"
          style={{ backgroundColor: PILL_COLOR }}
        >
          {`${guide.label} · Y ${elevationText}`}
        </div>
      </Html>
    </group>
  )
})
