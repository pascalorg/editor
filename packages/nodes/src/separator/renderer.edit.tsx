'use client'
import type { SeparatorNode } from '@pascal-app/core'
import { useEditor } from '@pascal-app/editor'
import SeparatorRenderer from './renderer'

export default function EditorSeparatorRenderer({ node }: { node: SeparatorNode }) {
  const focusedZoneId = useEditor((s) => s.room?.zoneId)
  return <SeparatorRenderer node={node} focusedZoneId={focusedZoneId} />
}
