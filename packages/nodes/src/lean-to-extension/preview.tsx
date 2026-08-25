'use client'

import type { LeanToExtensionNode } from '@pascal-app/core'
import { EDITOR_LAYER } from '@pascal-app/editor'
import { useEffect, useMemo } from 'react'
import {
  buildLeanToExtensionPreviewGeometry,
  disposeLeanToExtensionPreviewGeometry,
} from './preview-geometry'

const LeanToExtensionPreview = ({
  node,
  invalid,
}: {
  node: LeanToExtensionNode
  invalid?: boolean
}) => {
  const built = useMemo(() => {
    const next = buildLeanToExtensionPreviewGeometry(node, invalid)
    next.traverse((object) => {
      object.layers.set(EDITOR_LAYER)
      object.raycast = () => {}
    })
    return next
  }, [invalid, node])

  useEffect(
    () => () => {
      disposeLeanToExtensionPreviewGeometry(built)
    },
    [built],
  )

  return <primitive object={built} />
}

export default LeanToExtensionPreview
