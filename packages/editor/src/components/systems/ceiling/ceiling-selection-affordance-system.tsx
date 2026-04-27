'use client'

import {
  type CeilingNode,
  emitter,
  resolveLevelId,
  sceneRegistry,
  useScene,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { createPortal, type ThreeEvent } from '@react-three/fiber'
import { useEffect, useMemo, useState } from 'react'
import type { Object3D } from 'three'
import { useShallow } from 'zustand/react/shallow'
import useEditor from '../../../store/use-editor'

const BRACKET_THICKNESS = 0.04
const BRACKET_HEIGHT = 0.04
const BRACKET_Y_OFFSET = 0.035
const HIT_BOX_SIZE: [number, number, number] = [0.28, 0.08, 0.28]
const HOVER_OPACITY = 0.92

type CornerBracketData = {
  corner: [number, number]
  incomingDirection: [number, number]
  outgoingDirection: [number, number]
  incomingLength: number
  outgoingLength: number
  cornerStrength: number
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
  const [levelObject, setLevelObject] = useState<Object3D | null>(
    () => sceneRegistry.nodes.get(levelId) ?? null,
  )

  const corners = useMemo(() => buildCornerBrackets(ceiling.polygon), [ceiling.polygon])

  useEffect(() => {
    let frameId = 0

    const resolveLevelObject = () => {
      const nextLevelObject = sceneRegistry.nodes.get(levelId) ?? null
      setLevelObject((currentLevelObject) => {
        if (currentLevelObject === nextLevelObject) {
          return currentLevelObject
        }
        return nextLevelObject
      })

      if (!nextLevelObject) {
        frameId = window.requestAnimationFrame(resolveLevelObject)
      }
    }

    resolveLevelObject()

    return () => {
      if (frameId) {
        window.cancelAnimationFrame(frameId)
      }
    }
  }, [levelId])

  if (!levelObject || corners.length === 0) return null

  return createPortal(
    <group position={[0, (ceiling.height ?? 2.5) + BRACKET_Y_OFFSET, 0]}>
      {corners.map((corner, index) => (
        <CornerBracket ceiling={ceiling} corner={corner} key={`${ceiling.id}-corner-${index}`} />
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
  const [isHovered, setIsHovered] = useState(false)
  const color = isHovered ? '#818cf8' : '#d4d4d4'
  const opacity = isHovered ? HOVER_OPACITY : 0

  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation()

    useEditor.getState().setMovingNode(null)
    useEditor.getState().setMovingWallEndpoint(null)
    useEditor.getState().setCurvingWall(null)
    useEditor.getState().setEditingHole(null)
    useEditor.getState().setMode('select')

    emitter.emit('ceiling:click' as any, {
      node: ceiling,
      nativeEvent: e.nativeEvent,
      localPosition: [0, 0, 0],
      position: [corner.corner[0], ceiling.height ?? 2.5, corner.corner[1]],
      stopPropagation: () => e.stopPropagation(),
    })
  }

  return (
    <group
      position={[corner.corner[0], 0, corner.corner[1]]}
      userData={{ pascalExcludeFromOutline: true }}
    >
      {isHovered ? (
        <>
          <BracketLeg
            color={color}
            direction={corner.incomingDirection}
            length={corner.incomingLength}
            onClick={handleClick}
            opacity={opacity}
          />
          <BracketLeg
            color={color}
            direction={corner.outgoingDirection}
            length={corner.outgoingLength}
            onClick={handleClick}
            opacity={opacity}
          />
        </>
      ) : null}

      <mesh
        onClick={handleClick}
        onPointerEnter={(e) => {
          e.stopPropagation()
          setIsHovered(true)
        }}
        onPointerLeave={(e) => {
          e.stopPropagation()
          setIsHovered(false)
        }}
        userData={{ pascalExcludeFromOutline: true }}
      >
        <boxGeometry args={HIT_BOX_SIZE} />
        <meshBasicMaterial colorWrite={false} depthTest={false} depthWrite={false} transparent />
      </mesh>
    </group>
  )
}

const BracketLeg = ({
  direction,
  length,
  color,
  onClick,
  opacity,
}: {
  direction: [number, number]
  length: number
  color: string
  onClick: (e: ThreeEvent<MouseEvent>) => void
  opacity: number
}) => {
  const angle = Math.atan2(direction[1], direction[0])
  const position: [number, number, number] = [
    direction[0] * (length / 2),
    0,
    direction[1] * (length / 2),
  ]

  return (
    <mesh
      onClick={onClick}
      position={position}
      rotation={[0, angle, 0]}
      userData={{ pascalExcludeFromOutline: true }}
    >
      <boxGeometry args={[length, BRACKET_HEIGHT, BRACKET_THICKNESS]} />
      <meshBasicMaterial color={color} depthWrite={false} opacity={opacity} transparent />
    </mesh>
  )
}

function buildCornerBrackets(polygon: Array<[number, number]>): CornerBracketData[] {
  if (polygon.length < 3) return []

  const allCorners = polygon.map((corner, index) => {
    const previous = polygon[(index - 1 + polygon.length) % polygon.length]!
    const next = polygon[(index + 1) % polygon.length]!
    const incomingVector = [previous[0] - corner[0], previous[1] - corner[1]] as [number, number]
    const outgoingVector = [next[0] - corner[0], next[1] - corner[1]] as [number, number]
    const incomingDirection = normalize2D(incomingVector)
    const outgoingDirection = normalize2D(outgoingVector)

    const incomingLength = Math.hypot(incomingVector[0], incomingVector[1])
    const outgoingLength = Math.hypot(outgoingVector[0], outgoingVector[1])
    const cornerStrength =
      1 -
      Math.abs(
        incomingDirection[0] * outgoingDirection[0] + incomingDirection[1] * outgoingDirection[1],
      )

    return {
      corner,
      incomingDirection,
      outgoingDirection,
      incomingLength: getBracketLength(incomingLength),
      outgoingLength: getBracketLength(outgoingLength),
      cornerStrength,
    }
  })

  if (allCorners.length <= 4) {
    return allCorners
  }

  const selectedIndices = new Set(
    allCorners
      .map((corner, index) => ({ index, strength: corner.cornerStrength }))
      .sort((a, b) => b.strength - a.strength)
      .slice(0, 4)
      .map(({ index }) => index),
  )

  return allCorners.filter((_, index) => selectedIndices.has(index))
}

function normalize2D(vector: [number, number]): [number, number] {
  const length = Math.hypot(vector[0], vector[1])
  if (length < 1e-6) return [1, 0]
  return [vector[0] / length, vector[1] / length]
}

function getBracketLength(edgeLength: number): number {
  return Math.max(0.14, Math.min(0.38, edgeLength * 0.22))
}
