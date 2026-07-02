'use client'

import {
  type AnyNodeId,
  CabinetModuleNode,
  CabinetNode,
  emitter,
  type GridEvent,
  type NodeEvent,
  useScene,
} from '@pascal-app/core'
import { isGridSnapActive, isMagneticSnapActive, triggerSFX, useEditor } from '@pascal-app/editor'
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
import { findClosestWallInPlan } from '../shared/wall-attach-target'
import { cabinetDefinition, cabinetModuleDefinition } from './definition'
import { buildCabinetGeometry } from './geometry'
import { cabinetPresetById } from './presets'
import { resolveCabinetWallSnapPlacement } from './wall-snap'

const PREVIEW_OPACITY = 0.55
const ROTATE_STEP_RAD = Math.PI / 4
const DEFAULT_PLACEMENT_PRESET = cabinetPresetById('base-door')

type CabinetPlacement = {
  position: [number, number, number]
  yaw: number
  snappedToWall: boolean
  wallLocalX?: number
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

    const resolveWallPlacement = (raw: [number, number, number]): CabinetPlacement | null => {
      if (!isMagneticSnapActive()) return null
      const nodes = useScene.getState().nodes
      const hit = findClosestWallInPlan([raw[0], raw[2]], nodes, activeLevelId as AnyNodeId)
      if (!hit) return null

      const wallPlacement = resolveCabinetWallSnapPlacement({
        depth: previewNode.depth,
        gridStep: isGridSnapActive() ? useEditor.getState().gridSnapStep : 0,
        hit,
        width: previewNode.width,
      })
      if (!wallPlacement) return null

      return {
        position: wallPlacement.position,
        yaw: wallPlacement.yaw,
        snappedToWall: true,
        wallLocalX: wallPlacement.localX,
      }
    }

    const resolvePlacement = (event: FloorPlacementClickTriggerEvent): CabinetPlacement => {
      const raw = resolveRawPosition(event)
      const freePlacement = isFreePlacementEvent(event)
      const wallPlacement = freePlacement ? null : resolveWallPlacement(raw)
      if (wallPlacement) return wallPlacement
      return {
        position: resolveGridPosition(raw, freePlacement),
        yaw: yawRef.current,
        snappedToWall: false,
      }
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
      publishPlacement(resolvePlacement(event))
    }

    const onWallMove = (event: NodeEvent) => {
      publishPlacement(resolvePlacement(event))
    }

    const onClick = (event: FloorPlacementClickTriggerEvent) => {
      const next = placementRef.current ?? resolvePlacement(event)
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
  }, [activeLevelId, previewNode])

  if (!activeLevelId || !placement) return null

  return (
    <LevelOffsetGroup>
      <group
        position={placement.position}
        rotation={[0, placement.snappedToWall ? placement.yaw : yaw, 0]}
      >
        <primitive object={ghost as Group} />
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
        <div className="flex items-center gap-2 whitespace-nowrap rounded-full border border-border/60 bg-background/90 px-4 py-1.5 text-xs shadow-sm backdrop-blur">
          <span className="font-medium text-foreground">
            {placement.snappedToWall ? 'Wall snap' : 'R/T rotate'}
          </span>
        </div>
      </Html>
    </LevelOffsetGroup>
  )
}

export default CabinetTool
