import '../../../three-types'

import {
  CylinderNode,
  emitter,
  type GridEvent,
  type LevelNode,
  useScene,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useEffect, useRef, useState } from 'react'
import type { Group } from 'three'
import { sfxEmitter } from '../../../lib/sfx-bus'
import useEditor from '../../../store/use-editor'
import { CursorSphere } from '../shared/cursor-sphere'

const CYLINDER_ICON = (
  // eslint-disable-next-line @next/next/no-img-element
  <img
    alt="Cylinder"
    src="/icons/cylinder.png"
    style={{ width: '100%', height: '100%', objectFit: 'contain' }}
  />
)

const roundToHalf = (value: number) => Math.round(value * 2) / 2

function createCylinder(position: [number, number, number]) {
  return CylinderNode.parse({
    name: 'Cylinder',
    radius: 0.5,
    height: 1.0,
    position,
    rotation: [0, 0, 0],
  })
}

type CylinderToolProps = {
  currentLevelId: LevelNode['id'] | null
}

export const CylinderTool: React.FC<CylinderToolProps> = ({ currentLevelId }) => {
  const [, setCursorPosition] = useState<[number, number, number] | null>(null)
  const cursorRef = useRef<Group>(null)
  const setPrimitivePlacement = useEditor((s) => s.setPrimitivePlacement)

  useEffect(() => {
    const onGridMove = (event: GridEvent) => {
      const nextPosition: [number, number, number] = [
        roundToHalf(event.localPosition[0]),
        0,
        roundToHalf(event.localPosition[2]),
      ]
      setCursorPosition(nextPosition)
      cursorRef.current?.position.set(nextPosition[0], nextPosition[1], nextPosition[2])
    }

    const onGridClick = (event: GridEvent) => {
      const position: [number, number, number] = [
        roundToHalf(event.localPosition[0]),
        0,
        roundToHalf(event.localPosition[2]),
      ]
      const cylinder = createCylinder(position)
      useScene.getState().createNode(cylinder, currentLevelId ?? undefined)
      sfxEmitter.emit('sfx:structure-build')
      useViewer.getState().setSelection({ selectedIds: [cylinder.id] })
      setPrimitivePlacement(null)
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setPrimitivePlacement(null)
      }
    }

    emitter.on('grid:move', onGridMove)
    emitter.on('grid:click', onGridClick)
    window.addEventListener('keydown', onKeyDown)

    return () => {
      emitter.off('grid:move', onGridMove)
      emitter.off('grid:click', onGridClick)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [currentLevelId, setPrimitivePlacement])

  return (
    <CursorSphere
      color="#a684ff"
      height={2.5}
      ref={cursorRef}
      showTooltip
      tooltipContent={CYLINDER_ICON}
    />
  )
}
