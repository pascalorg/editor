'use client'

import Editor from '@/components/editor'
import { useParams } from 'next/navigation'
import { useEffect, useLayoutEffect } from 'react'
import { useProjectStore } from '@/features/community/lib/projects/store'
import { useAuth } from '@/features/community/lib/auth/hooks'

export default function EditorPage() {
  const params = useParams()
  const projectId = params.projectId as string
  const { isAuthenticated } = useAuth()
  const setActiveProject = useProjectStore((state) => state.setActiveProject)

  // Use layoutEffect to set active project BEFORE the editor renders and hooks run
  useLayoutEffect(() => {
    // For authenticated users with cloud projects, set the active project from URL
    if (isAuthenticated && projectId && !projectId.startsWith('local_')) {
      setActiveProject(projectId)
    }
  }, [projectId, isAuthenticated, setActiveProject])

  return (
    <div className="flex h-screen w-full max-w-screen">
      <div className="relative h-full w-full">
        <Editor projectId={projectId} />
      </div>
    </div>
  )
}
