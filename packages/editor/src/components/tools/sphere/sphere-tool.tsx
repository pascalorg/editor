import '../../../three-types'

import {
  emitter,
  type GridEvent,
  type LevelNode,
  SphereNode,
  useScene,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useEffect, useRef, useState } from 'react'
import type { Group } from 'three'
import { sfxEmitter } from '../../../lib/sfx-bus'
import useEditor from '../../../store/use-editor'
import { CursorSphere } from '../shared/cursor-sphere'

const SPHERE_ICON = (
  // eslint-disable-next-line @next/next/no-img-element
  <img
    alt="Sphere"
    src="/icons/sphere.png"
    style={{ width: '100%', height: '100%', objectFit: 'contain' }}
  />
)

const roundToHalf = (value: number) => Math.round(value * 2) / 2

function createSphere(position: [number, number, number]) {
  return SphereNode.parse({
    name: 'Sphere',
    radius: 0.5,
    position,
    rotation: [0, 0, 0],
  })
}

type SphereToolProps = {
  currentLevelId: LevelNode['id'] | null
}

export const SphereTool: React.FC<SphereToolProps> = ({ currentLevelId }) => {
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
      const sphere = createSphere(position)
      useScene.getState().createNode(sphere, currentLevelId ?? undefined)
      sfxEmitter.emit('sfx:structure-build')
      useViewer.getState().setSelection({ selectedIds: [sphere.id] })
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
      tooltipContent={SPHERE_ICON}
    />
  )
}
