'use client'

import { initSpaceDetectionSync, initSpatialGridSync, useScene } from '@pascal-app/core'
import { Viewer } from '@pascal-app/viewer'
import { useKeyboard } from '@/hooks/use-keyboard'
import useEditor from '@/store/use-editor'
import { ZoneSystem } from '../systems/zone/zone-system'
import { ToolManager } from '../tools/tool-manager'
import { ActionMenu } from '../ui/action-menu'
import { CloudSaveButton } from '../ui/cloud-save-button'
import { PanelManager } from '../ui/panels/panel-manager'
import { SidebarProvider } from '../ui/primitives/sidebar'
import { AppSidebar } from '../ui/sidebar/app-sidebar'
import { CustomCameraControls } from './custom-camera-controls'
import { ExportManager } from './export-manager'
import { Grid } from './grid'
import { SelectionManager } from './selection-manager'

useScene.getState().loadScene()
console.log('Loaded scene in editor')
initSpatialGridSync()
initSpaceDetectionSync(useScene, useEditor)

export default function Editor() {
  useKeyboard()

  return (
    <div className="w-full h-full">
      <ActionMenu />
      <PanelManager />
      <CloudSaveButton />

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
