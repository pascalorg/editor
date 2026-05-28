import '../../../three-types'

import {
  BoxNode,
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

const BOX_ICON = (
  // eslint-disable-next-line @next/next/no-img-element
  <img
    alt="Box"
    src="/icons/cube.png"
    style={{ width: '100%', height: '100%', objectFit: 'contain' }}
  />
)

const roundToHalf = (value: number) => Math.round(value * 2) / 2

function createBox(position: [number, number, number]) {
  return BoxNode.parse({
    name: 'Box',
    length: 1.0,
    width: 1.0,
    height: 1.0,
    position,
    rotation: [0, 0, 0],
  })
}

type BoxToolProps = {
  currentLevelId: LevelNode['id'] | null
}

export const BoxTool: React.FC<BoxToolProps> = ({ currentLevelId }) => {
  const [, setCursorPosition] = useState<[number, number, number] | null>(null)
  const cursorRef = useRef<Group>(null)
  const setPrimitivePlacement = useEditor((s) => s.setPrimitivePlacement)

  useEffect(() => {
    const onGridMove = (event: GridEvent) => {
      const nextPosition: [number, number, number] = [
        roundToHalf(event.localPosition[0]),
        0.5,
        roundToHalf(event.localPosition[2]),
      ]
      setCursorPosition(nextPosition)
      cursorRef.current?.position.set(nextPosition[0], nextPosition[1], nextPosition[2])
    }

    const onGridClick = (event: GridEvent) => {
      const position: [number, number, number] = [
        roundToHalf(event.localPosition[0]),
        0.5,
        roundToHalf(event.localPosition[2]),
      ]
      const box = createBox(position)
      useScene.getState().createNode(box, currentLevelId ?? undefined)
      sfxEmitter.emit('sfx:structure-build')
      // Select the newly placed box so its property panel opens
      useViewer.getState().setSelection({ selectedIds: [box.id] })
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
      tooltipContent={BOX_ICON}
    />
  )
}
