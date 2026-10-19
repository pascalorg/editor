'use client'

import {
  artifactUrl,
  type GeometryScriptSource,
  type ItemNode,
  scriptedSize,
} from '@pascal-app/core'
import { useMemo } from 'react'
import { ScriptedModel } from '../item/renderer'

/**
 * A finish its script built (a room's floor, a wall's face), drawn as an authored object's artifact
 * is (its slots, the render shading), in the frame it was built in. It belongs to its host: no
 * pointer events of its own, so a click on it reaches the floor or the wall beneath.
 */
export function FinishScriptModel({
  ownerId,
  parentId,
  script,
}: {
  ownerId: string
  parentId: string | null
  script: GeometryScriptSource
}) {
  const view = useMemo(() => {
    const [width, height, depth] = scriptedSize(script.manifest)
    return {
      id: ownerId,
      type: 'item',
      parentId,
      metadata: {},
      source: script,
      scale: [1, 1, 1],
      asset: {
        src: artifactUrl(script.artifact),
        dimensions: [width, height, depth],
        offset: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
      },
    } as unknown as ItemNode
  }, [ownerId, parentId, script])
  return <ScriptedModel setSettled={settleNothing} view={view} />
}

const settleNothing = () => {}
