'use client'

import { isNodeKindEnabled, useScene } from '@pascal-app/core'
import { useEffect } from 'react'
import useEditor, { type Tool } from '../store/use-editor'

export function useRegisteredToolEnabled(tool: Tool | null): boolean {
  const installedPlugins = useScene((state) => state.installedPlugins)
  const enabled = tool === null || isNodeKindEnabled(tool, installedPlugins)

  useEffect(() => {
    if (enabled || tool === null) return

    // The render gate has already unmounted the tool, so its own cleanup cancels
    // any draft before clearing the stale selection prevents reinstall remounts.
    if (useEditor.getState().tool === tool) useEditor.getState().setTool(null)
  }, [enabled, tool])

  return enabled
}
