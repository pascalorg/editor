'use client'

import React, { useMemo } from 'react'
import { Box3, Vector3 } from 'three'
import type { SelectedElement } from '@/lib/building-elements'
import type { Bounds } from '@/lib/engine'
import { BOUNDS } from '@/lib/engine'
import type { World } from '@/lib/engine/core'

interface BoundingBoxesProps {
  selectedElements: SelectedElement[]
  world: World
  levelYOffset: number
}

/**
 * Renders bounding boxes for selected elements using engine-computed bounds
 */
export function BoundingBoxes({ selectedElements, world, levelYOffset }: BoundingBoxesProps) {
  const boxes = useMemo(() => {
    return selectedElements
      .map((element) => {
        // Get bounds from engine
        const bounds = world.getComponent<Bounds>(element.id, BOUNDS)
        if (!bounds) return null

        const { aabb } = bounds

        // Compute box dimensions and center
        const width = aabb.max[0] - aabb.min[0]
        const height = aabb.max[1] - aabb.min[1]
        const depth = aabb.max[2] - aabb.min[2]

        const centerX = (aabb.min[0] + aabb.max[0]) / 2
        const centerY = (aabb.min[1] + aabb.max[1]) / 2
        const centerZ = (aabb.min[2] + aabb.max[2]) / 2

        return {
          id: element.id,
          position: [centerX, centerY + levelYOffset, centerZ] as [number, number, number],
          size: [width, height, depth] as [number, number, number],
        }
      })
      .filter((box): box is NonNullable<typeof box> => box !== null)
  }, [selectedElements, world, levelYOffset])

  if (boxes.length === 0) return null

  return (
    <group>
      {boxes.map((box) => (
        <mesh key={box.id} position={box.position}>
          <boxGeometry args={box.size} />
          <meshBasicMaterial
            color="#00ff00"
            depthTest={false}
            opacity={0.5}
            transparent
            wireframe
          />
        </mesh>
      ))}
    </group>
  )
}

/**
 * Helper component that shows OBB (Oriented Bounding Box) for rotated elements
 */
export function OrientedBoundingBox({
  entityId,
  world,
  levelYOffset,
}: {
  entityId: string
  world: World
  levelYOffset: number
}) {
  const boxData = useMemo(() => {
    const bounds = world.getComponent<Bounds>(entityId, BOUNDS)
    if (!bounds?.obb) return null

    const { center, halfExtents, rotation } = bounds.obb

    return {
      position: [center[0], center[1] + levelYOffset, center[2]] as [number, number, number],
      size: [halfExtents[0] * 2, halfExtents[1] * 2, halfExtents[2] * 2] as [
        number,
        number,
        number,
      ],
      rotation: [0, rotation, 0] as [number, number, number],
    }
  }, [entityId, world, levelYOffset])

  if (!boxData) return null

  return (
    <mesh position={boxData.position} rotation={boxData.rotation}>
      <boxGeometry args={boxData.size} />
      <meshBasicMaterial color="#ff6600" depthTest={false} opacity={0.6} transparent wireframe />
    </mesh>
  )
}
