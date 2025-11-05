'use client'

import { type GridEvent, useEditor } from '@/hooks/use-editor'
import { useEffect } from 'react'

type WallBuilderProps = {}

export function WallBuilder({}: WallBuilderProps) {
  const registerHandler = useEditor((state) => state.registerHandler)
  const unregisterHandler = useEditor((state) => state.unregisterHandler)

  useEffect(() => {
    const handleGridEvent = (e: GridEvent) => {
      console.log('WallBuilder event', e.type, e.position)

      switch (e.type) {
        case 'click': {
          const [x, y] = e.position
          if (wallStartPoint === null) {
            // First click: set start point and create preview node
            setWallStartPoint([x, y])
            setWallPreviewEnd(null)
          } else {
            // Second click: commit the preview wall
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
