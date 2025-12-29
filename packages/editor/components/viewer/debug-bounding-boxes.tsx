'use client'

import { useThree } from '@react-three/fiber'
import { useEffect, useState } from 'react'
import { Box3, Box3Helper, Color } from 'three'
import { useEditor } from '@/hooks/use-editor'

/**
 * Renders bounding boxes for selected nodes when debug mode is enabled.
 * Must be placed inside a Canvas component.
 */
export function DebugBoundingBoxes() {
  const debug = useEditor((state) => state.debug)
  const selectedNodeIds = useEditor((state) => state.selectedNodeIds)
  const { scene } = useThree()
  const [helpers, setHelpers] = useState<Box3Helper[]>([])

  useEffect(() => {
    // Clean up previous helpers
    for (const helper of helpers) {
      scene.remove(helper)
      helper.dispose()
    }

    if (!debug || selectedNodeIds.length === 0) {
      setHelpers([])
      return
    }

    // Create new helpers for selected nodes
    const newHelpers: Box3Helper[] = []

    for (const nodeId of selectedNodeIds) {
      const object = scene.getObjectByName(nodeId)
      if (object) {
        const box = new Box3().setFromObject(object)
        if (!box.isEmpty()) {
          const helper = new Box3Helper(box, new Color(0x00_ff_00))
          helper.name = `debug-bbox-${nodeId}`
          scene.add(helper)
          newHelpers.push(helper)
        }
      }
    }

    setHelpers(newHelpers)

    // Cleanup on unmount
    return () => {
      for (const helper of newHelpers) {
        scene.remove(helper)
        helper.dispose()
      }
    }
  }, [debug, selectedNodeIds, scene])

  // This component doesn't render anything directly - it manages scene helpers
  return null
}
