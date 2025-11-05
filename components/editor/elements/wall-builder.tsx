'use client'

import { type GridEvent, useEditor } from '@/hooks/use-editor'
import { useEffect } from 'react'

type WallBuilderProps = {}

export function WallBuilder({}: WallBuilderProps) {
  const registerHandler = useEditor((state) => state.registerHandler)
  const unregisterHandler = useEditor((state) => state.unregisterHandler)

  useEffect(() => {
    let wallStartPoint: [number, number] | null = null
    let wallPreviewEnd: [number, number] | null = null

    const calculateWallEndPoint = (x: number, y: number) => {
      if (wallStartPoint === null) {
        return null
      }
      const [x1, y1] = wallStartPoint

      let projectedX = x1
      let projectedY = y1

      const dx = x - x1
      const dy = y - y1
      const absDx = Math.abs(dx)
      const absDy = Math.abs(dy)

      // Calculate distances to horizontal, vertical, and diagonal lines
      const horizontalDist = absDy
      const verticalDist = absDx
      const diagonalDist = Math.abs(absDx - absDy)

      // Find the minimum distance to determine which axis to snap to
      const minDist = Math.min(horizontalDist, verticalDist, diagonalDist)

      if (minDist === diagonalDist) {
        // Snap to 45° diagonal
        const diagonalLength = Math.min(absDx, absDy)
        projectedX = x1 + Math.sign(dx) * diagonalLength
        projectedY = y1 + Math.sign(dy) * diagonalLength
      } else if (minDist === horizontalDist) {
        // Snap to horizontal
        projectedX = x
        projectedY = y1
      } else {
        // Snap to vertical
        projectedX = x1
        projectedY = y
      }
      updateWallPreview()
    }

    const handleGridEvent = (e: GridEvent) => {
      console.log('WallBuilder event', e.type, e.position)

      switch (e.type) {
        case 'click': {
          const [x, y] = e.position
          if (wallStartPoint === null) {
            // First click: set start point and create preview node
            wallStartPoint = [x, y]
            wallPreviewEnd = null
          } else {
            wallPreviewEnd = [x, y]
            // Second click: commit the preview wall
          }
          break
        }
        case 'move': {
          const [x, y] = e.position
          if (wallStartPoint !== null) {
            calculateWallEndPoint(x, y)
          }
          break
        }
        default: {
          break
        }
      }
    }

    const handlerId = 'wall-builder-handler'
    registerHandler(handlerId, handleGridEvent)
    return () => unregisterHandler(handlerId)

    // const onClick = () => {
    //   if (wallStartPoint === null) {
    //   // First click: set start point and create preview node
    //   setWallStartPoint([x, y])
    //   startWallPreview([x, y])
    // } else {
    //   // Second click: commit the preview wall
    //   commitWallPreview()

    //   // Reset placement state
    //   setWallStartPoint(null)
    //   setWallPreviewEnd(null)
    // }
    // }

    // window.addEventListener('click', onClick)
    // return () => window.removeEventListener('click', onClick)
  }, [registerHandler, unregisterHandler])
  return <></>
}
