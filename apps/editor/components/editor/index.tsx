'use client'

import { initSpaceDetectionSync, initSpatialGridSync, useScene } from '@pascal-app/core'
import { useViewer, Viewer } from '@pascal-app/viewer'
import { useEffect } from 'react'
import { useProjectScene } from '@/features/community/lib/models/hooks'
import { useProjectStore } from '@/features/community/lib/projects/store'
import { useKeyboard } from '@/hooks/use-keyboard'
import { initSFXBus } from '@/lib/sfx-bus'
import useEditor from '@/store/use-editor'
import { FeedbackDialog } from '../feedback-dialog'
import { PascalRadio } from '../pascal-radio'
import { CeilingSystem } from '../systems/ceiling/ceiling-system'
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
import { ExportManager } from './export-manager'
import { FloatingActionMenu } from './floating-action-menu'
import { Grid } from './grid'
import { PresetThumbnailGenerator } from './preset-thumbnail-generator'
import { SelectionManager } from './selection-manager'
import { SiteEdgeLabels } from './site-edge-labels'
import { ThumbnailGenerator } from './thumbnail-generator'

// Load default scene initially (will be replaced when project loads)
useScene.getState().loadScene()
initSpatialGridSync()
initSpaceDetectionSync(useScene, useEditor)

// Auto-select the first building and level for the default scene
const sceneNodes = useScene.getState().nodes as Record<string, any>
const sceneRootIds = useScene.getState().rootNodeIds
const siteNode = sceneRootIds[0] ? sceneNodes[sceneRootIds[0]] : null
const resolve = (child: any) => (typeof child === 'string' ? sceneNodes[child] : child)
const firstBuilding = siteNode?.children?.map(resolve).find((n: any) => n?.type === 'building')
const firstLevel = firstBuilding?.children?.map(resolve).find((n: any) => n?.type === 'level')

if (firstBuilding && firstLevel) {
  useViewer.getState().setSelection({
    buildingId: firstBuilding.id,
    levelId: firstLevel.id,
    selectedIds: [],
    zoneId: null,
  })
  useEditor.getState().setPhase('structure')
  useEditor.getState().setStructureLayer('elements')

  // Auto-select the wall tool if the level is empty
  if (!firstLevel.children || firstLevel.children.length === 0) {
    useEditor.getState().setMode('build')
    useEditor.getState().setTool('wall')
  }
}

// Initialize SFX bus to connect events to sound effects
initSFXBus()

interface EditorProps {
  projectId?: string
}

function EditorSceneCrashFallback() {
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-background/95 p-4 text-foreground">
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
  useProjectScene()

  const isProjectLoading = useProjectStore((state) => state.isLoading)
  const isSceneLoading = useProjectStore((state) => state.isSceneLoading)
  const isLoading = isProjectLoading || isSceneLoading

  useEffect(() => {
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
      {isLoading && <SceneLoader />}
      <ActionMenu />
      <PanelManager />
      <HelperManager />

      {/* Top-right controls */}
      <div className="pointer-events-none fixed top-4 right-4 z-50 flex items-start gap-2">
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
      <ErrorBoundary key={projectId} fallback={<EditorSceneCrashFallback />}>
        <Viewer selectionManager="custom" allowZoneLabelEditing>
          <SelectionManager />
          <FloatingActionMenu />
          <ExportManager />
          {/* Editor only system to toggle zone visibility */}
          <ZoneSystem />
          <CeilingSystem />
          {/* <Stats /> */}
          <Grid cellColor="#aaa" sectionColor="#ccc" fadeDistance={500} />
          <ToolManager />
          <CustomCameraControls />
          <ThumbnailGenerator projectId={projectId} />
          <PresetThumbnailGenerator />
          <SiteEdgeLabels />
        </Viewer>
      </ErrorBoundary>
    </div>
  )
}
