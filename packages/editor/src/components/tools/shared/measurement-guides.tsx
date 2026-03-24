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
  isHovered,
  isSelected,
  end,
  levelY,
  start,
}: {
  start: [number, number]
  end: [number, number]
  levelY: number
  isSelected: boolean
  isHovered: boolean
}) => {
  const unitSystem = useViewer((state) => state.unitSystem)
  const distance = useMemo(() => getPlanDistance(start, end), [end, start])
  const midpoint = useMemo(() => getPlanMidpoint(start, end), [end, start])
  const color = isSelected ? '#f97316' : isHovered ? '#f59e0b' : '#fbbf24'
  const opacity = isSelected ? 1 : isHovered ? 0.95 : 0.8
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
          color={color}
          depthTest={false}
          depthWrite={false}
          linewidth={2}
          opacity={opacity}
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
  const selectedMeasurementGuideId = useEditor((state) => state.selectedMeasurementGuideId)
  const hoveredMeasurementGuideId = useEditor((state) => state.hoveredMeasurementGuideId)

  const visibleGuides = useMemo(() => {
    if (!(showGuides && currentLevelId)) return []
    return measurementGuides.filter(
      (guide) => guide.levelId === currentLevelId && guide.visible !== false,
    )
  }, [currentLevelId, measurementGuides, showGuides])

  if (visibleGuides.length === 0) return null

  return (
    <group>
      {visibleGuides.map((guide) => (
        <MeasurementGuideLine
          end={guide.end}
          isHovered={hoveredMeasurementGuideId === guide.id}
          isSelected={selectedMeasurementGuideId === guide.id}
          key={guide.id}
          levelY={guide.levelY}
          start={guide.start}
        />
      ))}
    </group>
  )
}
