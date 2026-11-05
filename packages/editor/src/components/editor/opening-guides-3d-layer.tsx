'use client'

import {
  type AnyNode,
  type AnyNodeId,
  computeOpeningGuides,
  type DoorNode,
  getOpeningFloorDatum,
  getWallCurveFrameAt,
  getWallCurveLength,
  type OpeningSpan,
  sceneRegistry,
  useScene,
  type WallNode,
  wallSupportForNodes,
  type WindowNode,
} from '@pascal-app/core'
import { resolveWallOpeningCeiling } from '@pascal-app/core/building'
import { useViewer } from '@pascal-app/viewer'
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { BufferGeometry, Float32BufferAttribute, Line as ThreeLine } from 'three'
import { LineBasicNodeMaterial } from 'three/webgpu'
import { EDITOR_LAYER } from '../../lib/constants'
import { parseDimensionInput } from '../../lib/floorplan/dimension-drive'
import useOpeningGuides, {
  type OpeningGuide3D,
  type OpeningGuideVec3,
} from '../../store/use-opening-guides'
import { Html } from './localized-html'
import { formatMeasurement } from './measurement-pill'

const DIMENSION_COLOR = 0x81_8c_f8 // indigo — a neutral measurement
const ALIGN_COLOR = 0xef_44_44 // red — a snapped alignment (matches the 2D guide accent)
const DIMENSION_PILL = '#6366f1'
const BADGE_PILL = '#ec4899' // pink — matches the 2D equal-spacing badge
const MIN_DIMENSION_M = 0.02

// Shared depth-test-off materials so the guides read on top of the wall and
// don't rebuild GPU buffers as guides churn during a drag.
const dimensionMaterial = new LineBasicNodeMaterial({
  color: DIMENSION_COLOR,
  depthTest: false,
  depthWrite: false,
  toneMapped: false,
  transparent: true,
})
const alignMaterial = new LineBasicNodeMaterial({
  color: ALIGN_COLOR,
  depthTest: false,
  depthWrite: false,
  toneMapped: false,
  transparent: true,
})

const mid = (a: OpeningGuideVec3, b: OpeningGuideVec3): OpeningGuideVec3 => [
  (a[0] + b[0]) / 2,
  (a[1] + b[1]) / 2,
  (a[2] + b[2]) / 2,
]

export function computeOpeningGuidesForSelectedNode(
  node: AnyNode,
  nodes: Record<string, AnyNode>,
): OpeningGuide3D[] {
  if (node.type !== 'door' && node.type !== 'window') return []
  const opening = node as (WindowNode | DoorNode) & {
    width: number
    height: number
    position: readonly [number, number, number]
  }
  if (!opening.parentId) return []
  const wall = nodes[opening.parentId as AnyNodeId] as WallNode | undefined
  if (wall?.type !== 'wall') return []

  const wallLength = getWallCurveLength(wall)
  if (wallLength < 1e-6) return []
  const wallHeight = resolveWallOpeningCeiling(wall, nodes)

  const levelId = wall.parentId as AnyNodeId | undefined
  const levelYOffset = levelId ? (sceneRegistry.nodes.get(levelId)?.position.y ?? 0) : 0
  const slabElevation = wallSupportForNodes(wall, nodes).elevation

  const toWorld = (s: number, y: number): OpeningGuideVec3 => {
    const { point } = getWallCurveFrameAt(wall, s / wallLength)
    return [point.x, slabElevation + y + levelYOffset, point.y]
  }

  // Siblings
  const siblings: OpeningSpan[] = []
  const childIds = Array.isArray(wall.children) ? wall.children : []
  for (const childId of childIds) {
    if (childId === opening.id) continue
    const child = nodes[childId as AnyNodeId]
    if (!child || (child.type !== 'door' && child.type !== 'window')) continue
    const c = child as AnyNode & {
      width: number
      height: number
      position: readonly [number, number, number]
    }
    siblings.push({
      id: c.id,
      centerS: c.position[0],
      width: c.width,
      centerY:
        c.position[1] +
        getOpeningFloorDatum(wall, c, nodes) -
        slabElevation,
      height: c.height,
    })
  }

  const centerS = opening.position[0]
  const width = opening.width
  const height = opening.height
  const rawCenterY = opening.position[1]
  const datumOffset = getOpeningFloorDatum(wall, opening, nodes) - slabElevation
  const centerY = rawCenterY + datumOffset

  const guides = computeOpeningGuides({
    moving: { id: opening.id, centerS, width, centerY, height },
    siblings,
    wall: { length: wallLength, height: wallHeight },
    includeVertical: opening.type === 'window',
  })

  const out: OpeningGuide3D[] = []

  if (guides.sillHead) {
    if (guides.sillHead.sill > MIN_DIMENSION_M) {
      out.push({
        kind: 'dimension',
        id: 'sill',
        from: toWorld(centerS, 0),
        to: toWorld(centerS, guides.sillHead.bottomY),
        value: guides.sillHead.sill,
        targetNodeId: opening.id,
        wallId: wall.id,
        role: 'sill',
        centerS,
        centerY: rawCenterY,
        width,
        height,
        wallLength,
        wallHeight,
      })
    }
    if (guides.sillHead.head > MIN_DIMENSION_M) {
      out.push({
        kind: 'dimension',
        id: 'head',
        from: toWorld(centerS, guides.sillHead.topY),
        to: toWorld(centerS, wallHeight),
        value: guides.sillHead.head,
        targetNodeId: opening.id,
        wallId: wall.id,
        role: 'head',
        centerS,
        centerY: rawCenterY,
        width,
        height,
        wallLength,
        wallHeight,
      })
    }
  }

  for (const gap of guides.gaps) {
    out.push({
      kind: 'dimension',
      id: `gap:${gap.side}`,
      from: toWorld(gap.fromS, centerY),
      to: toWorld(gap.toS, centerY),
      value: gap.distance,
      targetNodeId: opening.id,
      wallId: wall.id,
      role: `gap:${gap.side}`,
      gapFromS: gap.fromS,
      gapToS: gap.toS,
      centerS,
      centerY: rawCenterY,
      width,
      height,
      wallLength,
      wallHeight,
    })
  }

  if (guides.vertical) {
    const target = siblings.find((s) => s.id === guides.vertical?.targetId)
    if (target) {
      const lo = Math.min(centerS - width / 2, target.centerS - target.width / 2)
      const hi = Math.max(centerS + width / 2, target.centerS + target.width / 2)
      out.push({
        kind: 'align-line',
        id: 'vertical',
        from: toWorld(lo, guides.vertical.y),
        to: toWorld(hi, guides.vertical.y),
      })
    }
  }

  if (guides.equalSpacing) {
    const { gap, segments } = guides.equalSpacing
    segments.forEach((seg, i) => {
      out.push({
        kind: 'badge',
        id: `spacing:${i}`,
        at: toWorld((seg.fromS + seg.toS) / 2, centerY),
        value: gap,
      })
    })
  }

  return out
}

/**
 * Wall-plane proximity / alignment guides for the 3D editor — the spatial twin
 * of the floor-plan placement dimensions + equal-spacing badges. Subscribes to
 * `useOpeningGuides` (published by the door/window move, placement, and resize
 * interactions each drag tick) and draws sill/head + edge-proximity dimensions, a sill-alignment line, and
 * equal-spacing badges.
 *
 * Additionally, when an opening (window or door) is selected, dimensions are displayed
 * and can be clicked to type new values and drive the opening's position or sill height!
 */
export const OpeningGuides3DLayer = memo(function OpeningGuides3DLayer() {
  const activeGuides = useOpeningGuides((s) => s.guides)
  const selectedIds = useViewer((s) => s.selection.selectedIds)
  const selectedId = selectedIds.length === 1 ? selectedIds[0] : null
  const nodes = useScene((s) => s.nodes)
  const selectedNode = selectedId ? nodes[selectedId] : null
  const unit = useViewer((s) => s.unit)
  const metricNotation = useViewer((s) => s.metricNotation)

  const guides = useMemo(() => {
    if (activeGuides.length > 0) return activeGuides
    if (selectedNode && (selectedNode.type === 'window' || selectedNode.type === 'door')) {
      return computeOpeningGuidesForSelectedNode(selectedNode, nodes)
    }
    return []
  }, [activeGuides, selectedNode, nodes])

  if (guides.length === 0) return null
  return (
    <>
      {guides.map((guide) => (
        <OpeningGuide guide={guide} key={guide.id} metricNotation={metricNotation} unit={unit} />
      ))}
    </>
  )
})

function OpeningGuide({
  guide,
  metricNotation,
  unit,
}: {
  guide: OpeningGuide3D
  metricNotation: 'meters' | 'millimeters'
  unit: 'metric' | 'imperial'
}) {
  const [isEditing, setIsEditing] = useState(false)
  const [inputValue, setInputValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const isInteractive = Boolean(guide.kind === 'dimension' && guide.targetNodeId && guide.wallId && guide.role)

  const handleStartEdit = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!isInteractive || guide.kind !== 'dimension') return
    setIsEditing(true)
    setInputValue(formatMeasurement(guide.value, unit, metricNotation))
  }

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [isEditing])

  const handleCommit = () => {
    setIsEditing(false)
    if (guide.kind !== 'dimension' || !guide.targetNodeId || !guide.role) return
    const parsed = parseDimensionInput(inputValue, unit)
    if (parsed === null || parsed <= 0) return

    const store = useScene.getState()
    const node = store.nodes[guide.targetNodeId as AnyNodeId]
    if (!node || !node.position) return

    const currentPos = node.position as readonly [number, number, number]
    const width = guide.width ?? (node as { width?: number }).width ?? 1.5
    const height = guide.height ?? (node as { height?: number }).height ?? 1.5
    const wallLength = guide.wallLength ?? 100
    const wallHeight = guide.wallHeight ?? 3

    let newCenterS = currentPos[0]
    let newCenterY = currentPos[1]

    if (guide.role === 'gap:left' || guide.role === 'gap:before') {
      const leftAnchor = guide.gapToS ?? 0
      newCenterS = leftAnchor + parsed + width / 2
      newCenterS = Math.max(width / 2, Math.min(wallLength - width / 2, newCenterS))
    } else if (guide.role === 'gap:right' || guide.role === 'gap:after') {
      const rightAnchor = guide.gapToS ?? wallLength
      newCenterS = rightAnchor - parsed - width / 2
      newCenterS = Math.max(width / 2, Math.min(wallLength - width / 2, newCenterS))
    } else if (guide.role === 'sill') {
      newCenterY = parsed + height / 2
      newCenterY = Math.max(height / 2, Math.min(wallHeight - height / 2, newCenterY))
    } else if (guide.role === 'head') {
      newCenterY = wallHeight - parsed - height / 2
      newCenterY = Math.max(height / 2, Math.min(wallHeight - height / 2, newCenterY))
    }

    if (newCenterS !== currentPos[0] || newCenterY !== currentPos[1]) {
      const changes = [
        {
          id: guide.targetNodeId as AnyNodeId,
          data: { position: [newCenterS, newCenterY, currentPos[2]] },
        },
      ]
      if (store.applyNodeChanges) {
        store.applyNodeChanges({ update: changes })
      } else {
        store.updateNode(guide.targetNodeId as AnyNodeId, {
          position: [newCenterS, newCenterY, currentPos[2]],
        })
      }
      if (guide.wallId) {
        store.dirtyNodes.add(guide.wallId as AnyNodeId)
      }
      store.dirtyNodes.add(guide.targetNodeId as AnyNodeId)
    }
  }

  const handleCancel = () => {
    setIsEditing(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    e.stopPropagation()
    if (e.key === 'Enter') {
      handleCommit()
    } else if (e.key === 'Escape') {
      handleCancel()
    }
  }

  if (guide.kind === 'badge') {
    return (
      <Html
        center
        position={guide.at}
        style={{ pointerEvents: 'none', userSelect: 'none' }}
        zIndexRange={[20, 0]}
      >
        <div
          className="whitespace-nowrap rounded-[3px] px-[5px] py-[2px] font-sans font-semibold text-[11px] text-white"
          style={{ backgroundColor: BADGE_PILL }}
        >
          {`= ${formatMeasurement(guide.value, unit, metricNotation)}`}
        </div>
      </Html>
    )
  }

  const material = guide.kind === 'align-line' ? alignMaterial : dimensionMaterial
  return (
    <>
      <GuideSegment from={guide.from} material={material} to={guide.to} />
      {guide.kind === 'dimension' ? (
        <Html
          center
          position={mid(guide.from, guide.to)}
          style={{ pointerEvents: isInteractive ? 'auto' : 'none' }}
          zIndexRange={[20, 0]}
        >
          {isEditing ? (
            <input
              ref={inputRef}
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              onBlur={handleCommit}
              onClick={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
              className="w-16 rounded-[3px] border border-indigo-400 bg-slate-900 px-1 py-0.5 text-center font-mono font-semibold text-[11px] text-white shadow-lg outline-none ring-2 ring-indigo-500/60"
            />
          ) : (
            <div
              onClick={isInteractive ? handleStartEdit : undefined}
              onPointerDown={isInteractive ? (e) => e.stopPropagation() : undefined}
              className={`whitespace-nowrap rounded-[3px] px-[5px] py-[2px] font-medium font-sans text-[11px] text-white select-none ${
                isInteractive
                  ? 'cursor-pointer transition-all hover:bg-indigo-600 hover:ring-2 hover:ring-white/40 active:scale-95 shadow-sm'
                  : ''
              }`}
              style={{ backgroundColor: DIMENSION_PILL }}
              title={isInteractive ? 'Click to edit dimension' : undefined}
            >
              {formatMeasurement(guide.value, unit, metricNotation)}
            </div>
          )}
        </Html>
      ) : null}
    </>
  )
}

function GuideSegment({
  from,
  to,
  material,
}: {
  from: OpeningGuideVec3
  to: OpeningGuideVec3
  material: LineBasicNodeMaterial
}) {
  const { line, position } = useMemo(() => {
    const position = new Float32BufferAttribute(new Float32Array(6), 3)
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', position)
    const line = new ThreeLine(geometry, material)
    line.frustumCulled = false
    line.layers.set(EDITOR_LAYER)
    line.renderOrder = 1000
    return { line, position }
  }, [material])

  const [fx, fy, fz] = from
  const [tx, ty, tz] = to
  useLayoutEffect(() => {
    position.setXYZ(0, fx, fy, fz)
    position.setXYZ(1, tx, ty, tz)
    position.needsUpdate = true
  }, [position, fx, fy, fz, tx, ty, tz])

  useEffect(() => () => line.geometry.dispose(), [line])
  return <primitive object={line} />
}
