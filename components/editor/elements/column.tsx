'use client'

import { forwardRef, memo, type Ref, useMemo } from 'react'
import * as THREE from 'three'
import { useShallow } from 'zustand/react/shallow'
import type { Component } from '@/hooks/use-editor'
import { useEditor } from '@/hooks/use-editor'
import { useColumns } from '@/hooks/use-nodes'
import {
  handleElementClick,
  isElementSelected,
  type SelectedElement,
} from '@/lib/building-elements'

const COLUMN_RADIUS = 0.15 // 15cm radius
const OUTLINE_RADIUS = 0.02 // 2cm radius for selection outline

// Helper function to create a cylinder between two points
function createEdgeCylinder(start: number[], end: number[]) {
  const dx = end[0] - start[0]
  const dy = end[1] - start[1]
  const dz = end[2] - start[2]
  const length = Math.sqrt(dx * dx + dy * dy + dz * dz)

  const geometry = new THREE.CylinderGeometry(OUTLINE_RADIUS, OUTLINE_RADIUS, length, 8)
  const midpoint = new THREE.Vector3(
    (start[0] + end[0]) / 2,
    (start[1] + end[1]) / 2,
    (start[2] + end[2]) / 2,
  )

  // Calculate rotation to align cylinder with edge
  const direction = new THREE.Vector3(dx, dy, dz).normalize()
  const axis = new THREE.Vector3(0, 1, 0).cross(direction).normalize()
  const angle = Math.acos(new THREE.Vector3(0, 1, 0).dot(direction))

  return { geometry, midpoint, axis, angle }
}

export interface ColumnData {
  id: string
  position: [number, number] // Grid coordinates
  visible?: boolean
  opacity?: number // 0-100, defaults to 100 if undefined
}

type ColumnsProps = {
  floorId: string
  isActive: boolean
  isFullView?: boolean
  tileSize: number
  columnHeight: number
  selectedElements: SelectedElement[]
  setSelectedElements: (elements: SelectedElement[]) => void
  controlMode: string
  setControlMode: (mode: 'select' | 'building' | 'delete' | 'guide') => void
  movingCamera: boolean
}

export const Columns = forwardRef(
  (
    {
      floorId,
      isActive,
      isFullView = false,
      tileSize,
      columnHeight,
      selectedElements,
      setSelectedElements,
      controlMode,
      setControlMode,
      movingCamera,
    }: ColumnsProps,
    ref: Ref<THREE.Group>,
  ) => {
    // Fetch columns for this floor from the node tree
    const columnNodes = useColumns(floorId)
    const columns = columnNodes.filter((col) => col.visible !== false)

    // Create cylinder geometry once for all columns
    const cylinderGeometry = useMemo(
      () => new THREE.CylinderGeometry(COLUMN_RADIUS, COLUMN_RADIUS, columnHeight, 16),
      [columnHeight],
    )

    return (
      <group ref={ref}>
        {columns.map((column, i) => {
          const isSelected = isElementSelected(selectedElements, column.id, 'column')
          const isHovered = false // We can add hover state later if needed

          const color = '#aaaabf'
          const emissive = '#aaaabf'
          let emissiveIntensity = 0

          if (isSelected && isHovered) {
            emissiveIntensity = 0.6
          } else if (isSelected) {
            emissiveIntensity = 0.4
          } else if (isHovered) {
            emissiveIntensity = 0.3
          }

          // Check if element should be visible
          const isHidden =
            column.visible === false || (column.opacity !== undefined && column.opacity === 0)

          // In full view mode, show all columns at full opacity
          // Otherwise, only active floor columns are at full opacity
          let baseOpacity = isFullView || isActive ? 1 : 0.2

          // Apply custom opacity if set (convert from 0-100 to 0-1)
          if (column.opacity !== undefined && column.opacity < 100) {
            baseOpacity *= column.opacity / 100
          }

          const opacity = baseOpacity
          const transparent = opacity < 1

          // Don't render if hidden
          if (isHidden) return null

          // Convert grid position to world position
          const worldX = column.position[0] * tileSize
          const worldZ = column.position[1] * tileSize

          return (
            <group key={column.id}>
              {/* Column cylinder */}
              <mesh
                castShadow
                geometry={cylinderGeometry}
                onClick={(e) => {
                  if (!isActive || movingCamera || controlMode === 'delete' || controlMode === 'guide') {
                    return
                  }
                  e.stopPropagation()

                  // Handle element selection
                  const updatedSelection = handleElementClick({
                    selectedElements,
                    segments: columns,
                    elementId: column.id,
                    type: 'column',
                    event: e,
                  })
                  setSelectedElements(updatedSelection)

                  // Switch to building mode unless we're in select mode
                  if (controlMode !== 'select') {
                    setControlMode('building')
                  }
                }}
                position={[worldX, columnHeight / 2, worldZ]}
                receiveShadow
              >
                <meshStandardMaterial
                  color={color}
                  emissive={emissive}
                  emissiveIntensity={emissiveIntensity}
                  metalness={0.1}
                  opacity={opacity}
                  roughness={0.7}
                  transparent={transparent}
                />
              </mesh>

              {/* Selection outline - circles at top and bottom */}
              {isSelected && (
                <>
                  {/* Bottom circle */}
                  <mesh position={[worldX, 0, worldZ]} renderOrder={999} rotation-x={-Math.PI / 2}>
                    <ringGeometry args={[COLUMN_RADIUS - 0.01, COLUMN_RADIUS + 0.01, 32]} />
                    <meshStandardMaterial
                      color="#ffffff"
                      depthTest={false}
                      emissive="#ffffff"
                      emissiveIntensity={0.5}
                    />
                  </mesh>
                  {/* Top circle */}
                  <mesh
                    position={[worldX, columnHeight, worldZ]}
                    renderOrder={999}
                    rotation-x={-Math.PI / 2}
                  >
                    <ringGeometry args={[COLUMN_RADIUS - 0.01, COLUMN_RADIUS + 0.01, 32]} />
                    <meshStandardMaterial
                      color="#ffffff"
                      depthTest={false}
                      emissive="#ffffff"
                      emissiveIntensity={0.5}
                    />
                  </mesh>
                  {/* Vertical edge highlights */}
                  {[0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2].map((angle, idx) => {
                    const x = worldX + Math.cos(angle) * COLUMN_RADIUS
                    const z = worldZ + Math.sin(angle) * COLUMN_RADIUS
                    const start = [x, 0, z]
                    const end = [x, columnHeight, z]
                    const {
                      geometry: cylGeom,
                      midpoint,
                      axis,
                      angle: rotAngle,
                    } = createEdgeCylinder(start, end)
                    return (
                      <mesh
                        geometry={cylGeom}
                        key={idx}
                        position={midpoint}
                        quaternion={new THREE.Quaternion().setFromAxisAngle(axis, rotAngle)}
                        renderOrder={999}
                      >
                        <meshStandardMaterial
                          color="#ffffff"
                          depthTest={false}
                          emissive="#ffffff"
                          emissiveIntensity={0.5}
                        />
                      </mesh>
                    )
                  })}
                </>
              )}
            </group>
          )
        })}
      </group>
    )
  },
)

Columns.displayName = 'Columns'

// --- ColumnShadowPreview ---
type ColumnShadowPreviewProps = {
  position: [number, number]
  tileSize: number
  columnHeight: number
}

export const ColumnShadowPreview = memo(
  ({ position, tileSize, columnHeight }: ColumnShadowPreviewProps) => {
    const worldX = position[0] * tileSize
    const worldZ = position[1] * tileSize

    const cylinderGeometry = useMemo(
      () => new THREE.CylinderGeometry(COLUMN_RADIUS, COLUMN_RADIUS, columnHeight, 16),
      [columnHeight],
    )

    return (
      <group>
        {/* Occluded/behind version - dimmer, shows through everything */}
        <mesh
          geometry={cylinderGeometry}
          position={[worldX, columnHeight / 2, worldZ]}
          renderOrder={1}
        >
          <meshStandardMaterial
            color="#44ff44"
            depthTest={false}
            depthWrite={false}
            emissive="#22aa22"
            emissiveIntensity={0.1}
            opacity={0.15}
            transparent
          />
        </mesh>
        {/* Visible/front version - brighter, only shows when not occluded */}
        <mesh
          geometry={cylinderGeometry}
          position={[worldX, columnHeight / 2, worldZ]}
          renderOrder={2}
        >
          <meshStandardMaterial
            color="#44ff44"
            depthTest={true}
            depthWrite={false}
            emissive="#22aa22"
            emissiveIntensity={0.4}
            opacity={0.5}
            transparent
          />
        </mesh>
      </group>
    )
  },
)

ColumnShadowPreview.displayName = 'ColumnShadowPreview'
