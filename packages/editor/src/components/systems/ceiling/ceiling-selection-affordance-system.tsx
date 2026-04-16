'use client'

import {
  type CeilingNode,
  resolveLevelId,
  sceneRegistry,
  useScene,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { createPortal, type ThreeEvent } from '@react-three/fiber'
import { useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import useEditor from '../../../store/use-editor'

const BRACKET_THICKNESS = 0.04
const BRACKET_HEIGHT = 0.04
const BRACKET_Y_OFFSET = 0.035
const CORNER_BLOCK_SIZE = 0.085
const HIT_BOX_SIZE: [number, number, number] = [0.24, 0.12, 0.24]
const HIT_INSET = 0.16

type CornerBracketData = {
  corner: [number, number]
  hitCenter: [number, number]
  incomingDirection: [number, number]
  outgoingDirection: [number, number]
  incomingLength: number
  outgoingLength: number
}

export const CeilingSelectionAffordanceSystem = () => {
  const phase = useEditor((state) => state.phase)
  const mode = useEditor((state) => state.mode)
  const structureLayer = useEditor((state) => state.structureLayer)
  const movingNode = useEditor((state) => state.movingNode)
  const curvingWall = useEditor((state) => state.curvingWall)
  const currentLevelId = useViewer((state) => state.selection.levelId)

  const ceilings = useScene(
    useShallow((state) =>
      Object.values(state.nodes).filter((node): node is CeilingNode => {
        return (
          node.type === 'ceiling' &&
          node.visible !== false &&
          currentLevelId !== null &&
          resolveLevelId(node, state.nodes) === currentLevelId
        )
      }),
    ),
  )

  const shouldRender =
    phase === 'structure' &&
    mode === 'select' &&
    structureLayer === 'elements' &&
    !movingNode &&
    !curvingWall &&
    currentLevelId !== null

  if (!shouldRender) return null

  return (
    <>
      {ceilings.map((ceiling) => (
        <CeilingSelectionAffordance ceiling={ceiling} key={ceiling.id} levelId={currentLevelId} />
      ))}
    </>
  )
}

const CeilingSelectionAffordance = ({
  ceiling,
  levelId,
}: {
  ceiling: CeilingNode
  levelId: string
}) => {
  const selectedIds = useViewer((state) => state.selection.selectedIds)
  const isSelected = selectedIds.includes(ceiling.id)
  const levelObject = sceneRegistry.nodes.get(levelId)

  const corners = useMemo(() => buildCornerBrackets(ceiling.polygon), [ceiling.polygon])

  if (!levelObject || corners.length === 0 || isSelected) return null

  return createPortal(
    <group position={[0, (ceiling.height ?? 2.5) + BRACKET_Y_OFFSET, 0]}>
      {corners.map((corner, index) => (
        <CornerBracket
          ceiling={ceiling}
          corner={corner}
          key={`${ceiling.id}-corner-${index}`}
        />
      ))}
    </group>,
    levelObject,
  )
}

const CornerBracket = ({
  ceiling,
  corner,
}: {
  ceiling: CeilingNode
  corner: CornerBracketData
}) => {
  const color = '#d4d4d4'
  const opacity = 0.72

  const handleClick = (e: ThreeEvent<PointerEvent>) => {
    if (e.button !== 0) return
    e.stopPropagation()

    const nodes = useScene.getState().nodes
    const selection = useViewer.getState().selection
    const levelId = resolveLevelId(ceiling, nodes)
    const buildingId = findBuildingId(levelId, nodes)

    useEditor.getState().setMovingNode(null)
    useEditor.getState().setMovingWallEndpoint(null)
    useEditor.getState().setCurvingWall(null)
    useEditor.getState().setEditingHole(null)
    useEditor.getState().setMode('select')

    useViewer.getState().setSelection({
      buildingId: buildingId ?? selection.buildingId,
      levelId,
      selectedIds: [ceiling.id],
    })
  }

  return (
    <group position={[corner.corner[0], 0, corner.corner[1]]}>
      <mesh>
        <boxGeometry args={[CORNER_BLOCK_SIZE, BRACKET_HEIGHT, CORNER_BLOCK_SIZE]} />
        <meshBasicMaterial color={color} depthWrite={false} opacity={opacity} transparent />
      </mesh>

      <BracketLeg
        color={color}
        direction={corner.incomingDirection}
        length={corner.incomingLength}
        opacity={opacity}
      />
      <BracketLeg
        color={color}
        direction={corner.outgoingDirection}
        length={corner.outgoingLength}
        opacity={opacity}
      />

      <mesh
        onPointerDown={handleClick}
        position={[corner.hitCenter[0] - corner.corner[0], 0, corner.hitCenter[1] - corner.corner[1]]}
      >
        <boxGeometry args={HIT_BOX_SIZE} />
        <meshBasicMaterial opacity={0} transparent />
      </mesh>
    </group>
  )
}

const BracketLeg = ({
  direction,
  length,
  color,
  opacity,
}: {
  direction: [number, number]
  length: number
  color: string
  opacity: number
}) => {
  const angle = Math.atan2(direction[1], direction[0])
  const position: [number, number, number] = [
    direction[0] * (length / 2),
    0,
    direction[1] * (length / 2),
  ]

  return (
    <mesh position={position} rotation={[0, angle, 0]}>
      <boxGeometry args={[length, BRACKET_HEIGHT, BRACKET_THICKNESS]} />
      <meshBasicMaterial color={color} depthWrite={false} opacity={opacity} transparent />
    </mesh>
  )
}

function buildCornerBrackets(polygon: Array<[number, number]>): CornerBracketData[] {
  if (polygon.length < 3) return []

  return polygon.map((corner, index) => {
    const previous = polygon[(index - 1 + polygon.length) % polygon.length]!
    const next = polygon[(index + 1) % polygon.length]!
    const incomingVector = [previous[0] - corner[0], previous[1] - corner[1]] as [number, number]
    const outgoingVector = [next[0] - corner[0], next[1] - corner[1]] as [number, number]

    const incomingLength = Math.hypot(incomingVector[0], incomingVector[1])
    const outgoingLength = Math.hypot(outgoingVector[0], outgoingVector[1])
    const insetDirection = normalize2D([
      normalize2D(incomingVector)[0] + normalize2D(outgoingVector)[0],
      normalize2D(incomingVector)[1] + normalize2D(outgoingVector)[1],
    ])

    return {
      corner,
      hitCenter: [
        corner[0] + insetDirection[0] * HIT_INSET,
        corner[1] + insetDirection[1] * HIT_INSET,
      ],
      incomingDirection: normalize2D(incomingVector),
      outgoingDirection: normalize2D(outgoingVector),
      incomingLength: getBracketLength(incomingLength),
      outgoingLength: getBracketLength(outgoingLength),
    }
  })
}

function normalize2D(vector: [number, number]): [number, number] {
  const length = Math.hypot(vector[0], vector[1])
  if (length < 1e-6) return [1, 0]
  return [vector[0] / length, vector[1] / length]
}

function getBracketLength(edgeLength: number): number {
  return Math.max(0.14, Math.min(0.38, edgeLength * 0.22))
}

function findBuildingId(levelId: string | null, nodes: Record<string, { parentId: string | null }>): string | null {
  if (!levelId) return null
  const level = nodes[levelId]
  return level?.parentId ?? null
}
