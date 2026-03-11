'use client'

import { initSpaceDetectionSync, initSpatialGridSync, useScene } from '@pascal-app/core'
import { InteractiveSystem, useViewer, Viewer } from '@pascal-app/viewer'
import { useEffect } from 'react'
import { ViewerOverlay } from '@/app/viewer/[id]/viewer-overlay'
import { ViewerZoneSystem } from '@/app/viewer/[id]/viewer-zone-system'
import { useProjectScene } from '@/features/community/lib/models/hooks'
import { useProjectStore } from '@/features/community/lib/projects/store'
import { useKeyboard } from '@/hooks/use-keyboard'
import { initSFXBus } from '@/lib/sfx-bus'
import useEditor from '@/store/use-editor'
import { FeedbackDialog } from '../feedback-dialog'
import { PascalRadio } from '../pascal-radio'
import { PreviewButton } from '../preview-button'
import { CeilingSystem } from '../systems/ceiling/ceiling-system'
import { ZoneLabelEditorSystem } from '../systems/zone/zone-label-editor-system'
import { ZoneSystem } from '../systems/zone/zone-system'
import { ToolManager } from '../tools/tool-manager'
import { ActionMenu } from '../ui/action-menu'
import { HelperManager } from '../ui/helpers/helper-manager'
import { PanelManager } from '../ui/panels/panel-manager'
import { ErrorBoundary } from '../ui/primitives/error-boundary'
import { SidebarProvider } from '../ui/primitives/sidebar'
import { SceneLoader } from '../ui/scene-loader'
import { AppSidebar } from '../ui/sidebar/app-sidebar'
import { CustomCameraControls } from './custom-camera-controls'
import { DevDebugMenu } from './dev-debug-menu'
import { ExportManager } from './export-manager'
import { FloatingActionMenu } from './floating-action-menu'
import { Grid } from './grid'
import { PresetThumbnailGenerator } from './preset-thumbnail-generator'
import { SelectionManager } from './selection-manager'
import { SiteEdgeLabels } from './site-edge-labels'
import { ThumbnailGenerator } from './thumbnail-generator'

let hasInitializedEditorRuntime = false

function initializeEditorRuntime() {
  if (hasInitializedEditorRuntime) return

  initSpatialGridSync()
  initSpaceDetectionSync(useScene, useEditor)
  initSFXBus()

  hasInitializedEditorRuntime = true
}

interface EditorProps {
  projectId?: string
}

function EditorSceneCrashFallback() {
  return (
    <div className="fixed inset-0 z-80 flex items-center justify-center bg-background/95 p-4 text-foreground">
      <div className="w-full max-w-md rounded-2xl border border-border/60 bg-background p-6 shadow-xl">
        <h2 className="text-lg font-semibold">The editor scene failed to render</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          You can retry the scene or return home without reloading the whole app shell.
        </p>
        <div className="mt-4 flex items-center gap-2">
          <button
            className="rounded-md border border-border bg-accent px-3 py-2 text-sm font-medium hover:bg-accent/80"
            onClick={() => window.location.reload()}
            type="button"
          >
            Reload editor
          </button>
          <a
            className="rounded-md border border-border bg-background px-3 py-2 text-sm font-medium hover:bg-accent/40"
            href="/"
          >
            Back to home
          </a>
        </div>
      </div>
    </div>
  )
}

export default function Editor({ projectId }: EditorProps) {
  useKeyboard()
  useProjectScene(projectId)

  const isProjectLoading = useProjectStore((state) => state.isLoading)
  const isSceneLoading = useProjectStore((state) => state.isSceneLoading)
  const isLoading = isProjectLoading || isSceneLoading
  const isPreviewMode = useEditor((s) => s.isPreviewMode)
  const activeProject = useProjectStore((s) => s.activeProject)

  useEffect(() => {
    initializeEditorRuntime()
  }, [])

  useEffect(() => {
    useViewer.getState().setHoveredId(null)
    if (projectId) {
      useViewer.getState().setProjectId(projectId)
    } else {
      useViewer.getState().setProjectId(null)
    }
  }, [projectId])

  useEffect(() => {
    document.body.classList.add('dark')
    return () => {
      document.body.classList.remove('dark')
    }
  }, [])

  return (
    <div className="w-full h-full dark text-foreground">
      {isLoading && (
        <div className="fixed inset-0 z-60">
          <SceneLoader fullScreen />
        </div>
      )}

      {!isLoading && !isPreviewMode && (
        <>
          <ActionMenu />
          <PanelManager />
          <HelperManager />
          <DevDebugMenu />

          {/* Top-right controls */}
          <div className="pointer-events-none fixed top-4 right-4 z-50 flex items-start gap-2">
            <div className="pointer-events-auto">
              <PreviewButton />
            </div>
            <div className="pointer-events-auto">
              <PascalRadio />
            </div>
            <div className="pointer-events-auto">
              <FeedbackDialog projectId={projectId} />
            </div>
          </div>

          <SidebarProvider className="fixed z-20">
            <AppSidebar />
          </SidebarProvider>
        </>
      )}

      {!isLoading && isPreviewMode && (
        <ViewerOverlay
          projectName={activeProject?.name}
          onBack={() => useEditor.getState().setPreviewMode(false)}
        />
      )}

      <ErrorBoundary fallback={<EditorSceneCrashFallback />}>
        <Viewer selectionManager={isPreviewMode ? 'default' : 'custom'} perf={typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('perf')}>
          {!isPreviewMode && !isLoading && <SelectionManager />}
          {!isPreviewMode && !isLoading && <FloatingActionMenu />}
          <ExportManager />
          {/* Swap zone systems: viewer drill-down vs editor layer toggle */}
          {isPreviewMode ? <ViewerZoneSystem /> : <ZoneSystem />}
          <CeilingSystem />
          {!isPreviewMode && <Grid cellColor="#aaa" sectionColor="#ccc" fadeDistance={500} />}
          {!isPreviewMode && !isLoading && <ToolManager />}
          <CustomCameraControls />
          <ThumbnailGenerator projectId={projectId} />
          <PresetThumbnailGenerator />
          {!isPreviewMode && <SiteEdgeLabels />}
          {isPreviewMode && <InteractiveSystem />}
        </Viewer>
        {!isPreviewMode && !isLoading && <ZoneLabelEditorSystem />}
      </ErrorBoundary>
    </div>
  )
}
