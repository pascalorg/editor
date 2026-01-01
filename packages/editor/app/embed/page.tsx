'use client'

import { useSearchParams } from 'next/navigation'
import { Suspense, useEffect, useState } from 'react'
// Import node registrations to ensure all renderers are available
import '@/components/nodes'
import { ErrorBoundary } from '@/components/ui/error-boundary'
import {SceneViewer, Viewer, WallMode} from '@pascal-app/viewer'
import { useEditor,  waitForHydration } from '@/hooks/use-editor'

function ViewerContent() {
  const searchParams = useSearchParams()
  const sceneUrl = searchParams.get('sceneUrl')
  

  return (
    <SceneViewer
      sceneUrl={sceneUrl || undefined}
    />
  )
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
