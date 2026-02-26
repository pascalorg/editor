'use client'

import { initSpaceDetectionSync, initSpatialGridSync, useScene } from '@pascal-app/core'
import { Viewer } from '@pascal-app/viewer'
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
import { Grid } from './grid'
import { SelectionManager } from './selection-manager'
import { ThumbnailGenerator } from './thumbnail-generator'

// Load default scene initially (will be replaced when project loads)
useScene.getState().loadScene()
initSpatialGridSync()
initSpaceDetectionSync(useScene, useEditor)

// Initialize SFX bus to connect events to sound effects
initSFXBus()

interface EditorProps {
  projectId?: string
}

export default function Editor({ projectId }: EditorProps) {
  useKeyboard()
  useProjectScene()

  return (
    <div className="w-full h-full">
      <ActionMenu />
      <PanelManager />
      <HelperManager />

      {/* Top-right controls */}
      <div className="pointer-events-none fixed top-4 right-4 z-50 flex items-center gap-2">
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
