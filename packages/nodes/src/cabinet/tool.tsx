'use client'

import { CabinetModuleNode, CabinetNode, emitter, type GridEvent, useScene } from '@pascal-app/core'
import { isGridSnapActive, triggerSFX, useEditor } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { Html } from '@react-three/drei'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Group, Mesh } from 'three'
import { LevelOffsetGroup } from '../shared/level-offset-group'
import { cabinetDefinition, cabinetModuleDefinition } from './definition'
import { buildCabinetGeometry } from './geometry'

const PREVIEW_OPACITY = 0.55
const ROTATE_STEP_RAD = Math.PI / 4

function runModuleBaseY(plinthHeight: number, showPlinth: boolean) {
  return showPlinth ? plinthHeight : 0
}

function snap(value: number, step: number): number {
  if (step <= 0) return value
  return Math.round(value / step) * step
}

const CabinetTool = () => {
  const activeLevelId = useViewer((s) => s.selection.levelId)
  const [cursor, setCursor] = useState<[number, number, number] | null>(null)
  const [yaw, setYaw] = useState(0)
  const yawRef = useRef(0)

  const previewNode = useMemo(
    () => CabinetModuleNode.parse({ ...cabinetModuleDefinition.defaults(), name: 'Base Cabinet' }),
    [],
  )
  const ghost = useMemo(() => {
    const group = buildCabinetGeometry(previewNode)
    group.traverse((child) => {
      if (child instanceof Mesh) {
        child.material = child.material.clone()
        child.material.transparent = true
        child.material.opacity = PREVIEW_OPACITY
      }
    })
    return group
  }, [previewNode])

  useEffect(() => {
    if (!activeLevelId) return

    const resolve = (event: GridEvent): [number, number, number] => {
      const step = isGridSnapActive() ? useEditor.getState().gridSnapStep : 0
      return [snap(event.localPosition[0], step), 0, snap(event.localPosition[2], step)]
    }

    const onMove = (event: GridEvent) => setCursor(resolve(event))

    const onClick = (event: GridEvent) => {
      const position = resolve(event)
      const cabinet = CabinetNode.parse({
        ...cabinetDefinition.defaults(),
        name: 'Modular Cabinet',
        position,
        rotation: yawRef.current,
      })
      const module = CabinetModuleNode.parse({
        ...cabinetModuleDefinition.defaults(),
        name: 'Base Cabinet',
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
      triggerSFX('sfx:item-rotate')
    }

    emitter.on('grid:move', onMove)
    emitter.on('grid:click', onClick)
    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      emitter.off('grid:move', onMove)
      emitter.off('grid:click', onClick)
      window.removeEventListener('keydown', onKeyDown, true)
    }
  }, [activeLevelId])

  if (!activeLevelId || !cursor) return null

  return (
    <LevelOffsetGroup>
      <group position={cursor} rotation={[0, yaw, 0]}>
        <primitive object={ghost as Group} />
      </group>
      <Html
        center
        position={[cursor[0], previewNode.plinthHeight + previewNode.carcassHeight + 0.35, cursor[2]]}
        style={{ pointerEvents: 'none', userSelect: 'none' }}
        zIndexRange={[100, 0]}
      >
        <div className="flex items-center gap-2 whitespace-nowrap rounded-full border border-border/60 bg-background/90 px-4 py-1.5 text-xs shadow-sm backdrop-blur">
          <span className="font-medium text-foreground">R/T rotate</span>
        </div>
      </Html>
    </LevelOffsetGroup>
  )
}

export default CabinetTool
