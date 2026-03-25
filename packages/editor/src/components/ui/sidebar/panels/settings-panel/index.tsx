import { emitter, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { TreeView, VisualJson } from '@visual-json/react'
import { Camera, Download, Save, Trash2, Upload } from 'lucide-react'
import {
  type KeyboardEvent,
  type SyntheticEvent,
  useCallback,
  useMemo,
  useRef,
  useState,
} from 'react'
import { Button } from './../../../../../components/ui/primitives/button'
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from './../../../../../components/ui/primitives/dialog'
import { Switch } from './../../../../../components/ui/primitives/switch'
import { importSceneGraphToEditor, isSceneGraph } from './../../../../../lib/scene'
import useEditor from './../../../../../store/use-editor'
import { AudioSettingsDialog } from './audio-settings-dialog'
import { KeyboardShortcutsDialog } from './keyboard-shortcuts-dialog'

type SceneNode = Record<string, unknown> & {
  id?: unknown
  type?: unknown
  name?: unknown
  parentId?: unknown
  children?: unknown
}

type SceneGraphNode = {
  id: string
  type: string
  name: string | null
  parentId: string | null
  children: SceneGraphNode[]
  missing?: true
  cycle?: true
}

type SceneGraphValue = {
  roots: SceneGraphNode[]
  detachedNodes?: SceneGraphNode[]
}

const isSceneNode = (value: unknown): value is SceneNode => {
  return (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    typeof (value as { id: unknown }).id === 'string'
  )
}

const getChildIdsFromNode = (node: SceneNode): string[] => {
  if (!Array.isArray(node.children)) {
    return []
  }

  const childIds = new Set<string>()

  for (const child of node.children) {
    if (typeof child === 'string') {
      childIds.add(child)
      continue
    }

    if (isSceneNode(child)) {
      childIds.add(child.id as string)
    }
  }

  return Array.from(childIds)
}

const buildSceneGraphValue = (
  nodes: Record<string, SceneNode>,
  rootNodeIds: string[],
): SceneGraphValue => {
  const childIdsByParent = new Map<string, Set<string>>()

  for (const [id, node] of Object.entries(nodes)) {
    const childIds = getChildIdsFromNode(node)
    if (childIds.length > 0) {
      childIdsByParent.set(id, new Set(childIds))
    }
  }

  for (const [id, node] of Object.entries(nodes)) {
    if (typeof node.parentId !== 'string') {
      continue
    }

    const siblings = childIdsByParent.get(node.parentId) ?? new Set<string>()
    siblings.add(id)
    childIdsByParent.set(node.parentId, siblings)
  }

  const visited = new Set<string>()

  const buildNode = (id: string, path: Set<string>): SceneGraphNode => {
    const node = nodes[id]
    if (!node) {
      return {
        id,
        type: 'missing',
        name: null,
        parentId: null,
        missing: true,
        children: [],
      }
    }

    const nodeType = typeof node.type === 'string' ? node.type : 'unknown'
    const nodeName = typeof node.name === 'string' ? node.name : null
    const parentId = typeof node.parentId === 'string' ? node.parentId : null

    if (path.has(id)) {
      return {
        id,
        type: nodeType,
        name: nodeName,
        parentId,
        cycle: true,
        children: [],
      }
    }

    visited.add(id)
    const nextPath = new Set(path)
    nextPath.add(id)

    const childIds = Array.from(childIdsByParent.get(id) ?? [])
    return {
      id,
      type: nodeType,
      name: nodeName,
      parentId,
      children: childIds.map((childId) => buildNode(childId, nextPath)),
    }
  }

  const roots = rootNodeIds.map((id) => buildNode(id, new Set()))
  const detachedNodeIds = Object.keys(nodes).filter((id) => !visited.has(id))

  if (detachedNodeIds.length === 0) {
    return { roots }
  }

  return {
    roots,
    detachedNodes: detachedNodeIds.map((id) => buildNode(id, new Set())),
  }
}

export interface ProjectVisibility {
  isPrivate: boolean
  showScansPublic: boolean
  showGuidesPublic: boolean
}

export interface SettingsPanelProps {
  projectId?: string
  projectVisibility?: ProjectVisibility
  onVisibilityChange?: (
    field: 'isPrivate' | 'showScansPublic' | 'showGuidesPublic',
    value: boolean,
  ) => Promise<void>
}

export function SettingsPanel({
  projectId,
  projectVisibility,
  onVisibilityChange,
}: SettingsPanelProps = {}) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const nodes = useScene((state) => state.nodes)
  const rootNodeIds = useScene((state) => state.rootNodeIds)
  const setScene = useScene((state) => state.setScene)
  const clearScene = useScene((state) => state.clearScene)
  const resetSelection = useViewer((state) => state.resetSelection)
  const exportScene = useViewer((state) => state.exportScene)
  const setPhase = useEditor((state) => state.setPhase)
  const enablePreviewTrackpadControls = useEditor((state) => state.enablePreviewTrackpadControls)
  const setEnablePreviewTrackpadControls = useEditor(
    (state) => state.setEnablePreviewTrackpadControls,
  )
  const showPreviewCameraHints = useEditor((state) => state.showPreviewCameraHints)
  const setShowPreviewCameraHints = useEditor((state) => state.setShowPreviewCameraHints)
  const showFloatingUi = useEditor((state) => state.showFloatingUi)
  const showSidebarUi = useEditor((state) => state.showSidebarUi)
  const showInspectorPanels = useEditor((state) => state.showInspectorPanels)
  const setCompactMode = useEditor((state) => state.setCompactMode)
  const uiStartupPreset = useEditor((state) => state.uiStartupPreset)
  const setUiStartupPreset = useEditor((state) => state.setUiStartupPreset)
  const [isGeneratingThumbnail, setIsGeneratingThumbnail] = useState(false)
  const isCompactMode = !showFloatingUi && !showSidebarUi && !showInspectorPanels
  const sceneGraphValue = useMemo(
    () => buildSceneGraphValue(nodes as Record<string, SceneNode>, rootNodeIds),
    [nodes, rootNodeIds],
  )
  const blockSceneGraphMutations = useCallback((event: SyntheticEvent) => {
    event.preventDefault()
    event.stopPropagation()
  }, [])
  const blockSceneGraphDeletion = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault()
      event.stopPropagation()
    }
  }, [])

  const isLocalProject = false // Props-based; only show cloud sections when projectId provided

  const handleExport = async () => {
    if (exportScene) {
      await exportScene()
    }
  }

  const handleSaveBuild = () => {
    const sceneData = { nodes, rootNodeIds }
    const json = JSON.stringify(sceneData, null, 2)
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    const date = new Date().toISOString().split('T')[0]
    link.download = `layout_${date}.json`
    link.click()
    URL.revokeObjectURL(url)
  }

  const handleFileLoad = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (event) => {
      try {
        const data = JSON.parse(event.target?.result as string)
        if (isSceneGraph(data)) {
          importSceneGraphToEditor(data)
        } else {
          throw new Error('Scene graph JSON ではありません')
        }
      } catch (err) {
        console.error('Failed to load build:', err)
      }
    }
    reader.readAsText(file)

    // Reset input so the same file can be loaded again
    e.target.value = ''
  }

  const handleResetToDefault = () => {
    clearScene()
    resetSelection()
    setPhase('site')
  }

  const handleGenerateThumbnail = () => {
    if (!projectId) return
    setIsGeneratingThumbnail(true)
    emitter.emit('camera-controls:generate-thumbnail', { projectId })
    setTimeout(() => setIsGeneratingThumbnail(false), 3000)
  }

  const handleVisibilityChange = async (
    field: 'isPrivate' | 'showScansPublic' | 'showGuidesPublic',
    value: boolean,
  ) => {
    await onVisibilityChange?.(field, value)
  }

  return (
    <div className="flex flex-col gap-6 p-3">
      {/* Visibility Section (only for cloud projects) */}
      {projectId && !isLocalProject && (
        <div className="space-y-3">
          <label className="font-medium text-muted-foreground text-xs uppercase">表示設定</label>
          <div className="flex items-center justify-between">
            <div>
              <div className="font-medium text-sm">公開</div>
              <div className="text-muted-foreground text-xs">
                {projectVisibility?.isPrivate ? '自分のみ' : '全員が'}閲覧できます
              </div>
            </div>
            <Switch
              checked={!(projectVisibility?.isPrivate ?? false)}
              onCheckedChange={(checked) => handleVisibilityChange('isPrivate', !checked)}
            />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <div className="font-medium text-sm">3D スキャンを表示</div>
              <div className="text-muted-foreground text-xs">公開ビューアーで表示されます</div>
            </div>
            <Switch
              checked={projectVisibility?.showScansPublic ?? true}
              onCheckedChange={(checked) => handleVisibilityChange('showScansPublic', checked)}
            />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <div className="font-medium text-sm">図面を表示</div>
              <div className="text-muted-foreground text-xs">公開ビューアーで表示されます</div>
            </div>
            <Switch
              checked={projectVisibility?.showGuidesPublic ?? true}
              onCheckedChange={(checked) => handleVisibilityChange('showGuidesPublic', checked)}
            />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <div className="font-medium text-sm">グリッドを表示</div>
              <div className="text-muted-foreground text-xs">エディタでのみ表示されます</div>
            </div>
            <Switch
              checked={useViewer((state) => state.showGrid)}
              onCheckedChange={(checked) => useViewer.getState().setShowGrid(checked)}
            />
          </div>
        </div>
      )}

      {/* Export Section */}
      <div className="space-y-2">
        <label className="font-medium text-muted-foreground text-xs uppercase">エクスポート</label>
        <Button className="w-full justify-start gap-2" onClick={handleExport} variant="outline">
          <Download className="size-4" />
          3D モデルを書き出す
        </Button>
      </div>

      {/* Thumbnail Section (only for cloud projects) */}
      {projectId && !isLocalProject && (
        <div className="space-y-2">
          <label className="font-medium text-muted-foreground text-xs uppercase">サムネイル</label>
          <Button
            className="w-full justify-start gap-2"
            disabled={isGeneratingThumbnail}
            onClick={handleGenerateThumbnail}
            variant="outline"
          >
            <Camera className="size-4" />
            {isGeneratingThumbnail ? '生成中...' : 'サムネイルを生成'}
          </Button>
        </div>
      )}

      {/* Save/Load Section */}
      <div className="space-y-2">
        <label className="font-medium text-muted-foreground text-xs uppercase">保存と読み込み</label>

        <Button className="w-full justify-start gap-2" onClick={handleSaveBuild} variant="outline">
          <Save className="size-4" />
          レイアウトを保存
        </Button>

        <Button
          className="w-full justify-start gap-2"
          onClick={() => fileInputRef.current?.click()}
          variant="outline"
        >
          <Upload className="size-4" />
          レイアウトを読み込む
        </Button>

        <input
          accept="application/json"
          className="hidden"
          onChange={handleFileLoad}
          ref={fileInputRef}
          type="file"
        />
      </div>

      {/* Audio Section */}
      <div className="space-y-3">
        <label className="font-medium text-muted-foreground text-xs uppercase">エディタ</label>
        <div className="flex items-center justify-between">
          <div>
            <div className="font-medium text-sm">トラックパッドモード</div>
            <div className="text-muted-foreground text-xs">
              プレビュー中はスクロールでズームし、Shift で移動、Alt/Option で回転できます。
            </div>
          </div>
          <Switch
            checked={enablePreviewTrackpadControls}
            onCheckedChange={setEnablePreviewTrackpadControls}
          />
        </div>
        <div className="flex items-center justify-between">
          <div>
            <div className="font-medium text-sm">プレビュー操作ヒントを表示</div>
            <div className="text-muted-foreground text-xs">
              プレビュー中に閉じられる操作ガイドを表示します。
            </div>
          </div>
          <Switch checked={showPreviewCameraHints} onCheckedChange={setShowPreviewCameraHints} />
        </div>
        <div className="space-y-2 rounded-xl border border-border/50 bg-accent/10 p-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="font-medium text-sm">Compact Mode</div>
              <div className="text-muted-foreground text-xs">
                サイドバー、インスペクターパネル、フローティング UI をまとめて切り替えます。
              </div>
            </div>
            <Switch checked={isCompactMode} onCheckedChange={setCompactMode} />
          </div>
          <div className="text-muted-foreground text-xs">
            非表示時も Command Palette や Cmd/Ctrl+Shift+B、Cmd/Ctrl+Shift+P で復帰できます。
          </div>
        </div>
        <div className="space-y-2">
          <div>
            <div className="font-medium text-sm">起動時 UI プリセット</div>
            <div className="text-muted-foreground text-xs">
              次回起動時の初期 UI を選びます。選択内容は今この場でも適用されます。
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Button
              className="w-full"
              onClick={() => setUiStartupPreset('default')}
              variant={uiStartupPreset === 'default' ? 'default' : 'outline'}
            >
              Default UI
            </Button>
            <Button
              className="w-full"
              onClick={() => setUiStartupPreset('minimal')}
              variant={uiStartupPreset === 'minimal' ? 'default' : 'outline'}
            >
              Minimal UI
            </Button>
          </div>
        </div>
      </div>

      {/* Audio Section */}
      <div className="space-y-2">
        <label className="font-medium text-muted-foreground text-xs uppercase">音声</label>
        <AudioSettingsDialog />
      </div>

      {/* Keyboard Section */}
      <div className="space-y-2">
        <label className="font-medium text-muted-foreground text-xs uppercase">キーボード</label>
        <KeyboardShortcutsDialog />
      </div>

      {/* Scene Graph */}
      <div className="space-y-1">
        <label className="font-medium text-muted-foreground text-xs uppercase">シーングラフ</label>
        <Dialog>
          <DialogTrigger asChild>
            <Button className="h-auto justify-start p-0 text-sm" variant="link">
              シーングラフを表示
            </Button>
          </DialogTrigger>
          <DialogContent className="h-[80vh] max-w-[95vw] gap-0 overflow-hidden border-0 bg-[#1e1e1e] p-0 shadow-none sm:max-w-5xl">
            <DialogTitle className="sr-only">シーングラフ</DialogTitle>
            <div
              className="flex h-full min-h-0 w-full min-w-0 *:h-full *:w-full *:overflow-y-auto"
              onContextMenuCapture={blockSceneGraphMutations}
              onDragStartCapture={blockSceneGraphMutations}
              onDropCapture={blockSceneGraphMutations}
              onKeyDownCapture={blockSceneGraphDeletion}
            >
              <VisualJson value={sceneGraphValue}>
                <TreeView showCounts />
              </VisualJson>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Danger Zone */}
      <div className="space-y-2">
        <label className="font-medium text-destructive text-xs uppercase">危険な操作</label>

        <Button
          className="w-full justify-start gap-2"
          onClick={handleResetToDefault}
          variant="destructive"
        >
          <Trash2 className="size-4" />
          クリアして新規開始
        </Button>
      </div>
    </div>
  )
}
