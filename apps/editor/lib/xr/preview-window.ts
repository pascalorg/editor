import { useScene } from '@pascal-app/core'
import type { SceneGraph } from '@pascal-app/editor'

export const XR_PREVIEW_SCENE_KEY = 'pascal-xr-preview-scene'

type XRPreviewSceneState = Pick<
  ReturnType<typeof useScene.getState>,
  'collections' | 'installedPlugins' | 'materials' | 'nodes' | 'rootNodeIds'
>

export function createXRPreviewSceneSnapshot(state: XRPreviewSceneState): SceneGraph {
  const { collections, installedPlugins, materials, nodes, rootNodeIds } = state
  return { collections, installedPlugins, materials, nodes, rootNodeIds } as SceneGraph
}

export function openXRPreview(path: string) {
  try {
    localStorage.setItem(
      XR_PREVIEW_SCENE_KEY,
      JSON.stringify(createXRPreviewSceneSnapshot(useScene.getState())),
    )
  } catch {}

  const url = new URL(path, window.location.href)
  url.searchParams.set('source', 'live')
  const preview = window.open(
    `${url.pathname}${url.search}${url.hash}`,
    'pascal-xr-preview',
    'popup=yes,width=1280,height=800,resizable=yes,scrollbars=no',
  )
  preview?.focus()
}
