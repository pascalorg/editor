'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { AssistantBar } from './assistant-bar'
import { CameraControls } from './camera-controls'
import { CanvasStage } from './canvas-stage'
import { IconRail, type RailTab } from './icon-rail'
import { LevelSwitcher } from './level-switcher'
import { DEFAULT_EXPANDED_IDS, DEFAULT_LEVEL_ID, DEFAULT_SELECTED_ID } from './scene-data'
import { ScenePanel } from './scene-panel'
import { TopBar } from './top-bar'
import type { CanvasTool, MenartTheme, ViewMode } from './types'
import { ViewToolbar } from './view-toolbar'

/** One rotate-left / rotate-right press, in degrees of camera yaw. */
const YAW_STEP = 45

export function MenartShell() {
  const [theme, setTheme] = useState<MenartTheme>('dark')
  const [tab, setTab] = useState<RailTab>('scene')
  const [panelCollapsed, setPanelCollapsed] = useState(false)
  const [assistantOpen, setAssistantOpen] = useState(true)
  const [onboardingVisible, setOnboardingVisible] = useState(true)
  const [expandedIds, setExpandedIds] = useState(() => new Set(DEFAULT_EXPANDED_IDS))
  const [activeLevelId, setActiveLevelId] = useState<string>(DEFAULT_LEVEL_ID)
  const [selectedId, setSelectedId] = useState<string | null>(DEFAULT_SELECTED_ID)
  const [viewMode, setViewMode] = useState<ViewMode>('3d')
  const [tool, setTool] = useState<CanvasTool>('measure')
  const [spin, setSpin] = useState(0)
  const assistantInputRef = useRef<HTMLInputElement>(null)

  // The assistant's own header advertises ⌘K, so the shortcut has to open the
  // bar and land the caret in it from anywhere in the shell.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== 'k' || !(event.metaKey || event.ctrlKey)) return
      event.preventDefault()
      setAssistantOpen(true)
      requestAnimationFrame(() => assistantInputRef.current?.focus())
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  const toggleNode = useCallback((id: string) => {
    setExpandedIds((current) => {
      const next = new Set(current)
      if (!next.delete(id)) next.add(id)
      return next
    })
  }, [])

  const selectNode = useCallback((id: string, isLevel: boolean) => {
    setSelectedId(id)
    if (isLevel) setActiveLevelId(id)
  }, [])

  // Picking a storey in the canvas switcher mirrors into the tree, so the two
  // level lists never disagree about which storey is being edited.
  const selectLevel = useCallback((id: string) => {
    setActiveLevelId(id)
    setSelectedId(id)
    setExpandedIds((current) => new Set(current).add(id))
  }, [])

  return (
    <div
      className="mn-root flex h-screen min-h-[760px] w-full flex-col overflow-hidden"
      data-theme={theme}
      // The UI is Turkish, and several kickers are uppercased in CSS. Without
      // this, "Kaydedildi" folds to "KAYDEDILDI" instead of "KAYDEDİLDİ".
      lang="tr"
    >
      <TopBar
        assistantOpen={assistantOpen}
        onToggleAssistant={() => setAssistantOpen((open) => !open)}
        onToggleTheme={() => setTheme((current) => (current === 'dark' ? 'light' : 'dark'))}
        theme={theme}
      />

      <div className="flex min-h-0 flex-1">
        <IconRail activeTab={tab} onSelect={setTab} />

        {!panelCollapsed && (
          <ScenePanel
            activeLevelId={activeLevelId}
            expandedIds={expandedIds}
            onboardingVisible={onboardingVisible}
            onDismissOnboarding={() => setOnboardingVisible(false)}
            onSelect={selectNode}
            onToggle={toggleNode}
            selectedId={selectedId}
            tab={tab}
          />
        )}

        <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
          <CanvasStage showDimension={tool === 'measure'} spin={spin} viewMode={viewMode} />

          <ViewToolbar
            onToolChange={setTool}
            onTogglePanel={() => setPanelCollapsed((collapsed) => !collapsed)}
            onViewModeChange={setViewMode}
            panelCollapsed={panelCollapsed}
            tool={tool}
            viewMode={viewMode}
          />

          <LevelSwitcher activeLevelId={activeLevelId} onSelect={selectLevel} />

          {assistantOpen && <AssistantBar inputRef={assistantInputRef} />}

          <CameraControls
            onRotate={(degrees) => setSpin((current) => current + degrees)}
            onTopView={() => setViewMode('2d')}
          />
        </div>
      </div>
    </div>
  )
}
