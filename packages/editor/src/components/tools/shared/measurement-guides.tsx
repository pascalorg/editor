import { useViewer } from '@pascal-app/viewer'
import { useEffect, useMemo } from 'react'
import { BufferGeometry, Vector3 } from 'three'
import { EDITOR_LAYER } from '../../../lib/constants'
import useEditor from '../../../store/use-editor'
import { DrawingDimensionLabel } from './drawing-dimension-label'
import {
  formatDistance,
  getPlanDistance,
  getPlanMidpoint,
  MIN_DRAW_DISTANCE,
} from './drawing-utils'

const MeasurementGuideLine = ({
  end,
  levelY,
  start,
}: {
  start: [number, number]
  end: [number, number]
  levelY: number
}) => {
  const unitSystem = useViewer((state) => state.unitSystem)
  const distance = useMemo(() => getPlanDistance(start, end), [end, start])
  const midpoint = useMemo(() => getPlanMidpoint(start, end), [end, start])
  const geometry = useMemo(() => {
    return new BufferGeometry().setFromPoints([
      new Vector3(start[0], levelY + 0.02, start[1]),
      new Vector3(end[0], levelY + 0.02, end[1]),
    ])
  }, [end, levelY, start])

  useEffect(() => {
    return () => {
      geometry.dispose()
    }
  }, [geometry])

  if (distance < MIN_DRAW_DISTANCE) return null

  return (
    <>
      {/* @ts-ignore */}
      <line frustumCulled={false} layers={EDITOR_LAYER} raycast={() => {}} renderOrder={1}>
        <primitive attach="geometry" object={geometry} />
        <lineBasicNodeMaterial
          color="#fbbf24"
          depthTest={false}
          depthWrite={false}
          linewidth={2}
          opacity={0.8}
          transparent
        />
      </line>

      <DrawingDimensionLabel
        position={[midpoint[0], levelY + 0.18, midpoint[1]]}
        value={formatDistance(distance, unitSystem)}
      />
    </>
  )
}

export const MeasurementGuides: React.FC = () => {
  const currentLevelId = useViewer((state) => state.selection.levelId)
  const showGuides = useViewer((state) => state.showGuides)
  const measurementGuides = useEditor((state) => state.measurementGuides)

  const visibleGuides = useMemo(() => {
    if (!(showGuides && currentLevelId)) return []
    return measurementGuides.filter((guide) => guide.levelId === currentLevelId)
  }, [currentLevelId, measurementGuides, showGuides])

  if (visibleGuides.length === 0) return null

  return (
    <group>
      {visibleGuides.map((guide) => (
        <MeasurementGuideLine
          end={guide.end}
          key={guide.id}
          levelY={guide.levelY}
          start={guide.start}
        />
      ))}
    </group>
  )
}
