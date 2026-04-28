'use client'

import {
  type AnyNode,
  type BuildingNode,
  type CeilingNode,
  type DoorNode,
  type FenceNode,
  type GuideNode,
  type LevelNode,
  type RoofNode,
  type SiteNode,
  type SlabNode,
  useScene,
  type WallNode,
  type WindowNode,
  type ZoneNode as ZoneNodeType,
} from '@pascal-app/core'
import { useShallow } from 'zustand/react/shallow'
import { collectLevelDescendants } from '../../lib/floorplan'

type OpeningNode = WindowNode | DoorNode

const DEFAULT_BUILDING_POSITION = [0, 0, 0] as const satisfies [number, number, number]

function useLevelChildren<TNode extends AnyNode>(
  levelId: LevelNode['id'] | null,
  typeGuard: (node: AnyNode | undefined) => node is TNode,
) {
  return useScene(
    useShallow((state) => {
      if (!levelId) {
        return [] as TNode[]
      }

      const levelNode = state.nodes[levelId]
      if (!levelNode || levelNode.type !== 'level') {
        return [] as TNode[]
      }

      return levelNode.children.map((childId) => state.nodes[childId]).filter(typeGuard)
    }),
  )
}

export function useFloorplanSceneData({
  buildingId,
  levelId,
}: {
  buildingId: BuildingNode['id'] | null
  levelId: LevelNode['id'] | null
}) {
  const levelNode = useScene((state) =>
    levelId ? (state.nodes[levelId] as LevelNode | undefined) : undefined,
  )
  const currentBuildingId =
    levelNode?.type === 'level' && levelNode.parentId
      ? (levelNode.parentId as BuildingNode['id'])
      : buildingId

  const buildingRotationY = useScene((state) => {
    if (!currentBuildingId) return 0
    const node = state.nodes[currentBuildingId]
    return node?.type === 'building' ? (node.rotation[1] ?? 0) : 0
  })

  const buildingPosition = useScene((state) => {
    if (!currentBuildingId) {
      return DEFAULT_BUILDING_POSITION
    }

    const node = state.nodes[currentBuildingId]
    return node?.type === 'building'
      ? (node.position as [number, number, number])
      : DEFAULT_BUILDING_POSITION
  })

  const site = useScene((state) => {
    for (const rootNodeId of state.rootNodeIds) {
      const node = state.nodes[rootNodeId]
      if (node?.type === 'site') {
        return node as SiteNode
      }
    }

    return null
  })

  const floorplanLevels = useScene(
    useShallow((state) => {
      if (!currentBuildingId) {
        return [] as LevelNode[]
      }

      const buildingNode = state.nodes[currentBuildingId]
      if (!buildingNode || buildingNode.type !== 'building') {
        return [] as LevelNode[]
      }

      return buildingNode.children
        .map((childId) => state.nodes[childId])
        .filter((node): node is LevelNode => node?.type === 'level')
        .sort((a, b) => a.level - b.level)
    }),
  )

  const walls = useLevelChildren(levelId, (node): node is WallNode => node?.type === 'wall')
  const fences = useLevelChildren(levelId, (node): node is FenceNode => node?.type === 'fence')
  const slabs = useLevelChildren(levelId, (node): node is SlabNode => node?.type === 'slab')
  const ceilings = useLevelChildren(
    levelId,
    (node): node is CeilingNode => node?.type === 'ceiling',
  )
  const levelGuides = useLevelChildren(levelId, (node): node is GuideNode => node?.type === 'guide')
  const zones = useLevelChildren(levelId, (node): node is ZoneNodeType => node?.type === 'zone')
  const roofs = useScene(
    useShallow((state) => {
      if (!levelId) {
        return [] as RoofNode[]
      }

      const nextLevelNode = state.nodes[levelId]
      if (!nextLevelNode || nextLevelNode.type !== 'level') {
        return [] as RoofNode[]
      }

      return nextLevelNode.children
        .map((childId) => state.nodes[childId])
        .filter((node): node is RoofNode => node?.type === 'roof' && node.visible !== false)
    }),
  )
  const openings = useScene(
    useShallow((state) => {
      if (!levelId) {
        return [] as OpeningNode[]
      }

      const nextLevelNode = state.nodes[levelId]
      if (!nextLevelNode || nextLevelNode.type !== 'level') {
        return [] as OpeningNode[]
      }

      const nextWalls = nextLevelNode.children
        .map((childId) => state.nodes[childId])
        .filter((node): node is WallNode => node?.type === 'wall')

      return nextWalls.flatMap((wall) =>
        wall.children
          .map((childId) => state.nodes[childId])
          .filter((node): node is OpeningNode => node?.type === 'window' || node?.type === 'door'),
      )
    }),
  )
  const levelDescendantNodes = useScene(
    useShallow((state) => {
      if (!levelId) {
        return [] as AnyNode[]
      }

      const nextLevelNode = state.nodes[levelId]
      if (!nextLevelNode || nextLevelNode.type !== 'level') {
        return [] as AnyNode[]
      }

      return collectLevelDescendants(nextLevelNode, state.nodes as Record<string, AnyNode>)
    }),
  )

  return {
    buildingPosition,
    buildingRotationY,
    currentBuildingId,
    ceilings,
    fences,
    floorplanLevels,
    levelDescendantNodes,
    levelGuides,
    levelNode,
    openings,
    roofs,
    site,
    slabs,
    walls,
    zones,
  }
}
