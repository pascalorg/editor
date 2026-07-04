'use client'

import {
  type AnyNodeId,
  CabinetModuleNode,
  CabinetNode,
  emitter,
  type GridEvent,
  getWallThickness,
  isCurvedWall,
  spatialGridManager,
  useScene,
  type WallEvent,
  type WallNode,
} from '@pascal-app/core'
import {
  getSideFromNormal,
  isGridSnapActive,
  isMagneticSnapActive,
  isValidWallSideFace,
  triggerSFX,
  useEditor,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { Html } from '@react-three/drei'
import { useEffect, useMemo, useRef, useState } from 'react'
import { type Group, Mesh } from 'three'
import {
  type FloorPlacementClickTriggerEvent,
  getLevelLocalSnappedPosition,
  stopPlacementCommitPropagation,
  subscribeFloorPlacementClicks,
} from '../shared/floor-placement'
import { LevelOffsetGroup } from '../shared/level-offset-group'
import { findClosestWallInPlan, type WallHit } from '../shared/wall-attach-target'
import { cabinetDefinition, cabinetModuleDefinition } from './definition'
import { buildCabinetGeometry } from './geometry'
import { cabinetPresetById } from './presets'
import {
  type CabinetWallSnapPlacement,
  collectCabinetWallSnapNeighbors,
  resolveCabinetWallFaceOffset,
  resolveCabinetWallSnapPlacement,
} from './wall-snap'

const PREVIEW_OPACITY = 0.55
const ROTATE_STEP_RAD = Math.PI / 4
const DEFAULT_PLACEMENT_PRESET = cabinetPresetById('base-door')

type CabinetPlacement = {
  position: [number, number, number]
  yaw: number
  snappedToWall: boolean
  valid: boolean
  conflictIds: string[]
  guide?: CabinetWallSnapPlacement['guide']
  snapReason?: CabinetWallSnapPlacement['snapReason']
}

function runModuleBaseY(plinthHeight: number, showPlinth: boolean) {
  return showPlinth ? plinthHeight : 0
}

function snap(value: number, step: number): number {
  if (step <= 0) return value
  return Math.round(value / step) * step
}

function isFreePlacementEvent(event: FloorPlacementClickTriggerEvent): boolean {
  const native = (event as { nativeEvent?: { altKey?: boolean } }).nativeEvent
  return Boolean(native?.altKey)
}

function WallSnapGuide({
  blocked,
  guide,
}: {
  blocked: boolean
  guide: NonNullable<CabinetPlacement['guide']>
}) {
  const dx = guide.end[0] - guide.start[0]
  const dz = guide.end[2] - guide.start[2]
  const length = Math.hypot(dx, dz)
  if (length <= 1e-4) return null
  return (
    <group
      position={[
        (guide.start[0] + guide.end[0]) / 2,
        guide.start[1],
        (guide.start[2] + guide.end[2]) / 2,
      ]}
      rotation={[0, Math.atan2(-dz, dx), 0]}
    >
      <mesh>
        <boxGeometry args={[length, 0.018, 0.018]} />
        <meshBasicMaterial
          color={blocked ? '#ef4444' : '#f59e0b'}
          opacity={blocked ? 0.85 : 0.7}
          transparent
        />
      </mesh>
    </group>
  )
}

function cabinetMetadataRecord(metadata: unknown): Record<string, unknown> {
  return metadata && typeof metadata === 'object' && !Array.isArray(metadata)
    ? (metadata as Record<string, unknown>)
    : {}
}

function bumpCabinetRunsLayoutRevisionOnLevel(levelId: AnyNodeId) {
  const scene = useScene.getState()
  for (const node of Object.values(scene.nodes)) {
    if (node.type === 'cabinet' && node.parentId === levelId) {
      const metadata = cabinetMetadataRecord(node.metadata)
      const currentRevision =
        typeof metadata.cabinetLayoutRevision === 'number' ? metadata.cabinetLayoutRevision : 0
      scene.updateNode(node.id as AnyNodeId, {
        metadata: {
          ...metadata,
          cabinetLayoutRevision: currentRevision + 1,
        },
      })
    }
  }
}

function wallHitFromWallEvent(event: WallEvent): WallHit | null {
  if (!event.normal || !isValidWallSideFace(event.normal) || isCurvedWall(event.node)) return null
  const wall = event.node as WallNode
  const dx = wall.end[0] - wall.start[0]
  const dy = wall.end[1] - wall.start[1]
  const wallLength = Math.hypot(dx, dy)
  if (wallLength <= 1e-6) return null
  const side = getSideFromNormal(event.normal)

  return {
    wall,
    localX: event.localPosition[0],
    perpDistance: (side === 'front' ? 1 : -1) * (getWallThickness(wall) / 2),
    side,
    dirX: dx / wallLength,
    dirY: dy / wallLength,
    wallLength,
    itemRotation: side === 'front' ? 0 : Math.PI,
  }
}

const CabinetTool = () => {
  const activeLevelId = useViewer((s) => s.selection.levelId)
  const [placement, setPlacement] = useState<CabinetPlacement | null>(null)
  const [yaw, setYaw] = useState(0)
  const yawRef = useRef(0)
  const placementRef = useRef<CabinetPlacement | null>(null)
  const previousSnapRef = useRef<[number, number] | null>(null)
  const previousWasWallSnapRef = useRef(false)

  const previewNode = useMemo(
    () =>
      CabinetModuleNode.parse({
        ...cabinetModuleDefinition.defaults(),
        ...DEFAULT_PLACEMENT_PRESET.createPatch(),
      }),
    [],
  )
  const placementDimensions = useMemo(() => {
    const defaults = cabinetDefinition.defaults()
    return [
      previewNode.width,
      (defaults.showPlinth ? defaults.plinthHeight : 0) +
        previewNode.carcassHeight +
        (defaults.withCountertop ? defaults.countertopThickness : 0),
      previewNode.depth,
    ] as [number, number, number]
  }, [previewNode])
  const ghost = useMemo(() => {
    const group = buildCabinetGeometry(previewNode)
    group.traverse((child) => {
      if (child instanceof Mesh) {
        child.material = child.material.clone()
        child.material.transparent = true
        child.material.opacity = PREVIEW_OPACITY
        child.raycast = () => {}
      }
    })
    return group
  }, [previewNode])

  useEffect(() => {
    if (!activeLevelId) return
    placementRef.current = null
    previousSnapRef.current = null
    previousWasWallSnapRef.current = false
    let lastWallEventTime = -1

    const resolveRawPosition = (
      event: FloorPlacementClickTriggerEvent,
    ): [number, number, number] => {
      return getLevelLocalSnappedPosition(activeLevelId, event, 0, true)
    }

    const resolveGridPosition = (
      raw: [number, number, number],
      bypassGrid = false,
    ): [number, number, number] => {
      const step = !bypassGrid && isGridSnapActive() ? useEditor.getState().gridSnapStep : 0
      return [snap(raw[0], step), 0, snap(raw[2], step)]
    }

    const withPlacementValidity = (
      next: Omit<CabinetPlacement, 'conflictIds' | 'valid'>,
      bypassCollision: boolean,
    ): CabinetPlacement => {
      if (bypassCollision) return { ...next, conflictIds: [], valid: true }
      const result = spatialGridManager.canPlaceOnFloor(
        activeLevelId,
        next.position,
        placementDimensions,
        [0, next.yaw, 0],
      )
      return { ...next, conflictIds: result.conflictIds, valid: result.valid }
    }

    const resolveWallHitPlacement = (hit: WallHit): CabinetPlacement | null => {
      if (!isMagneticSnapActive()) return null
      const nodes = useScene.getState().nodes
      const neighbors = collectCabinetWallSnapNeighbors({
        hit,
        nodes,
        parentLevelId: activeLevelId as AnyNodeId,
        width: previewNode.width,
      })
      const faceOffset = resolveCabinetWallFaceOffset({
        hit,
        nodes,
        parentLevelId: activeLevelId as AnyNodeId,
      })

      const wallPlacement = resolveCabinetWallSnapPlacement({
        depth: previewNode.depth,
        faceOffset,
        gridStep: isGridSnapActive() ? useEditor.getState().gridSnapStep : 0,
        hit,
        neighbors,
        width: previewNode.width,
      })
      if (!wallPlacement) return null

      return {
        conflictIds: [],
        guide: wallPlacement.guide,
        position: wallPlacement.position,
        snapReason: wallPlacement.snapReason,
        valid: true,
        yaw: wallPlacement.yaw,
        snappedToWall: true,
      }
    }

    const resolveWallPlacement = (raw: [number, number, number]): CabinetPlacement | null => {
      if (!isMagneticSnapActive()) return null
      const nodes = useScene.getState().nodes
      const hit = findClosestWallInPlan([raw[0], raw[2]], nodes, activeLevelId as AnyNodeId)
      if (!hit) return null
      return resolveWallHitPlacement(hit)
    }

    const resolvePlacement = (event: FloorPlacementClickTriggerEvent): CabinetPlacement => {
      const raw = resolveRawPosition(event)
      const freePlacement = isFreePlacementEvent(event)
      const wallPlacement = freePlacement ? null : resolveWallPlacement(raw)
      if (wallPlacement) return withPlacementValidity(wallPlacement, freePlacement)
      return withPlacementValidity(
        {
          position: resolveGridPosition(raw, freePlacement),
          yaw: yawRef.current,
          snappedToWall: false,
        },
        freePlacement,
      )
    }

    const publishPlacement = (next: CabinetPlacement) => {
      placementRef.current = next
      setPlacement(next)
      const prev = previousSnapRef.current
      const wasWallSnap = previousWasWallSnapRef.current
      if (!prev || prev[0] !== next.position[0] || prev[1] !== next.position[2]) {
        if (next.snappedToWall && !wasWallSnap) {
          triggerSFX('sfx:item-pick')
        } else {
          triggerSFX('sfx:grid-snap')
        }
        previousSnapRef.current = [next.position[0], next.position[2]]
      }
      previousWasWallSnapRef.current = next.snappedToWall
    }

    const onGridMove = (event: GridEvent) => {
      const ts = event.nativeEvent?.timeStamp ?? -1
      if (ts === lastWallEventTime) return
      publishPlacement(resolvePlacement(event))
    }

    const onWallMove = (event: WallEvent) => {
      lastWallEventTime = event.nativeEvent?.timeStamp ?? -1
      if (event.node.parentId !== activeLevelId) return
      const hit = wallHitFromWallEvent(event)
      const next = hit ? resolveWallHitPlacement(hit) : null
      if (next) {
        publishPlacement(withPlacementValidity(next, false))
        event.stopPropagation()
        return
      }
      publishPlacement(resolvePlacement(event))
    }

    const onClick = (event: FloorPlacementClickTriggerEvent) => {
      const next = isFreePlacementEvent(event)
        ? resolvePlacement(event)
        : (placementRef.current ?? resolvePlacement(event))
      if (!next.valid) {
        stopPlacementCommitPropagation(event)
        return
      }
      const patch = DEFAULT_PLACEMENT_PRESET.createPatch()
      const cabinet = CabinetNode.parse({
        ...cabinetDefinition.defaults(),
        name: 'Modular Cabinet',
        position: next.position,
        rotation: next.yaw,
        depth: patch.depth ?? cabinetDefinition.defaults().depth,
        carcassHeight: patch.carcassHeight ?? cabinetDefinition.defaults().carcassHeight,
      })
      const module = CabinetModuleNode.parse({
        ...cabinetModuleDefinition.defaults(),
        ...patch,
        parentId: cabinet.id,
        position: [0, runModuleBaseY(cabinet.plinthHeight, cabinet.showPlinth), 0],
        depth: cabinet.depth,
        carcassHeight: cabinet.carcassHeight,
        plinthHeight: cabinet.plinthHeight,
        toeKickDepth: cabinet.toeKickDepth,
        countertopThickness: cabinet.countertopThickness,
        countertopOverhang: cabinet.countertopOverhang,
      })
      useScene.getState().createNodes([
        { node: cabinet, parentId: activeLevelId },
        { node: module, parentId: cabinet.id },
      ])
      bumpCabinetRunsLayoutRevisionOnLevel(activeLevelId as AnyNodeId)
      useViewer.getState().setSelection({ selectedIds: [module.id] })
      triggerSFX('sfx:item-place')
      stopPlacementCommitPropagation(event)
    }

    const onKeyDown = (event: KeyboardEvent) => {
      const tag = (event.target as HTMLElement | null)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      if (event.key !== 'r' && event.key !== 'R' && event.key !== 't' && event.key !== 'T') return
      event.preventDefault()
      event.stopPropagation()
      const steps = event.key === 't' || event.key === 'T' || event.shiftKey ? -1 : 1
      yawRef.current += steps * ROTATE_STEP_RAD
      setYaw(yawRef.current)
      if (placementRef.current && !placementRef.current.snappedToWall) {
        const next = { ...placementRef.current, yaw: yawRef.current }
        placementRef.current = next
        setPlacement(next)
      }
      triggerSFX('sfx:item-rotate')
    }

    emitter.on('grid:move', onGridMove)
    emitter.on('wall:move', onWallMove)
    const unsubscribePlacementClicks = subscribeFloorPlacementClicks(onClick)
    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      emitter.off('grid:move', onGridMove)
      emitter.off('wall:move', onWallMove)
      unsubscribePlacementClicks()
      window.removeEventListener('keydown', onKeyDown, true)
    }
  }, [activeLevelId, placementDimensions, previewNode])

  if (!activeLevelId || !placement) return null
  const placementLabel = !placement.valid
    ? 'Blocked: Alt to force'
    : placement.snappedToWall
      ? placement.snapReason === 'cabinet-edge'
        ? 'Edge snap'
        : placement.snapReason === 'corner'
          ? 'Corner snap'
          : 'Wall snap'
      : 'R/T rotate'

  return (
    <LevelOffsetGroup>
      {placement.guide && <WallSnapGuide blocked={!placement.valid} guide={placement.guide} />}
      <group
        position={placement.position}
        rotation={[0, placement.snappedToWall ? placement.yaw : yaw, 0]}
      >
        <primitive object={ghost as Group} />
        {!placement.valid && (
          <mesh position={[0, placementDimensions[1] / 2, 0]}>
            <boxGeometry args={placementDimensions} />
            <meshBasicMaterial color="#ef4444" opacity={0.16} transparent wireframe />
          </mesh>
        )}
      </group>
      <Html
        center
        position={[
          placement.position[0],
          previewNode.plinthHeight + previewNode.carcassHeight + 0.35,
          placement.position[2],
        ]}
        style={{ pointerEvents: 'none', userSelect: 'none' }}
        zIndexRange={[100, 0]}
      >
        <div
          className={`flex items-center gap-2 whitespace-nowrap rounded-full border px-4 py-1.5 text-xs shadow-sm backdrop-blur ${
            placement.valid
              ? 'border-border/60 bg-background/90'
              : 'border-red-400/60 bg-red-950/85'
          }`}
        >
          <span className="font-medium text-foreground">{placementLabel}</span>
        </div>
      </Html>
    </LevelOffsetGroup>
  )
}

export default CabinetTool
