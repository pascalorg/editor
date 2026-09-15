import {
  type AnyNode,
  type AnyNodeId,
  type BuildingNode,
  deriveUnit,
  UnitNode,
  useScene,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useEffect } from 'react'
import { useShallow } from 'zustand/react/shallow'
import useEditor from '../store/use-editor'

const NO_IDS: AnyNodeId[] = []

export function unitIsolateIds(
  unit: UnitNode,
  nodes: Readonly<Record<AnyNodeId, AnyNode>>,
): AnyNodeId[] {
  return deriveUnit(unit, nodes).visibleNodeIds
}

/** The viewer `isolate` list for the isolated unit, or null when none is isolated. */
export function useUnitIsolateIds(): AnyNodeId[] | null {
  const isolatedUnitId = useEditor((s) => s.isolatedUnitId)
  const ids = useScene(
    useShallow((s) => {
      if (!isolatedUnitId) return NO_IDS
      const unit = s.nodes[isolatedUnitId]
      if (unit?.type !== 'unit') return NO_IDS
      return unitIsolateIds(unit, s.nodes)
    }),
  )
  return isolatedUnitId ? ids : null
}

/** Drops the active / isolated unit ids once their node leaves the scene. */
export function useClearStaleUnitState(): void {
  const activeUnitId = useEditor((s) => s.activeUnitId)
  const isolatedUnitId = useEditor((s) => s.isolatedUnitId)
  const activeExists = useScene((s) => !activeUnitId || s.nodes[activeUnitId]?.type === 'unit')
  const isolatedExists = useScene(
    (s) => !isolatedUnitId || s.nodes[isolatedUnitId]?.type === 'unit',
  )

  useEffect(() => {
    if (!activeExists) useEditor.getState().setActiveUnit(null)
  }, [activeExists])
  useEffect(() => {
    if (!isolatedExists) useEditor.getState().setIsolatedUnit(null)
  }, [isolatedExists])
}

export function createUnitInBuilding(buildingId: BuildingNode['id']): UnitNode['id'] | null {
  const scene = useScene.getState()
  const building = scene.nodes[buildingId]
  if (building?.type !== 'building') return null
  const unitCount = building.children.filter((id) => scene.nodes[id]?.type === 'unit').length
  const unit = UnitNode.parse({ name: `Unit ${unitCount + 1}` })
  scene.createNode(unit, buildingId)
  useEditor.getState().setActiveUnit(unit.id)
  useViewer.getState().setSelection({ selectedIds: [unit.id] })
  return unit.id
}

export function toggleActiveUnitIsolation(): void {
  const { activeUnitId, isolatedUnitId, setIsolatedUnit } = useEditor.getState()
  if (isolatedUnitId) {
    setIsolatedUnit(null)
  } else if (activeUnitId) {
    setIsolatedUnit(activeUnitId)
  }
}
