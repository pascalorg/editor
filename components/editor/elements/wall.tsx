'use client'

import type { WallSegment } from '@/hooks/use-editor'
import { forwardRef, memo, type Ref } from 'react'
import * as THREE from 'three'

const WALL_THICKNESS = 0.2 // 20cm wall thickness

type WallsProps = {
  wallSegments: WallSegment[]
  tileSize: number
  wallHeight: number
  hoveredWallIndex: number | null
  selectedWallIds: Set<string>
  setSelectedWallIds: React.Dispatch<React.SetStateAction<Set<string>>>
  onWallHover: (index: number | null) => void
  onWallRightClick?: (e: any, wallSegment: WallSegment) => void
  isCameraEnabled?: boolean
  controlMode: string
  onDeleteWalls: () => void
}

export const Walls = memo(forwardRef(({ 
  wallSegments, 
  tileSize, 
  wallHeight, 
  hoveredWallIndex, 
  selectedWallIds, 
  setSelectedWallIds, 
  onWallHover, 
  onWallRightClick, 
  isCameraEnabled, 
  controlMode, 
  onDeleteWalls
}: WallsProps, ref: Ref<THREE.Group>) => {
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
        const angle = Math.atan2(dz, dx)
        
        const isSelected = selectedWallIds.has(seg.id);
        const isHovered = hoveredWallIndex === i;

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

        return (
          <group key={seg.id} position={[centerX, height / 2, centerZ]} rotation={[0, angle, 0]}>
            <mesh
              castShadow
              receiveShadow
              onPointerEnter={(e) => {
                // Don't highlight walls in delete mode
                if (controlMode !== 'delete') {
                  e.stopPropagation();
                  onWallHover(i);
                }
              }}
              onPointerLeave={(e) => {
                // Don't highlight walls in delete mode
                if (controlMode !== 'delete') {
                  e.stopPropagation();
                  onWallHover(null);
                }
              }}
              onPointerDown={(e) => {

                // Delete mode: interactions now handled through grid intersections
                if (controlMode === 'delete') {
                  return
                }
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
                // Prevent default browser context menu for walls (only when camera not enabled and walls selected)
                if (!isCameraEnabled && selectedWallIds.size > 0) {
                  e.stopPropagation();
                  if (e.nativeEvent) {
                    e.nativeEvent.preventDefault();
                  }
                }
              }}
              onClick={(e) => {
                e.stopPropagation();
                
                // Building mode: no wall selection while placing walls
                if (controlMode === 'building') {
                  return
                }
                
                // Delete mode: handled in onPointerDown/Up
                if (controlMode === 'delete') {
                  return
                }
                
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
              />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}));

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
  const angle = Math.atan2(dz, dx)

  return (
    <group position={[centerX, height / 2, centerZ]} rotation={[0, angle, 0]}>
      <mesh>
        <boxGeometry args={[length, height, thickness]} />
        <meshStandardMaterial
          color="#44ff44"
          transparent
          opacity={0.4}
          emissive="#22aa22"
          emissiveIntensity={0.3}
        />
      </mesh>
    </group>
  )
})

WallShadowPreview.displayName = 'WallShadowPreview'

