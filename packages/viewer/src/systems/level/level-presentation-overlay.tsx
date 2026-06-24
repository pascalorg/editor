import { type AnyNode, type AnyNodeId, type LevelNode, useScene } from '@pascal-app/core'
import { Html } from '@react-three/drei'
import { useEffect, useMemo } from 'react'
import { BufferGeometry, DoubleSide, Float32BufferAttribute } from 'three'
import useViewer from '../../store/use-viewer'
import { getLevelLayoutEntries } from './level-utils'

type Bounds2D = {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
}

type LevelOverlayItem = {
  bounds: Bounds2D
  entry: ReturnType<typeof getLevelLayoutEntries>[number]
  level: LevelNode
}

function addPoint(bounds: Bounds2D, x: number, z: number) {
  bounds.minX = Math.min(bounds.minX, x)
  bounds.maxX = Math.max(bounds.maxX, x)
  bounds.minZ = Math.min(bounds.minZ, z)
  bounds.maxZ = Math.max(bounds.maxZ, z)
}

function finiteVec2(value: unknown): [number, number] | null {
  if (
    Array.isArray(value) &&
    value.length >= 2 &&
    typeof value[0] === 'number' &&
    Number.isFinite(value[0]) &&
    typeof value[1] === 'number' &&
    Number.isFinite(value[1])
  ) {
    return [value[0], value[1]]
  }
  return null
}

function levelBounds(level: LevelNode, nodes: Record<AnyNodeId, AnyNode>): Bounds2D | null {
  const bounds: Bounds2D = {
    minX: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    minZ: Number.POSITIVE_INFINITY,
    maxZ: Number.NEGATIVE_INFINITY,
  }

  for (const childId of level.children) {
    const child = nodes[childId as AnyNodeId] as (AnyNode & Record<string, unknown>) | undefined
    if (!child) continue

    if (Array.isArray(child.polygon)) {
      for (const point of child.polygon) {
        const vec = finiteVec2(point)
        if (vec) addPoint(bounds, vec[0], vec[1])
      }
      continue
    }

    const start = finiteVec2(child.start)
    const end = finiteVec2(child.end)
    if (start) addPoint(bounds, start[0], start[1])
    if (end) addPoint(bounds, end[0], end[1])
  }

  if (!Number.isFinite(bounds.minX)) return null

  const pad = 0.18
  return {
    minX: bounds.minX - pad,
    maxX: bounds.maxX + pad,
    minZ: bounds.minZ - pad,
    maxZ: bounds.maxZ + pad,
  }
}

function rectangleSegments(bounds: Bounds2D, y: number) {
  return [
    bounds.minX,
    y,
    bounds.minZ,
    bounds.maxX,
    y,
    bounds.minZ,
    bounds.maxX,
    y,
    bounds.minZ,
    bounds.maxX,
    y,
    bounds.maxZ,
    bounds.maxX,
    y,
    bounds.maxZ,
    bounds.minX,
    y,
    bounds.maxZ,
    bounds.minX,
    y,
    bounds.maxZ,
    bounds.minX,
    y,
    bounds.minZ,
  ]
}

function createLineGeometry(points: number[]) {
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(points, 3))
  return geometry
}

function levelLabel(level: LevelNode) {
  return level.name || `楼层 ${level.level}`
}

function LevelGuideLines({
  bounds,
  height,
  showSeparator,
  targetY,
}: {
  bounds: Bounds2D
  height: number
  showSeparator: boolean
  targetY: number
}) {
  const topY = targetY + height
  const width = bounds.maxX - bounds.minX
  const depth = bounds.maxZ - bounds.minZ
  const centerX = (bounds.minX + bounds.maxX) / 2
  const centerZ = (bounds.minZ + bounds.maxZ) / 2
  const baseGeometry = useMemo(
    () => createLineGeometry(rectangleSegments(bounds, targetY + 0.015)),
    [bounds, targetY],
  )
  const topGeometry = useMemo(
    () => createLineGeometry(rectangleSegments(bounds, topY + 0.03)),
    [bounds, topY],
  )
  const railGeometry = useMemo(() => {
    const x = bounds.maxX + 0.35
    const z = bounds.minZ
    return createLineGeometry([x, targetY, z, x, topY, z])
  }, [bounds, targetY, topY])

  useEffect(
    () => () => {
      baseGeometry.dispose()
      topGeometry.dispose()
      railGeometry.dispose()
    },
    [baseGeometry, railGeometry, topGeometry],
  )

  return (
    <>
      {showSeparator && (
        <mesh
          position={[centerX, targetY + 0.018, centerZ]}
          renderOrder={69}
          rotation={[-Math.PI / 2, 0, 0]}
        >
          <planeGeometry args={[width, depth]} />
          <meshBasicMaterial
            color="#38bdf8"
            depthTest={false}
            depthWrite={false}
            opacity={0.075}
            side={DoubleSide}
            transparent
          />
        </mesh>
      )}
      <lineSegments geometry={baseGeometry} renderOrder={70}>
        <lineBasicMaterial
          color={showSeparator ? '#0ea5e9' : '#60a5fa'}
          depthTest={false}
          opacity={showSeparator ? 0.82 : 0.32}
          transparent
        />
      </lineSegments>
      <lineSegments geometry={topGeometry} renderOrder={71}>
        <lineBasicMaterial color="#38bdf8" depthTest={false} opacity={0.72} transparent />
      </lineSegments>
      <lineSegments geometry={railGeometry} renderOrder={72}>
        <lineBasicMaterial color="#38bdf8" depthTest={false} opacity={0.55} transparent />
      </lineSegments>
    </>
  )
}

export function LevelPresentationOverlay() {
  const nodes = useScene((state) => state.nodes)
  const levelMode = useViewer((state) => state.levelMode)
  const selectedLevelId = useViewer((state) => state.selection.levelId)
  const theme = useViewer((state) => state.theme)

  const items = useMemo(() => {
    if (levelMode === 'stacked' || levelMode === 'manual' || levelMode === 'solo') return []

    const levels = Object.values(nodes)
      .filter((node): node is LevelNode => node?.type === 'level')
      .sort((a, b) => a.level - b.level)

    if (levels.length <= 1) return []

    const layout = getLevelLayoutEntries({
      entries: levels.map((level) => ({ levelId: level.id, index: level.level })),
      nodes,
      levelMode,
      selectedLevelId,
    })
    const layoutById = new Map(layout.map((entry) => [entry.levelId, entry]))

    return levels
      .map((level) => {
        const entry = layoutById.get(level.id)
        const bounds = levelBounds(level, nodes)
        if (!entry?.visible || !bounds) return null
        return { level, entry, bounds }
      })
      .filter((item): item is LevelOverlayItem => item !== null)
  }, [levelMode, nodes, selectedLevelId])

  if (items.length === 0) return null

  const isDark = theme === 'dark'
  const labelColor = isDark ? '#e0f2fe' : '#082f49'
  const labelBackground = isDark ? 'rgba(8, 47, 73, 0.72)' : 'rgba(240, 249, 255, 0.82)'
  const labelBorder = isDark ? 'rgba(56, 189, 248, 0.38)' : 'rgba(14, 165, 233, 0.34)'

  return (
    <>
      {items.map(({ bounds, entry, level }) => {
        const labelY = entry.targetY + entry.height / 2
        const elevation = Number.parseFloat(entry.baseY.toFixed(2))
        const showSeparator = entry.baseY > 0
        return (
          <group key={level.id}>
            <LevelGuideLines
              bounds={bounds}
              height={entry.height}
              showSeparator={showSeparator}
              targetY={entry.targetY}
            />
            <Html
              center
              position={[bounds.maxX + 0.75, labelY, bounds.minZ - 0.2]}
              style={{ pointerEvents: 'none', userSelect: 'none' }}
              zIndexRange={[12, 0]}
            >
              <div
                className="whitespace-nowrap rounded-full border px-2 py-1 font-medium text-[11px] shadow-sm backdrop-blur"
                style={{
                  background: labelBackground,
                  borderColor: labelBorder,
                  color: labelColor,
                }}
              >
                {levelLabel(level)} · +{elevation}m
              </div>
            </Html>
          </group>
        )
      })}
    </>
  )
}
