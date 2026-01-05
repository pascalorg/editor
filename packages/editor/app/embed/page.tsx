'use client'

import { useSearchParams } from 'next/navigation'
import { Suspense } from 'react'
// Import node registrations to ensure all renderers are available
import '@/components/nodes'
import { SceneViewer, type WallMode } from '@pascal-app/viewer'
import { ErrorBoundary } from '@/components/ui/error-boundary'

const VALID_WALL_MODES = ['up', 'cutaway', 'down'] as const

function ViewerContent() {
  const searchParams = useSearchParams()
  const sceneUrl = searchParams.get('sceneUrl')
  const wallModeParam = searchParams.get('wallMode')

  // Validate wallMode parameter
  const wallMode: WallMode = (VALID_WALL_MODES as readonly string[]).includes(wallModeParam ?? '')
    ? (wallModeParam as WallMode)
    : 'cutaway'

  return <SceneViewer defaultWallMode={wallMode} sceneUrl={sceneUrl || undefined} />
}

export default function EmbedPage() {
  return (
    <main className="h-screen w-screen bg-[#303035]">
      <ErrorBoundary>
        <Suspense
          fallback={
            <div className="flex h-screen items-center justify-center text-white">Loading...</div>
          }
        >
          <ViewerContent />
        </Suspense>
      </ErrorBoundary>
    </main>
  )
}
