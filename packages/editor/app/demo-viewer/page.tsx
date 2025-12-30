'use client'

import { SceneViewer } from '@pascal/viewer'
import Viewer from '@/components/viewer'

export default function DemoViewerPage() {
  return (
    <div className="h-screen w-screen">
      <SceneViewer
        sceneUrl="/demos/creative-learning-center.json"
        ViewerComponent={Viewer}
        defaultZoom={80}
        defaultWallMode="cutaway"
        onSceneLoaded={() => console.log('Scene loaded successfully')}
        onError={(error) => console.error('Failed to load scene:', error)}
        onSelectionChange={(selection) => {
          console.log('Selection changed:', selection)
        }}
      />
    </div>
  )
}
