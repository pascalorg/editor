'use client'

import { useParams, useRouter } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'
import { Editor, SceneLoader } from '@pascal-app/editor'
import type { SceneGraph, PresetsAdapter } from '@pascal-app/editor'
import { CommunityAppMenu } from '@/features/community/components/community-app-menu'
import { ProjectHeader } from '@/features/community/components/project-header'
import { useAuth } from '@/features/community/lib/auth/hooks'
import { getProjectModel, saveProjectModel } from '@/features/community/lib/models/actions'
import { uploadProjectThumbnail, updateProjectVisibility } from '@/features/community/lib/projects/actions'
import { useProjectStore } from '@/features/community/lib/projects/store'
import { uploadAssetWithProgress } from '@/lib/upload-asset'
import { deleteProjectAssetByUrl } from '@/features/community/lib/assets/actions'

export default function EditorPage() {
  const params = useParams()
  const projectId = params.projectId as string
  const { isAuthenticated, isLoading } = useAuth()
  const setActiveProject = useProjectStore((state) => state.setActiveProject)
  const setAutosaveStatus = useProjectStore((state) => state.setAutosaveStatus)
  const isProjectLoading = useProjectStore((state) => state.isLoading)
  const isVersionPreviewMode = useProjectStore((state) => state.isVersionPreviewMode)
  const activeProject = useProjectStore((state) => state.activeProject)
  const router = useRouter()
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

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

  const onLoad = useCallback(async (): Promise<SceneGraph | null> => {
    const result = await getProjectModel(projectId)
    return result.success ? (result.data?.model?.scene_graph ?? null) : null
  }, [projectId])

  const onSave = useCallback(async (scene: SceneGraph) => {
    await saveProjectModel(projectId, scene)
  }, [projectId])

  const apiPresetsAdapter: PresetsAdapter = {
    tabs: ['community', 'mine'],
    isAuthenticated,
    fetchPresets: async (type, tab) => {
      const res = await fetch(`/api/presets?type=${type}&tab=${tab}`)
      if (!res.ok) return []
      const json = await res.json()
      return json.presets ?? []
    },
    savePreset: async (type, name, data) => {
      const res = await fetch('/api/presets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, name, data }),
      })
      if (!res.ok) return null
      const json = await res.json()
      return json.preset?.id ?? null
    },
    overwritePreset: async (_type, id, data) => {
      await fetch(`/api/presets/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data }),
      })
    },
    renamePreset: async (id, name) => {
      await fetch(`/api/presets/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
    },
    deletePreset: async (id) => {
      await fetch(`/api/presets/${id}`, { method: 'DELETE' })
    },
    togglePresetCommunity: async (id, current) => {
      await fetch(`/api/presets/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_community: !current }),
      })
    },
    uploadPresetThumbnail: async (presetId, blob) => {
      const res = await fetch(`/api/presets/${presetId}/thumbnail`, {
        method: 'POST',
        body: blob,
        headers: { 'Content-Type': 'image/png' },
      })
      if (!res.ok) return null
      const json = await res.json()
      return json.thumbnail_url ?? null
    },
  }

  const onThumbnailCapture = useCallback(async (blob: Blob) => {
    const result = await uploadProjectThumbnail(projectId, blob)
    if (result.success) {
      useProjectStore.getState().updateActiveThumbnail(result.data.thumbnail_url)
    }
  }, [projectId])

  if (!mounted || isLoading) {
    return <SceneLoader fullScreen />
  }

  if (!isAuthenticated) {
    return null
  }

  return (
    <div className="flex h-screen w-full max-w-screen">
      <div className="relative h-full w-full">
        <Editor
          appMenuButton={<CommunityAppMenu />}
          sidebarTop={<ProjectHeader />}
          onLoad={onLoad}
          onSave={onSave}
          onSaveStatusChange={setAutosaveStatus}
          isVersionPreviewMode={isVersionPreviewMode}
          isLoading={isProjectLoading}
          onThumbnailCapture={onThumbnailCapture}
          presetsAdapter={apiPresetsAdapter}
          settingsPanelProps={{
            projectId,
            projectVisibility: activeProject ? {
              isPrivate: activeProject.is_private ?? false,
              showScansPublic: activeProject.show_scans_public ?? true,
              showGuidesPublic: activeProject.show_guides_public ?? true,
            } : undefined,
            onVisibilityChange: async (field, value) => {
              await updateProjectVisibility(projectId, { [field]: value })
            },
          }}
          sitePanelProps={{
            projectId,
            onUploadAsset: (pid, levelId, file, type) => {
              uploadAssetWithProgress(pid, levelId, file, type)
            },
            onDeleteAsset: (pid, url) => {
              deleteProjectAssetByUrl(pid, url)
            },
          }}
        />
      </div>
    </div>
  )
}
