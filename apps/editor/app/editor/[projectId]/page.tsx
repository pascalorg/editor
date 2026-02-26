'use client'

import Editor from '@/components/editor'
import { useParams, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { useProjectStore } from '@/features/community/lib/projects/store'
import { useAuth } from '@/features/community/lib/auth/hooks'
import { SceneLoader } from '@/components/ui/scene-loader'

export default function EditorPage() {
  const params = useParams()
  const projectId = params.projectId as string
  const { isAuthenticated, isLoading } = useAuth()
  const setActiveProject = useProjectStore((state) => state.setActiveProject)
  const router = useRouter()
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  // Use layoutEffect to set active project BEFORE the editor renders and hooks run
  useEffect(() => {
    if (isLoading) return
    if (!isAuthenticated) {
      router.replace('/')
      return
    }
    if (projectId) {
      setActiveProject(projectId)
    }
  }, [projectId, isAuthenticated, isLoading, setActiveProject, router])

  if (!mounted || isLoading) {
    return <SceneLoader fullScreen />
  }

  if (!isAuthenticated) {
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
