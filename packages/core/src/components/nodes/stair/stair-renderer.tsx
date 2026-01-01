'use client'

import { Edges } from '@react-three/drei'
import { useMemo } from 'react'
import * as THREE from 'three'
import { useShallow } from 'zustand/shallow'
import { useEditor } from '../../../hooks'
import type { StairNode, StairSegmentNode } from '@pascal/core/scenegraph/schema/nodes/stair'
import type { AnyNodeId } from '@pascal/core'

// ============================================================================
// MESH COMPONENT
// ============================================================================

interface StairSegmentMeshProps {
  segment: StairSegmentNode
  absoluteHeight?: number // The world Y height where this segment starts
}

function StairSegmentMesh({ segment, absoluteHeight = 0 }: StairSegmentMeshProps) {
  const { width, length, height, stepCount, segmentType, fillToFloor, thickness = 0.2 } = segment
  const debug = useEditor((state) => state.debug)
  const shape = useMemo(() => {
    const s = new THREE.Shape()
    if (segmentType === 'landing') {
      s.moveTo(0, 0)
      s.lineTo(length, 0)
      if (fillToFloor) {
        s.lineTo(length, -absoluteHeight)
        s.lineTo(0, -absoluteHeight)
      } else {
        s.lineTo(length, -thickness)
        s.lineTo(0, -thickness)
      }
    } else {
      const riserHeight = height / stepCount
      const treadDepth = length / stepCount

      s.moveTo(0, 0)
      for (let i = 0; i < stepCount; i++) {
        s.lineTo(i * treadDepth, (i + 1) * riserHeight)
        s.lineTo((i + 1) * treadDepth, (i + 1) * riserHeight)
      }

      if (fillToFloor) {
        s.lineTo(length, -absoluteHeight)
        s.lineTo(0, -absoluteHeight)
      } else {
        // Implemented sloped bottom with consistent thickness and ground handling
        const angle = Math.atan(riserHeight / treadDepth)
        // Calculate vertical offset to maintain constant perpendicular thickness
        const vOff = thickness / Math.cos(angle)

        // Bottom-back corner
        s.lineTo(length, height - vOff)

        if (absoluteHeight === 0) {
          // Ground floor logic: Calculate where the slope hits the ground (y=0)
          // Slope m = riserHeight / treadDepth
          // Line eq: y - (height - vOff) = m * (x - length)
          // Set y = 0 => x = length - (height - vOff) / m
          const m = riserHeight / treadDepth
          const xGround = length - (height - vOff) / m

          if (xGround > 0) {
            s.lineTo(xGround, 0)
          }
        } else {
          // Floating logic: Parallel slope
          s.lineTo(0, -vOff)
        }
      }
    }
    s.lineTo(0, 0)
    return s
  }, [length, height, stepCount, segmentType, fillToFloor, absoluteHeight, thickness, width])

  const extrudeSettings = useMemo(
    () => ({
      steps: 1,
      depth: width,
      bevelEnabled: false,
    }),
    [width],
  )

  return (
    <group>
      <mesh castShadow position={[width / 2, 0, 0]} receiveShadow rotation={[0, -Math.PI / 2, 0]}>
        <extrudeGeometry args={[shape, extrudeSettings]} />
        <meshStandardMaterial color="#e6b88a" roughness={0.5} />
        {debug && (
          <Edges
            color="#000000"
            key={segment.id}
            linewidth={1}
            opacity={0.1}
            renderOrder={1000}
            threshold={15}
          />
        )}
      </mesh>
    </group>
  )
}

// ============================================================================
// STAIR SYSTEM (TRANSFORMS)
// ============================================================================

interface StairSystemProps {
  segments: StairSegmentNode[]
}

function StairSystem({ segments }: StairSystemProps) {
  // We calculate the world transform for each segment
  const segmentTransforms = useMemo(() => {
    return segments.reduce<{
      transforms: { position: [number, number, number]; rotation: [number, number, number] }[]
      prevSegment: StairSegmentNode | null
      currentPos: THREE.Vector3
      currentRot: number // Radians around Y
    }>(
      (acc, segment, index) => {
        const pos = acc.currentPos.clone()
        let rot = acc.currentRot

        if (index > 0 && acc.prevSegment) {
          const prev = acc.prevSegment

          // Calculate attachment point in PREVIOUS segment's local space
          // Previous segment is centered on X, starts at Z=0, ends at Z=length
          const localAttachPos = new THREE.Vector3()
          let rotChange = 0

          switch (segment.attachmentSide) {
            case 'front':
              // Attach to end of run
              localAttachPos.set(0, prev.height, prev.length)
              rotChange = 0
              break
            case 'left':
              // Attach to left face (X is width)
              // Center of left face
              localAttachPos.set(prev.width / 2, prev.height, prev.length / 2)
              rotChange = Math.PI / 2
              break
            case 'right':
              // Attach to right face
              localAttachPos.set(-prev.width / 2, prev.height, prev.length / 2)
              rotChange = -Math.PI / 2
              break
          }

          // Rotate local attachment point by previous global rotation
          localAttachPos.applyAxisAngle(new THREE.Vector3(0, 1, 0), acc.currentRot)

          // Add to previous global position
          pos.add(localAttachPos)

          // Update rotation
          rot += rotChange
        }

        // Store transform for this segment
        acc.transforms.push({
          position: [pos.x, pos.y, pos.z],
          rotation: [0, rot, 0],
        })

        // Update accumulator for next iteration
        acc.prevSegment = segment
        acc.currentPos = pos
        acc.currentRot = rot

        return acc
      },
      {
        transforms: [],
        prevSegment: null,
        currentPos: new THREE.Vector3(0, 0, 0),
        currentRot: 0,
      },
    )
  }, [segments])

  return (
    <group>
      {segments.map((segment, index) => {
        const transform = segmentTransforms.transforms[index]
        return (
          <group
            key={segment.id}
            position={transform.position}
            rotation={transform.rotation as [number, number, number]}
          >
            <StairSegmentMesh absoluteHeight={transform.position[1]} segment={segment} />
          </group>
        )
      })}
    </group>
  )
}

// ============================================================================
// MAIN RENDERER
// ============================================================================

export function StairRenderer({ nodeId }: { nodeId: string }) {
  const node = useEditor(
    useShallow((state) => {
      const n = state.graph.getNodeById(nodeId as AnyNodeId)?.data()
      return n?.type === 'stair' ? (n as StairNode) : null
    }),
  )
  const debug = useEditor((state) => state.debug)

  if (!node) return null

  return (
    <group>
      {/* Visualize selection or bounding box if needed here? No, usually handled by SelectionBox or similar */}
      <StairSystem segments={node.children} />
    </group>
  )
}
