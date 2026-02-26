'use client'

import Editor from '@/components/editor'
import { useParams, useRouter } from 'next/navigation'
import { useLayoutEffect } from 'react'
import { useProjectStore } from '@/features/community/lib/projects/store'
import { useAuth } from '@/features/community/lib/auth/hooks'

export default function EditorPage() {
  const params = useParams()
  const projectId = params.projectId as string
  const { isAuthenticated, isLoading } = useAuth()
  const setActiveProject = useProjectStore((state) => state.setActiveProject)
  const router = useRouter()

  // Use layoutEffect to set active project BEFORE the editor renders and hooks run
  useLayoutEffect(() => {
    if (isLoading) return
    if (!isAuthenticated) {
      router.replace('/')
      return
    }
    if (projectId) {
      setActiveProject(projectId)
    }
  }, [projectId, isAuthenticated, isLoading, setActiveProject, router])

  if (isLoading || !isAuthenticated) {
    return null
  }

  return (
    <div className="flex h-screen w-full max-w-screen">
      <div className="relative h-full w-full">
        <Editor projectId={projectId} />
      </div>
    </div>
  )
}
