'use client'

import { useEffect } from 'react'
import { initSpaceDetectionSync, initSpatialGridSync, useScene } from '@pascal-app/core'
import { Viewer, useViewer } from '@pascal-app/viewer'
import { useProjectScene } from '@/features/community/lib/models/hooks'
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
import { SidebarProvider } from '../ui/primitives/sidebar'
import { AppSidebar } from '../ui/sidebar/app-sidebar'
import { CustomCameraControls } from './custom-camera-controls'
import { ExportManager } from './export-manager'
import { FloatingActionMenu } from './floating-action-menu'
import { Grid } from './grid'
import { SelectionManager } from './selection-manager'
import { ThumbnailGenerator } from './thumbnail-generator'
import { useProjectStore } from '@/features/community/lib/projects/store'
import { SceneLoader } from '../ui/scene-loader'

// Load default scene initially (will be replaced when project loads)
useScene.getState().loadScene()
initSpatialGridSync()
initSpaceDetectionSync(useScene, useEditor)

// Auto-select the first building and level for the default scene
const sceneNodes = useScene.getState().nodes as Record<string, any>
const sceneRootIds = useScene.getState().rootNodeIds
const siteNode = sceneRootIds[0] ? sceneNodes[sceneRootIds[0]] : null
const resolve = (child: any) => typeof child === 'string' ? sceneNodes[child] : child
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

export default function Editor({ projectId }: EditorProps) {
  useKeyboard()
  useProjectScene()

  const isProjectLoading = useProjectStore((state) => state.isLoading)
  const isSceneLoading = useProjectStore((state) => state.isSceneLoading)
  const isLoading = isProjectLoading || isSceneLoading

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
      <Viewer selectionManager="custom" isEditor={true}>
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
      </Viewer>
    </div>
  )
}
