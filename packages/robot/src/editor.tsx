'use client'

import { Suspense, type ReactNode } from 'react'
import type { HoverStyles } from '@pascal-app/viewer'
import './editor-extensions'
import useNavigation from './store/use-navigation'
import { NavigationItemVisualSystem } from './components/navigation-item-visual-system'
import { NavigationTaskQueuePanel } from './components/ui/navigation-task-queue-panel'
export { NavigationSystem } from './components/navigation-system'
export { NavigationToolbarButton } from './components/navigation-toolbar-button'
export { NavigationPanel } from './components/ui/navigation-panel'
export { NavigationTaskQueuePanel } from './components/ui/navigation-task-queue-panel'
export { prepareNavigationSceneGraph } from './editor-scene'
import { NavigationSystem } from './components/navigation-system'
import { ToolConeOverlayViewer } from './components/tool-cone-overlay-viewer'

export function NavigationEditorSystems() {
  const robotMode = useNavigation((state) => state.robotMode)

  if (robotMode === null) {
    return null
  }

  return (
    <Suspense fallback={null}>
      <NavigationSystem />
      <NavigationItemVisualSystem />
    </Suspense>
  )
}

export function NavigationViewerFrame({
  children,
  hoverStyles,
  selectionManager,
}: {
  children: ReactNode
  hoverStyles: HoverStyles
  selectionManager: 'custom' | 'default'
}) {
  const robotMode = useNavigation((state) => state.robotMode)

  return (
    <div className="relative h-full w-full">
      <ToolConeOverlayViewer
        enabled={robotMode !== null}
        hoverStyles={hoverStyles}
        selectionManager={selectionManager}
      >
        <NavigationEditorSystems />
        {children}
      </ToolConeOverlayViewer>
      <NavigationTaskQueuePanel />
    </div>
  )
}
