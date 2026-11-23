'use client'

import type { ElevatorNode } from '@pascal-app/core'
import { useEditor } from '@pascal-app/editor'
import ElevatorRenderer from './renderer'

export default function EditorElevatorRenderer({ node }: { node: ElevatorNode }) {
  const interactionEnabled = useEditor((state) => state.mode === 'select' || state.isPreviewMode)
  return <ElevatorRenderer node={node} interactionEnabled={interactionEnabled} />
}
