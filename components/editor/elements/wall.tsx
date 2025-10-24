'use client'

import type { WallSegment } from '@/hooks/use-editor'
import { useEditor } from '@/hooks/use-editor'
import { forwardRef, memo, type Ref } from 'react'
import { useShallow } from 'zustand/react/shallow'
import * as THREE from 'three'

const WALL_THICKNESS = 0.2 // 20cm wall thickness

type WallsProps = {
  floorId: string
  isActive: boolean
  tileSize: number
  wallHeight: number
  hoveredWallIndex: number | null
  selectedWallIds: Set<string>
  setSelectedWallIds: React.Dispatch<React.SetStateAction<Set<string>>>
  onWallHover: (index: number | null) => void
  onWallRightClick?: (e: any, wallSegment: WallSegment) => void
  isCameraEnabled?: boolean
  controlMode: string
  movingCamera: boolean
  onDeleteWalls: () => void
}

export const Walls = forwardRef(({
  floorId,
  isActive,
  tileSize,
  wallHeight,
  hoveredWallIndex,
  selectedWallIds,
  setSelectedWallIds,
  onWallHover,
  onWallRightClick,
  isCameraEnabled,
  controlMode,
  movingCamera,
  onDeleteWalls
}: WallsProps, ref: Ref<THREE.Group>) => {
  // Fetch wall segments for this floor from the store (optimized selector)
  const wallSegments = useEditor(
    useShallow(state => {
      const wallComponent = state.components.find(c => c.type === 'wall' && c.group === floorId)
      return wallComponent?.data.segments || []
    })
  )
  return (
    <group ref={ref}>
      {wallSegments.map((seg, i) => {
        const [x1, y1] = seg.start
        const [x2, y2] = seg.end
        
        // Calculate wall dimensions
        const dx = x2 - x1
        const dz = y2 - y1  // y1, y2 from grid are now z coordinates in 3D space
        const baseLength = Math.sqrt(dx * dx + dz * dz) * tileSize
        const thickness = WALL_THICKNESS
        // Extend wall by half thickness on each end for perfect corners
        // Apply to all walls (horizontal, vertical, and diagonal) for clean connections
        const length = baseLength + thickness
        const height = wallHeight

        // Calculate center position (x-z plane is ground, y is up)
        const centerX = (x1 + x2) / 2 * tileSize
        const centerZ = (y1 + y2) / 2 * tileSize

        // Calculate rotation around Y axis (vertical)
        // Note: negative dz because Three.js Y-axis rotation transforms local X as (cos(θ), 0, -sin(θ))
        const angle = Math.atan2(-dz, dx)
        
        const isSelected = selectedWallIds.has(seg.id);
        // Only apply hover effect if this floor is active
        const isHovered = isActive && hoveredWallIndex === i;

        // Determine color based on selection and hover state
        let color = "#aaaabf"; // default
        let emissive = "#000000";

        if (isSelected && isHovered) {
          color = "#ff4444"; // selected and hovered
          emissive = "#441111";
        } else if (isSelected) {
          color = "#ff8888"; // selected
          emissive = "#331111";
        } else if (isHovered) {
          color = "#ff6b6b"; // hovered
          emissive = "#331111";
        }

        // Reduce opacity for inactive floors
        const opacity = isActive ? 1 : 0.2
        const transparent = opacity < 1

        return (
          <group key={seg.id} position={[centerX, height / 2, centerZ]} rotation={[0, angle, 0]}>
            <mesh
              castShadow
              receiveShadow
              onPointerEnter={(e) => {
                // Only allow hover on active floor walls in select mode
                if (isActive && controlMode === 'select') {
                  e.stopPropagation();
                  onWallHover(i);
                }
              }}
              onPointerLeave={(e) => {
                // Only allow hover on active floor walls in select mode
                if (isActive && controlMode === 'select') {
                  e.stopPropagation();
                  onWallHover(null);
                }
              }}
              onPointerDown={(e) => {
                // Only allow interactions on active floor
                if (!isActive) return;

                // Don't handle interactions while camera is moving
                if (movingCamera) return;

                // Building mode: let clicks pass through to grid
                if (controlMode === 'building') {
                  return
                }

                // Delete mode: interactions now handled through grid intersections
                if (controlMode === 'delete') {
                  return
                }

                // Guide mode: no wall interactions while manipulating reference images
                if (controlMode === 'guide') {
                  return
                }

                // Only stop propagation in select mode where we handle the interaction
                e.stopPropagation();

                // Check for right-click (button 2) and camera not enabled and walls selected
                if (e.button === 2 && !isCameraEnabled && selectedWallIds.size > 0) {
                  // Prevent default browser context menu
                  if (e.nativeEvent) {
                    e.nativeEvent.preventDefault();
                  }
                  onWallRightClick?.(e, seg);
                }
              }}
              onContextMenu={(e) => {
                // Only allow context menu on active floor
                if (!isActive) return;

                // Prevent default browser context menu for walls (only when camera not enabled and walls selected)
                if (!isCameraEnabled && selectedWallIds.size > 0) {
                  e.stopPropagation();
                  if (e.nativeEvent) {
                    e.nativeEvent.preventDefault();
                  }
                }
              }}
              onClick={(e) => {
                // Only allow interactions on active floor
                if (!isActive) return;

                // Don't handle clicks while camera is moving
                if (movingCamera) return;

                // Building mode: let clicks pass through to grid
                if (controlMode === 'building') {
                  return
                }

                // Delete mode: handled in onPointerDown/Up
                if (controlMode === 'delete') {
                  return
                }

                // Guide mode: no wall selection while manipulating reference images
                if (controlMode === 'guide') {
                  return
                }

                // Only stop propagation in select mode where we handle the interaction
                e.stopPropagation();

                // Select mode: normal selection behavior
                if (controlMode === 'select') {
                  setSelectedWallIds(prev => {
                    const next = new Set(prev);
                    if (e.shiftKey) {
                      // Shift+click: add/remove from selection
                      if (next.has(seg.id)) {
                        next.delete(seg.id);
                      } else {
                        next.add(seg.id);
                      }
                    } else {
                      // Regular click: select only this wall
                      next.clear();
                      next.add(seg.id);
                    }
                    return next;
                  });
                }
              }}
            >
              <boxGeometry args={[length, height, thickness]} />
              <meshStandardMaterial
                color={color}
                roughness={0.7}
                metalness={0.1}
                emissive={emissive}
                transparent={transparent}
                opacity={opacity}
              />
            </mesh>
          </group>
        );
      })}
    </group>
  );
})

Walls.displayName = 'Walls'

type WallShadowPreviewProps = {
  start: [number, number]
  end: [number, number]
  tileSize: number
  wallHeight: number
}

export const WallShadowPreview = memo(({ start, end, tileSize, wallHeight }: WallShadowPreviewProps) => {
  const [x1, y1] = start
  const [x2, y2] = end

  // Calculate wall dimensions
  const dx = x2 - x1
  const dz = y2 - y1  // y coordinates from grid are z in 3D space
  const baseLength = Math.sqrt(dx * dx + dz * dz) * tileSize
  const thickness = WALL_THICKNESS
  // Extend wall by half thickness on each end for perfect corners
  // Apply to all walls (horizontal, vertical, and diagonal) for clean connections
  const length = baseLength + thickness
  const height = wallHeight

  // Calculate center position (x-z plane is ground, y is up)
  const centerX = (x1 + x2) / 2 * tileSize
  const centerZ = (y1 + y2) / 2 * tileSize

  // Calculate rotation around Y axis (vertical)
  // Note: negative dz because Three.js Y-axis rotation transforms local X as (cos(θ), 0, -sin(θ))
  const angle = Math.atan2(-dz, dx)

  return (
    <group position={[centerX, height / 2, centerZ]} rotation={[0, angle, 0]}>
      {/* Occluded/behind version - dimmer, shows through everything */}
      <mesh renderOrder={1}>
        <boxGeometry args={[length, height, thickness]} />
        <meshStandardMaterial
          color="#44ff44"
          transparent
          opacity={0.15}
          emissive="#22aa22"
          emissiveIntensity={0.1}
          depthTest={false}
          depthWrite={false}
        />
      </mesh>
      {/* Visible/front version - brighter, only shows when not occluded */}
      <mesh renderOrder={2}>
        <boxGeometry args={[length, height, thickness]} />
        <meshStandardMaterial
          color="#44ff44"
          transparent
          opacity={0.5}
          emissive="#22aa22"
          emissiveIntensity={0.4}
          depthTest={true}
          depthWrite={false}
        />
      </mesh>
    </group>
  )
})

WallShadowPreview.displayName = 'WallShadowPreview'

