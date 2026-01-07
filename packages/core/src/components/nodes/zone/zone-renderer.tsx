'use client'

import { emitter, type ZonePreviewEvent } from '@pascal/core/events'
import type { Zone } from '@pascal/core/scenegraph/schema/zones'
import { Billboard, Line } from '@react-three/drei'
import { type ThreeEvent, useFrame } from '@react-three/fiber'
import { Container, Text } from '@react-three/uikit'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { useShallow } from 'zustand/shallow'
import { FLOOR_SPACING, TILE_SIZE } from '../../../constants'
import { type StoreState, useEditor } from '../../../hooks'

// Height offset to prevent z-fighting with floor
const Y_OFFSET = 0.02

// Height of the extruded zone walls
const EXTRUDE_HEIGHT = 2.5

// Convert grid coordinates to world coordinates
const toWorld = (x: number, z: number): [number, number] => [x * TILE_SIZE, z * TILE_SIZE]

const tmpVec3 = new THREE.Vector3()

/**
 * Custom gradient shader material for extruded zone walls
 * Fades from fully transparent at bottom to semi-transparent at top
 * When hovered, the gradient becomes more opaque with smooth fade animation
 */
const GradientMaterial = ({
  color,
  opacity,
  height,
  hovered = false,
}: {
  color: string
  opacity: number
  height: number
  hovered?: boolean
}) => {
  const materialRef = useRef<THREE.ShaderMaterial>(null)
  const targetHovered = hovered ? 1.0 : 0.0

  // Create uniforms only once
  const uniforms = useMemo(
    () => ({
      uColor: { value: new THREE.Color(color) },
      uOpacity: { value: opacity },
      uHeight: { value: height },
      uHovered: { value: 0.0 },
    }),
    [], // Empty deps - create once
  )

  // Update non-animated uniforms when props change
  useEffect(() => {
    if (materialRef.current) {
      materialRef.current.uniforms.uColor.value.set(color)
      materialRef.current.uniforms.uOpacity.value = opacity
      materialRef.current.uniforms.uHeight.value = height
    }
  }, [color, opacity, height])

  // Animate uHovered uniform for smooth fade in/out
  useFrame((_, delta) => {
    if (materialRef.current) {
      const current = materialRef.current.uniforms.uHovered.value
      const speed = 8 // Animation speed (higher = faster)
      const diff = targetHovered - current
      if (Math.abs(diff) > 0.001) {
        materialRef.current.uniforms.uHovered.value += diff * Math.min(delta * speed, 1)
      } else {
        materialRef.current.uniforms.uHovered.value = targetHovered
      }
    }
  })

  return (
    <shaderMaterial
      depthTest={false}
      depthWrite={false}
      fragmentShader={`
        uniform vec3 uColor;
        uniform float uOpacity;
        uniform float uHeight;
        uniform float uHovered;
        varying float vHeight;

        void main() {
          // Calculate alpha based on height (0 at bottom, 1 at top)
          float alpha = vHeight / uHeight;

          // When hovered, use a gentler falloff and higher minimum opacity
          float falloff = mix(alpha * alpha, alpha, uHovered * 0.5);
          float minAlpha = mix(0.0, 0.3, uHovered);
          alpha = max(falloff, minAlpha);

          // Boost opacity when hovered
          float finalOpacity = mix(uOpacity, uOpacity * 1.5, uHovered);

          gl_FragColor = vec4(uColor, alpha * finalOpacity);
        }
      `}
      ref={materialRef}
      side={THREE.DoubleSide}
      transparent
      uniforms={uniforms}
      vertexShader={`
        varying float vHeight;

        void main() {
          vHeight = position.y;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `}
    />
  )
}
/**
 * Label displayed at the center of a zone
 */
function ZoneLabel({
  name,
  color,
  centerX,
  centerZ,
  levelYOffset,
}: {
  name: string
  color: string
  centerX: number
  centerZ: number
  levelYOffset: number
}) {
  const labelRef = useRef<THREE.Group>(null)

  useFrame(({ camera }) => {
    // Scale control panel based on camera distance to maintain consistent visual size
    if (labelRef.current && labelRef) {
      tmpVec3.set(centerX, levelYOffset + 2, centerZ)
      // Calculate distance from camera to the selection center
      const distance = camera.position.distanceTo(tmpVec3)
      // Use distance to calculate appropriate scale
      const scale = distance * 0.12 // Adjust multiplier for desired size
      const finalScale = Math.min(Math.max(scale, 0.5), 2) // Clamp between 0.5 and 2
      labelRef.current.scale.setScalar(finalScale)
    }
  })

  return (
    <group position={[centerX, levelYOffset + 1.25, centerZ]} ref={labelRef}>
      <Billboard>
        <Container
          alignItems="center"
          // backgroundColor="#21222a"
          borderRadius={6}
          depthTest={false}
          flexDirection="row"
          gap={0}
          height={40}
          opacity={0.9}
          paddingRight={16}
          renderOrder={99_999_999_999}
        >
          {/* Color circle */}
          <Container
            backgroundColor={color}
            borderRadius={1000}
            height={16}
            opacity={1}
            positionLeft={-8}
            width={16}
          />
          <Container>
            {/* Label text */}
            <Text color="white" fontSize={20} fontWeight="medium" zIndex={1}>
              {name}
            </Text>
            <Text color={color} fontSize={20} fontWeight="medium" positionType={'absolute'}>
              {name}
            </Text>
          </Container>
          {/* <Container
            backgroundColor={color}
            borderRadius={12}
            height={'100%'}
            opacity={0.3}
            positionType={'absolute'}
            width={'100%'}
          /> */}
        </Container>
      </Billboard>
    </group>
  )
}

/**
 * Renders a single zone as a colored polygon on the floor
 */
function ZonePolygon({
  zone,
  isSelected,
  levelYOffset,
  isInteractive,
  onSelect,
  showLabel,
}: {
  zone: Zone
  isSelected: boolean
  levelYOffset: number
  isInteractive?: boolean
  onSelect?: (zoneId: string) => void
  showLabel?: boolean
}) {
  const polygon = zone.polygon
  const color = zone.color || '#3b82f6'
  const [isHovered, setIsHovered] = useState(false)

  // Create the polygon shape and extruded wall geometry (convert grid coords to world coords)
  const { shape, linePoints, center, wallGeometry } = useMemo(() => {
    if (!polygon || polygon.length < 3)
      return { shape: null, linePoints: [], center: null, wallGeometry: null }

    // Convert to world coordinates
    const worldPts = polygon.map(([x, z]) => toWorld(x, z))

    // THREE.Shape is in X-Y plane. After rotation of -PI/2 around X:
    // - Shape X -> World X
    // - Shape Y -> World -Z (so we negate Z to get correct orientation)
    const shape = new THREE.Shape()
    shape.moveTo(worldPts[0][0], -worldPts[0][1])

    for (let i = 1; i < worldPts.length; i++) {
      shape.lineTo(worldPts[i][0], -worldPts[i][1])
    }
    shape.closePath()

    // Create line points for the border (close the loop)
    const linePoints = [
      ...worldPts.map(([x, z]) => new THREE.Vector3(x, levelYOffset + Y_OFFSET + 0.01, z)),
      new THREE.Vector3(worldPts[0][0], levelYOffset + Y_OFFSET + 0.01, worldPts[0][1]),
    ]

    // Calculate centroid of polygon
    let sumX = 0
    let sumZ = 0
    for (const [x, z] of worldPts) {
      sumX += x
      sumZ += z
    }
    const center = { x: sumX / worldPts.length, z: sumZ / worldPts.length }

    // Create extruded wall geometry from polygon edges
    // Build vertical quads for each edge of the polygon
    const vertices: number[] = []
    const numPoints = worldPts.length

    for (let i = 0; i < numPoints; i++) {
      const [x1, z1] = worldPts[i]
      const [x2, z2] = worldPts[(i + 1) % numPoints]

      // Create two triangles for each wall segment
      // Bottom-left, bottom-right, top-right triangle
      vertices.push(x1, 0, z1)
      vertices.push(x2, 0, z2)
      vertices.push(x2, EXTRUDE_HEIGHT, z2)

      // Bottom-left, top-right, top-left triangle
      vertices.push(x1, 0, z1)
      vertices.push(x2, EXTRUDE_HEIGHT, z2)
      vertices.push(x1, EXTRUDE_HEIGHT, z1)
    }

    const wallGeometry = new THREE.BufferGeometry()
    wallGeometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3))
    wallGeometry.computeVertexNormals()

    return { shape, linePoints, center, wallGeometry }
  }, [polygon, levelYOffset])

  const handleClick = useCallback(
    (e: ThreeEvent<MouseEvent>) => {
      if (!isInteractive) return
      e.stopPropagation()
      onSelect?.(zone.id)
    },
    [isInteractive, onSelect, zone.id],
  )

  const handlePointerEnter = useCallback(() => {
    if (isInteractive) setIsHovered(true)
  }, [isInteractive])

  const handlePointerLeave = useCallback(() => {
    setIsHovered(false)
  }, [])

  if (!shape) return null

  // Determine visual state based on selection and hover
  const isHighlighted = isSelected || isHovered
  const fillOpacity = isSelected ? 0.4 : isHovered ? 0.35 : 0.05

  return (
    <group>
      {/* Filled polygon on floor */}
      <mesh
        frustumCulled={false}
        onClick={handleClick}
        onPointerEnter={handlePointerEnter}
        onPointerLeave={handlePointerLeave}
        position={[0, levelYOffset + Y_OFFSET, 0]}
        renderOrder={999}
        rotation={[-Math.PI / 2, 0, 0]}
      >
        <shapeGeometry args={[shape]} />
        <meshBasicMaterial
          color={color}
          depthWrite={false}
          opacity={fillOpacity}
          side={THREE.DoubleSide}
          transparent
        />
      </mesh>

      {/* Extruded walls with gradient shader */}
      {wallGeometry && (
        <mesh
          frustumCulled={false}
          geometry={wallGeometry}
          position={[0, levelYOffset + Y_OFFSET, 0]}
          renderOrder={99_999_999_998}
        >
          <GradientMaterial
            color={color}
            height={EXTRUDE_HEIGHT}
            hovered={isHovered}
            key={color}
            opacity={fillOpacity * 0.8}
          />
        </mesh>
      )}

      {/* Border line */}
      <Line
        color={color}
        lineWidth={isHighlighted ? 2 : 1}
        points={linePoints}
        renderOrder={9_999_999_999}
      />

      {/* Label at center */}
      {showLabel && center && (
        <ZoneLabel
          centerX={center.x}
          centerZ={center.z}
          color={color}
          levelYOffset={levelYOffset}
          name={zone.name}
        />
      )}
    </group>
  )
}

/**
 * Renders the zone preview while drawing
 */
function ZonePreview({ levelYOffset }: { levelYOffset: number }) {
  const [previewState, setPreviewState] = useState<ZonePreviewEvent>({ points: [] })

  useEffect(() => {
    const handlePreview = (event: ZonePreviewEvent) => {
      setPreviewState(event)
    }

    emitter.on('zone:preview', handlePreview)
    return () => {
      emitter.off('zone:preview', handlePreview)
    }
  }, [])

  const { points, cursorPoint } = previewState

  // Create line points including cursor (convert grid coords to world coords)
  const linePoints = useMemo(() => {
    if (points.length === 0) return []

    const pts = points.map(([x, z]) => {
      const [wx, wz] = toWorld(x, z)
      return new THREE.Vector3(wx, levelYOffset + Y_OFFSET + 0.02, wz)
    })

    // Add cursor point if available
    if (cursorPoint) {
      const [wx, wz] = toWorld(cursorPoint[0], cursorPoint[1])
      pts.push(new THREE.Vector3(wx, levelYOffset + Y_OFFSET + 0.02, wz))
    }

    return pts
  }, [points, cursorPoint, levelYOffset])

  // Create closing line to first point when we have 3+ points
  const closingLinePoints = useMemo(() => {
    if (points.length < 3 || !cursorPoint) return []

    const [cwx, cwz] = toWorld(cursorPoint[0], cursorPoint[1])
    const [fwx, fwz] = toWorld(points[0][0], points[0][1])
    return [
      new THREE.Vector3(cwx, levelYOffset + Y_OFFSET + 0.02, cwz),
      new THREE.Vector3(fwx, levelYOffset + Y_OFFSET + 0.02, fwz),
    ]
  }, [points, cursorPoint, levelYOffset])

  // Create preview shape when we have 3+ points
  const previewShape = useMemo(() => {
    if (points.length < 3) return null

    const allPoints = [...points]
    if (cursorPoint) {
      allPoints.push(cursorPoint)
    }

    // Convert to world coordinates
    const worldPts = allPoints.map(([x, z]) => toWorld(x, z))

    // THREE.Shape is in X-Y plane. After rotation of -PI/2 around X:
    // - Shape X -> World X
    // - Shape Y -> World -Z (so we negate Z to get correct orientation)
    const shape = new THREE.Shape()
    shape.moveTo(worldPts[0][0], -worldPts[0][1])

    for (let i = 1; i < worldPts.length; i++) {
      shape.lineTo(worldPts[i][0], -worldPts[i][1])
    }
    shape.closePath()

    return shape
  }, [points, cursorPoint])

  if (points.length === 0) return null

  return (
    <group>
      {/* Preview fill */}
      {previewShape && (
        <mesh
          frustumCulled={false}
          position={[0, levelYOffset + Y_OFFSET, 0]}
          rotation={[-Math.PI / 2, 0, 0]}
        >
          <shapeGeometry args={[previewShape]} />
          <meshBasicMaterial
            color="#3b82f6"
            depthTest={false}
            opacity={0.15}
            side={THREE.DoubleSide}
            transparent
          />
        </mesh>
      )}

      {/* Main line */}
      {linePoints.length >= 2 && (
        <Line
          color="#3b82f6"
          depthTest={false}
          depthWrite={false}
          lineWidth={2}
          points={linePoints}
          renderOrder={99_999}
        />
      )}

      {/* Closing line (dashed) */}
      {closingLinePoints.length === 2 && (
        <Line
          color="#3b82f6"
          dashed
          dashScale={10}
          depthTest={false}
          lineWidth={1}
          points={closingLinePoints}
        />
      )}

      {/* Point markers */}
      {points.map(([x, z], index) => {
        const [wx, wz] = toWorld(x, z)
        return (
          <mesh key={index} position={[wx, levelYOffset + Y_OFFSET + 0.03, wz]}>
            <sphereGeometry args={[0.1, 16, 16]} />
            <meshBasicMaterial
              color={index === 0 ? '#22c55e' : '#3b82f6'}
              depthTest={false}
              depthWrite={false}
            />
          </mesh>
        )
      })}
    </group>
  )
}

/**
 * Main zone renderer component
 * Renders all zones for the current level and the drawing preview
 */
export function ZoneRenderer({ isViewer = false }: { isViewer?: boolean }) {
  const selectedFloorId = useEditor((state) => state.selectedFloorId)
  const selectedZoneId = useEditor((state) => state.selectedZoneId)
  const selectZone = useEditor((state) => state.selectZone)
  const levelMode = useEditor((state) => state.levelMode)
  const viewMode = useEditor((state) => state.viewMode)

  // Determine if a zone should be interactive
  // Only zones on the currently selected level are interactive in viewer mode
  const getIsInteractive = useCallback(
    (zoneLevelId: string) => isViewer && !!selectedFloorId && zoneLevelId === selectedFloorId,
    [isViewer, selectedFloorId],
  )

  const handleSelectZone = useCallback(
    (zoneId: string) => {
      selectZone(zoneId)
    },
    [selectZone],
  )

  // Get building levels for Y offset calculation
  const buildingLevels = useEditor((state) => {
    const site = state.scene.root.children?.[0]
    const building = site?.children?.find((c) => c.type === 'building')
    return building?.children ?? []
  })

  // Memoize level data to avoid recalculating on every render
  const levelData = useMemo(() => {
    const data: Record<string, { level: number; elevation: number }> = {}
    for (const lvl of buildingLevels) {
      if (lvl.type === 'level') {
        data[lvl.id] = {
          level: (lvl as any).level ?? 0,
          elevation: (lvl as any).elevation ?? 0,
        }
      }
    }
    return data
  }, [buildingLevels])

  // Get all zones from the store
  const allZones = useEditor(useShallow((state: StoreState) => state.scene.zones || []))

  // Filter zones based on view mode and selection
  const zones = useMemo(() => {
    // In viewer mode with a zone selected, hide all zones
    if (isViewer && selectedZoneId) {
      return []
    }
    // In viewer mode with a floor selected, only show zones for that floor
    if (isViewer && selectedFloorId) {
      return allZones.filter((c) => c.levelId === selectedFloorId)
    }
    // In full view mode (no floor selected), show all zones
    if (viewMode === 'full' || !selectedFloorId) {
      return allZones
    }
    // In level view mode, show only zones for the selected floor
    return allZones.filter((c) => c.levelId === selectedFloorId)
  }, [allZones, viewMode, selectedFloorId, isViewer, selectedZoneId])

  // Calculate Y offset for the current level (used for preview)
  const previewLevelYOffset = useMemo(() => {
    if (!selectedFloorId) return 0
    const data = levelData[selectedFloorId]
    if (!data) return 0
    // Elevation is always applied, levelOffset only in exploded mode
    const levelOffset = levelMode === 'exploded' ? data.level * FLOOR_SPACING : 0
    return (data.elevation || 0) + levelOffset
  }, [levelMode, selectedFloorId, levelData])

  // Calculate Y offset for a specific level (matches node-renderer logic)
  const getLevelYOffset = useCallback(
    (levelId: string) => {
      const data = levelData[levelId]
      if (!data) return 0
      // Elevation is always applied, levelOffset only in exploded mode
      const levelOffset = levelMode === 'exploded' ? data.level * FLOOR_SPACING : 0
      return (data.elevation || 0) + levelOffset
    },
    [levelMode, levelData],
  )

  // Determine if labels should be shown for a zone
  // Show labels in viewer mode when on the selected floor and no zone is selected
  const getShowLabel = useCallback(
    (zoneLevelId: string) => isViewer && !selectedZoneId,
    [isViewer, selectedFloorId, selectedZoneId],
  )

  return (
    <group>
      {/* Render all zones */}
      {zones.map((zone) => (
        <ZonePolygon
          isInteractive={getIsInteractive(zone.levelId)}
          isSelected={selectedZoneId === zone.id}
          key={zone.id}
          levelYOffset={getLevelYOffset(zone.levelId)}
          onSelect={handleSelectZone}
          showLabel={getShowLabel(zone.levelId)}
          zone={zone}
        />
      ))}

      {/* Render the drawing preview */}
      <ZonePreview levelYOffset={previewLevelYOffset} />
    </group>
  )
}
