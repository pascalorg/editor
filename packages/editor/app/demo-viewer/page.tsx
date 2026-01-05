'use client'

import { SceneViewer } from '@pascal-app/viewer'

export default function DemoViewerPage() {
  return (
    <div className="h-screen w-screen">
      <SceneViewer
        defaultWallMode="cutaway"
        defaultZoom={80}
        onError={(error) => console.error('Failed to load scene:', error)}
        onSceneLoaded={() => console.log('Scene loaded successfully')}
        onSelectionChange={(selection) => {
          console.log('Selection changed:', selection)
        }}
        sceneUrl="/demos/creative-learning-center.json"
      />
    </div>
  )
}
