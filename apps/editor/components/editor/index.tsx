'use client'

import { initSpaceDetectionSync, initSpatialGridSync, useScene } from '@pascal-app/core'
import { Viewer } from '@pascal-app/viewer'
import { useKeyboard } from '@/hooks/use-keyboard'
import useEditor from '@/store/use-editor'
import { usePropertyScene } from '@/features/community/lib/models/hooks'
import { ZoneSystem } from '../systems/zone/zone-system'
import { ToolManager } from '../tools/tool-manager'
import { ActionMenu } from '../ui/action-menu'
import { CloudSaveButton } from '@/features/community/components/cloud-save-button'
import { PascalRadio } from '../pascal-radio'
import { PanelManager } from '../ui/panels/panel-manager'
import { HelperManager } from '../ui/helpers/helper-manager'
import { SidebarProvider } from '../ui/primitives/sidebar'
import { AppSidebar } from '../ui/sidebar/app-sidebar'
import { CustomCameraControls } from './custom-camera-controls'
import { ExportManager } from './export-manager'
import { Grid } from './grid'
import { SelectionManager } from './selection-manager'
import { initSFXBus } from '@/lib/sfx-bus'

// Load default scene initially (will be replaced when property loads)
useScene.getState().loadScene()
initSpatialGridSync()
initSpaceDetectionSync(useScene, useEditor)

// Initialize SFX bus to connect events to sound effects
initSFXBus()

export default function Editor() {
  useKeyboard()

  return (
    <div className="w-full h-full">
      <ActionMenu />
      <PanelManager />
      <HelperManager />

      {/* Top-right controls */}
      <div className="pointer-events-none fixed top-4 right-4 z-50 flex items-start gap-2">
        <div className="pointer-events-auto">
          <PascalRadio />
        </div>
        <div className="pointer-events-auto">
          <CloudSaveButton />
        </div>
      </div>

      <SidebarProvider className="fixed z-20">
        <AppSidebar />
      </SidebarProvider>
      <Viewer selectionManager="custom">
        <SelectionManager />
        <ExportManager />
        {/* Editor only system to toggle zone visibility */}
        <ZoneSystem />
        {/* <Stats /> */}
        <Grid cellColor="#aaa" sectionColor="#ccc" fadeDistance={500} />
        <ToolManager />
        <CustomCameraControls />
      </Viewer>
    </div>
  )
}
