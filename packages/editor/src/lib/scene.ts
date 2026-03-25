'use client'

import { useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import useEditor from '../store/use-editor'

export type SceneGraph = {
  nodes: Record<string, unknown>
  rootNodeIds: string[]
}

export const isSceneGraph = (value: unknown): value is SceneGraph => {
  if (!value || typeof value !== 'object') {
    return false
  }

  const candidate = value as {
    nodes?: unknown
    rootNodeIds?: unknown
  }

  if (!candidate.nodes || typeof candidate.nodes !== 'object' || Array.isArray(candidate.nodes)) {
    return false
  }

  return (
    Array.isArray(candidate.rootNodeIds) &&
    candidate.rootNodeIds.every((entry) => typeof entry === 'string')
  )
}

export function syncEditorSelectionFromCurrentScene() {
  const sceneNodes = useScene.getState().nodes as Record<string, any>
  const sceneRootIds = useScene.getState().rootNodeIds
  const siteNode = sceneRootIds[0] ? sceneNodes[sceneRootIds[0]] : null
  const resolve = (child: any) => (typeof child === 'string' ? sceneNodes[child] : child)
  const firstBuilding = siteNode?.children?.map(resolve).find((n: any) => n?.type === 'building')
  const firstLevel = firstBuilding?.children?.map(resolve).find((n: any) => n?.type === 'level')

  if (firstBuilding && firstLevel) {
    useViewer.getState().setSelection({
      buildingId: firstBuilding.id,
      levelId: firstLevel.id,
      selectedIds: [],
      zoneId: null,
    })
    useEditor.getState().setPhase('structure')
    useEditor.getState().setStructureLayer('elements')

    if (!firstLevel.children || firstLevel.children.length === 0) {
      useEditor.getState().setMode('build')
      useEditor.getState().setTool('wall')
    }
  } else {
    useEditor.getState().setPhase('site')
    useViewer.getState().setSelection({
      buildingId: null,
      levelId: null,
      selectedIds: [],
      zoneId: null,
    })
  }
}

export function applySceneGraphToEditor(sceneGraph?: SceneGraph | null) {
  if (isSceneGraph(sceneGraph)) {
    const { nodes, rootNodeIds } = sceneGraph
    useScene.getState().setScene(nodes as any, rootNodeIds as any)
  } else {
    useScene.getState().clearScene()
  }

  syncEditorSelectionFromCurrentScene()
}

export function importSceneGraphToEditor(sceneGraph?: SceneGraph | null) {
  applySceneGraphToEditor(sceneGraph)
}

const LOCAL_STORAGE_KEY = 'pascal-editor-scene'

export function saveSceneToLocalStorage(scene: SceneGraph): void {
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(scene))
  } catch {
    // Swallow storage quota errors
  }
}

export function loadSceneFromLocalStorage(): SceneGraph | null {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY)
    return raw ? (JSON.parse(raw) as SceneGraph) : null
  } catch {
    return null
  }
}
