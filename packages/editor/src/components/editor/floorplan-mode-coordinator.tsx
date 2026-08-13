'use client'

import { emitter, nodeRegistry } from '@pascal-app/core'
import { X } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { getFloorplanNodeExtension } from '../../lib/floorplan/floorplan-extension'
import { isFloorplanToolAvailableInMode } from '../../lib/floorplan/floorplan-mode'
import { LocalizedContent } from '../../lib/i18n'
import useEditor from '../../store/use-editor'
import useFloorplanMode from '../../store/use-floorplan-mode'

function getToolLabel(tool: string): string {
  return nodeRegistry.get(tool)?.presentation?.label ?? tool
}

export function FloorplanModeCoordinator() {
  const editorMode = useEditor((state) => state.mode)
  const tool = useEditor((state) => state.tool)
  const floorplanMode = useFloorplanMode((state) => state.mode)
  const notice = useFloorplanMode((state) => state.notice)
  const dismissNotice = useFloorplanMode((state) => state.dismissNotice)
  const setFloorplanMode = useFloorplanMode((state) => state.setMode)
  const showExpertModeNotice = useFloorplanMode((state) => state.showExpertModeNotice)
  const showNotice = useFloorplanMode((state) => state.showNotice)
  const previousFloorplanMode = useRef(floorplanMode)

  useEffect(() => {
    const priorFloorplanMode = previousFloorplanMode.current
    previousFloorplanMode.current = floorplanMode
    if (floorplanMode !== 'default' || editorMode !== 'build' || !tool) return
    const extension = getFloorplanNodeExtension(nodeRegistry.get(tool))
    if (isFloorplanToolAvailableInMode(extension?.availableModes, floorplanMode)) return

    const toolLabel = getToolLabel(tool)
    emitter.emit('tool:cancel')
    useEditor.getState().setMode('select')
    if (priorFloorplanMode === 'expert') {
      showNotice(
        `Switched to Default. The unfinished ${toolLabel} draft was canceled; saved Expert annotations are hidden, not deleted.`,
      )
    } else {
      showExpertModeNotice(toolLabel)
    }
  }, [editorMode, floorplanMode, showExpertModeNotice, showNotice, tool])

  useEffect(() => {
    if (!notice || notice.kind === 'switch-to-expert') return
    const timer = window.setTimeout(dismissNotice, 6000)
    return () => window.clearTimeout(timer)
  }, [dismissNotice, notice])

  if (!notice) return null

  return (
    <LocalizedContent>
      <div
        aria-live="polite"
        className="fixed top-16 left-1/2 z-[100] flex max-w-md -translate-x-1/2 items-center gap-3 rounded-lg border border-border/60 bg-background/95 px-3 py-2 text-sm text-foreground shadow-elevation-3 backdrop-blur-xl"
        role="status"
      >
        <span>{notice.message}</span>
        {notice.kind === 'switch-to-expert' ? (
          <button
            className="shrink-0 rounded-md bg-cyan-500/15 px-2.5 py-1 font-medium text-cyan-400 hover:bg-cyan-500/25"
            onClick={() => {
              setFloorplanMode('expert')
              dismissNotice()
            }}
            type="button"
          >
            Switch to Expert
          </button>
        ) : null}
        <button
          aria-label="Dismiss"
          className="shrink-0 rounded p-1 text-muted-foreground hover:bg-white/10 hover:text-foreground"
          onClick={dismissNotice}
          type="button"
        >
          <X aria-hidden="true" className="h-3.5 w-3.5" />
        </button>
      </div>
    </LocalizedContent>
  )
}
