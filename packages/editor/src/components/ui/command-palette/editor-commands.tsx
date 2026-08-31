'use client'

import type { AnyNodeId } from '@pascal-app/core'
import { DEFAULT_LEVEL_HEIGHT, LevelNode, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import {
  AppWindow,
  ArrowRight,
  Box,
  Building2,
  Camera,
  Copy,
  DoorOpen,
  Eye,
  EyeOff,
  FileJson,
  Grid3X3,
  Hexagon,
  Layers,
  Map,
  Maximize2,
  Minimize2,
  Moon,
  MousePointer2,
  Mountain,
  Package,
  PaintBucket,
  PencilLine,
  Plus,
  Redo2,
  Sparkles,
  Square,
  SquareStack,
  Sun,
  Trash2,
  Undo2,
  Video,
} from 'lucide-react'
import { useEffect } from 'react'
import { getHistoryCommandState, runRedo, runUndo } from '../../../lib/history'
import { deleteLevelWithFallbackSelection } from '../../../lib/level-selection'
import { useTranslations } from '../../../lib/i18n'
import { useCommandRegistry } from '../../../store/use-command-registry'
import type { StructureTool } from '../../../store/use-editor'
import useEditor from '../../../store/use-editor'
import { useCommandPalette } from './index'

export function EditorCommands() {
  const t = useTranslations()
  const register = useCommandRegistry((s) => s.register)
  const { navigateTo, setInputValue, setOpen } = useCommandPalette()

  const setPhase = useEditor((s) => s.setPhase)
  const setMode = useEditor((s) => s.setMode)
  const setTool = useEditor((s) => s.setTool)
  const setStructureLayer = useEditor((s) => s.setStructureLayer)
  const primeMaterialPaintFromSelection = useEditor((s) => s.primeMaterialPaintFromSelection)
  const isPreviewMode = useEditor((s) => s.isPreviewMode)
  const setPreviewMode = useEditor((s) => s.setPreviewMode)

  const exportScene = useViewer((s) => s.exportScene)

  // Re-register when exportScene availability changes (it's a conditional action)
  useEffect(() => {
    const run = (fn: () => void) => {
      fn()
      setOpen(false)
    }

    const activateTool = (tool: StructureTool) => {
      run(() => {
        setPhase('structure')
        setMode('build')
        if (tool === 'zone') setStructureLayer('zones')
        setTool(tool)
      })
    }

    return register([
      // ── Scene ────────────────────────────────────────────────────────────
      {
        id: 'editor.tool.wall',
        label: t('commands.wallTool'),
        group: t('commands.groupScene'),
        icon: <Square className="h-4 w-4" />,
        keywords: ['draw', 'build', 'structure'],
        execute: () => activateTool('wall'),
      },
      {
        id: 'editor.tool.slab',
        label: t('commands.slabTool'),
        group: t('commands.groupScene'),
        icon: <Layers className="h-4 w-4" />,
        keywords: ['floor', 'build'],
        execute: () => activateTool('slab'),
      },
      {
        id: 'editor.tool.ceiling',
        label: t('commands.ceilingTool'),
        group: t('commands.groupScene'),
        icon: <Grid3X3 className="h-4 w-4" />,
        keywords: ['top', 'build'],
        execute: () => activateTool('ceiling'),
      },
      {
        id: 'editor.tool.door',
        label: t('commands.doorTool'),
        group: t('commands.groupScene'),
        icon: <DoorOpen className="h-4 w-4" />,
        keywords: ['opening', 'entrance'],
        execute: () => activateTool('door'),
      },
      {
        id: 'editor.tool.window',
        label: t('commands.windowTool'),
        group: t('commands.groupScene'),
        icon: <AppWindow className="h-4 w-4" />,
        keywords: ['opening', 'glass'],
        execute: () => activateTool('window'),
      },
      {
        id: 'editor.tool.item',
        label: t('commands.itemTool'),
        group: t('commands.groupScene'),
        icon: <Package className="h-4 w-4" />,
        keywords: ['furniture', 'object', 'asset', 'furnish'],
        execute: () => activateTool('item'),
      },
      {
        id: 'editor.tool.stair',
        label: t('commands.stairTool'),
        group: t('commands.groupScene'),
        icon: <ArrowRight className="h-4 w-4" />,
        keywords: ['stairs', 'staircase', 'flight', 'landing', 'steps'],
        execute: () => activateTool('stair'),
      },
      {
        id: 'editor.tool.zone',
        label: t('commands.zoneTool'),
        group: t('commands.groupScene'),
        icon: <Hexagon className="h-4 w-4" />,
        keywords: ['area', 'room', 'space'],
        execute: () => activateTool('zone'),
      },
      {
        id: 'editor.delete-selection',
        label: t('commands.deleteSelection'),
        group: t('commands.groupScene'),
        icon: <Trash2 className="h-4 w-4" />,
        keywords: ['remove', 'erase'],
        shortcut: ['⌫'],
        when: () => useViewer.getState().selection.selectedIds.length > 0,
        execute: () =>
          run(() => {
            const { selectedIds } = useViewer.getState().selection
            useScene.getState().deleteNodes(selectedIds as any[])
          }),
      },
      {
        id: 'editor.mode.material-paint',
        label: t('commands.materialPaint'),
        group: t('commands.groupScene'),
        icon: <PaintBucket className="h-4 w-4" />,
        keywords: ['paint', 'material', 'texture', 'bucket', 'surface'],
        shortcut: ['P'],
        execute: () =>
          run(() => {
            primeMaterialPaintFromSelection()
            setPhase('structure')
            setStructureLayer('elements')
            setMode('material-paint')
          }),
      },
      {
        id: 'editor.mode.terrain-sculpt',
        label: t('commands.sculptTerrain'),
        group: t('commands.groupScene'),
        icon: <Mountain className="h-4 w-4" />,
        keywords: ['terrain', 'ground', 'elevation', 'sculpt', 'hill', 'slope', 'grade', 'dig'],
        shortcut: ['G'],
        // No `setPhase`: `setMode` moves to the site phase itself, and doing it
        // here would set the phase twice with a mode reset in between.
        execute: () => run(() => setMode('terrain-sculpt')),
      },

      // ── Levels ───────────────────────────────────────────────────────────
      {
        id: 'editor.level.goto',
        label: t('commands.gotoLevel'),
        group: t('commands.groupLevels'),
        icon: <ArrowRight className="h-4 w-4" />,
        keywords: ['level', 'floor', 'go', 'navigate', 'switch', 'select'],
        navigate: true,
        when: () => Object.values(useScene.getState().nodes).some((n) => n.type === 'level'),
        execute: () => navigateTo('goto-level'),
      },
      {
        id: 'editor.level.add',
        label: t('commands.addLevel'),
        group: t('commands.groupLevels'),
        icon: <Plus className="h-4 w-4" />,
        keywords: ['level', 'floor', 'add', 'create', 'new'],
        execute: () =>
          run(() => {
            const { nodes } = useScene.getState()
            const building = Object.values(nodes).find((n) => n.type === 'building')
            if (!building) return
            const levelCount = building.children.filter(
              (childId) => nodes[childId as keyof typeof nodes]?.type === 'level',
            ).length
            const newLevel = LevelNode.parse({
              level: levelCount,
              height: DEFAULT_LEVEL_HEIGHT,
              children: [],
              parentId: building.id,
            })
            useScene.getState().createNode(newLevel, building.id)
            useViewer.getState().setSelection({ levelId: newLevel.id })
          }),
      },
      {
        id: 'editor.level.rename',
        label: t('commands.renameLevel'),
        group: t('commands.groupLevels'),
        icon: <PencilLine className="h-4 w-4" />,
        keywords: ['level', 'floor', 'rename', 'name'],
        navigate: true,
        when: () => !!useViewer.getState().selection.levelId,
        execute: () => {
          const activeLevelId = useViewer.getState().selection.levelId
          if (!activeLevelId) return
          const level = useScene.getState().nodes[activeLevelId as AnyNodeId] as LevelNode
          setInputValue(level?.name ?? '')
          navigateTo('rename-level')
        },
      },
      {
        id: 'editor.level.delete',
        label: t('commands.deleteLevel'),
        group: t('commands.groupLevels'),
        icon: <Trash2 className="h-4 w-4" />,
        keywords: ['level', 'floor', 'delete', 'remove'],
        when: () => {
          const levelId = useViewer.getState().selection.levelId
          if (!levelId) return false
          const node = useScene.getState().nodes[levelId as AnyNodeId] as LevelNode
          return node?.type === 'level' && node.level !== 0
        },
        execute: () =>
          run(() => {
            const activeLevelId = useViewer.getState().selection.levelId
            if (!activeLevelId) return
            deleteLevelWithFallbackSelection(activeLevelId as AnyNodeId)
          }),
      },

      // ── Viewer Controls ──────────────────────────────────────────────────
      {
        id: 'editor.viewer.wall-mode',
        label: t('commands.wallMode'),
        group: t('commands.groupViewerControls'),
        icon: <Layers className="h-4 w-4" />,
        keywords: ['wall', 'cutaway', 'up', 'down', 'translucent', 'view'],
        badge: () => {
          const mode = useViewer.getState().wallMode
          const labelKey =
            mode === 'cutaway'
              ? 'commands.cutaway'
              : mode === 'up'
                ? 'commands.up'
                : mode === 'down'
                  ? 'commands.down'
                  : 'commands.translucent'
          return t(labelKey)
        },
        navigate: true,
        execute: () => navigateTo('wall-mode'),
      },
      {
        id: 'editor.viewer.level-mode',
        label: t('commands.levelMode'),
        group: t('commands.groupViewerControls'),
        icon: <SquareStack className="h-4 w-4" />,
        keywords: ['level', 'floor', 'exploded', 'stacked', 'solo'],
        badge: () => {
          const mode = useViewer.getState().levelMode
          const labelKey =
            mode === 'manual'
              ? 'commands.manual'
              : mode === 'stacked'
                ? 'commands.stacked'
                : mode === 'exploded'
                  ? 'commands.exploded'
                  : 'commands.solo'
          return t(labelKey)
        },
        navigate: true,
        execute: () => navigateTo('level-mode'),
      },
      {
        id: 'editor.viewer.camera-mode',
        label: () => {
          const mode = useViewer.getState().cameraMode
          const next = mode === 'perspective' ? t('commands.orthographic') : t('commands.perspective')
          return t('commands.cameraSwitchTo', { mode: next })
        },
        group: t('commands.groupViewerControls'),
        icon: <Video className="h-4 w-4" />,
        keywords: ['camera', 'ortho', 'perspective', '2d', '3d', 'view'],
        execute: () =>
          run(() => {
            const { cameraMode, setCameraMode } = useViewer.getState()
            setCameraMode(cameraMode === 'perspective' ? 'orthographic' : 'perspective')
          }),
      },
      {
        id: 'editor.viewer.shading-solid',
        label: t('commands.switchToSolid'),
        group: t('commands.groupViewerControls'),
        icon: <Box className="h-4 w-4" />,
        keywords: ['solid', 'shading', 'render', 'mode', 'performance'],
        execute: () => run(() => useViewer.getState().setShading('solid')),
      },
      {
        id: 'editor.viewer.shading-rendered',
        label: t('commands.switchToRendered'),
        group: t('commands.groupViewerControls'),
        icon: <Sparkles className="h-4 w-4" />,
        keywords: ['rendered', 'shading', 'render', 'mode', 'quality'],
        execute: () => run(() => useViewer.getState().setShading('rendered')),
      },
      {
        id: 'editor.viewer.camera-snapshot',
        label: t('commands.takeSnapshot'),
        group: t('commands.groupViewerControls'),
        icon: <Camera className="h-4 w-4" />,
        keywords: ['camera', 'snapshot', 'capture', 'save', 'view', 'bookmark'],
        execute: () => {
          setOpen(false)
          useEditor.getState().setCaptureMode(true)
        },
      },

      // ── View ─────────────────────────────────────────────────────────────
      {
        id: 'editor.view.preview',
        label: () => (isPreviewMode ? t('commands.exitPreview') : t('commands.enterPreview')),
        group: t('commands.groupView'),
        icon: isPreviewMode ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />,
        keywords: ['preview', 'view', 'read-only', 'present'],
        execute: () => run(() => setPreviewMode(!isPreviewMode)),
      },
      {
        id: 'editor.view.fullscreen',
        label: t('commands.toggleFullscreen'),
        group: t('commands.groupView'),
        icon: <Maximize2 className="h-4 w-4" />,
        keywords: ['fullscreen', 'maximize', 'expand', 'window'],
        execute: () =>
          run(() => {
            if (document.fullscreenElement) document.exitFullscreen()
            else document.documentElement.requestFullscreen()
          }),
      },

      // ── History ──────────────────────────────────────────────────────────
      {
        id: 'editor.history.undo',
        label: t('commands.undo'),
        group: t('commands.groupHistory'),
        icon: <Undo2 className="h-4 w-4" />,
        keywords: ['undo', 'revert', 'back'],
        when: () => getHistoryCommandState().canUndo,
        execute: () => run(() => runUndo()),
      },
      {
        id: 'editor.history.redo',
        label: t('commands.redo'),
        group: t('commands.groupHistory'),
        icon: <Redo2 className="h-4 w-4" />,
        keywords: ['redo', 'forward', 'repeat'],
        when: () => getHistoryCommandState().canRedo,
        execute: () => run(() => runRedo()),
      },

      // ── Export & Share ───────────────────────────────────────────────────
      {
        id: 'editor.export.json',
        label: t('commands.exportSceneJson'),
        group: t('commands.groupExportShare'),
        icon: <FileJson className="h-4 w-4" />,
        keywords: ['export', 'download', 'json', 'save', 'data'],
        execute: () =>
          run(() => {
            const { nodes, rootNodeIds } = useScene.getState()
            const blob = new Blob([JSON.stringify({ nodes, rootNodeIds }, null, 2)], {
              type: 'application/json',
            })
            const url = URL.createObjectURL(blob)
            Object.assign(document.createElement('a'), {
              href: url,
              download: `scene_${new Date().toISOString().split('T')[0]}.json`,
            }).click()
            URL.revokeObjectURL(url)
          }),
      },
      ...(exportScene
        ? [
            {
              id: 'editor.export.glb',
              label: t('commands.export3DModel'),
              group: t('commands.groupExportShare'),
              icon: <Box className="h-4 w-4" />,
              keywords: ['export', 'glb', 'gltf', '3d', 'model', 'download'],
              execute: () => run(() => exportScene()),
            },
          ]
        : []),
      {
        id: 'editor.export.share-link',
        label: t('commands.copyShareLink'),
        group: t('commands.groupExportShare'),
        icon: <Copy className="h-4 w-4" />,
        keywords: ['share', 'copy', 'url', 'link'],
        execute: () => run(() => navigator.clipboard.writeText(window.location.href)),
      },
      {
        id: 'editor.export.screenshot',
        label: t('commands.takeScreenshot'),
        group: t('commands.groupExportShare'),
        icon: <Camera className="h-4 w-4" />,
        keywords: ['screenshot', 'capture', 'image', 'photo', 'png'],
        execute: () =>
          run(() => {
            const canvas = document.querySelector('canvas')
            if (!canvas) return
            Object.assign(document.createElement('a'), {
              href: canvas.toDataURL('image/png'),
              download: `screenshot_${new Date().toISOString().split('T')[0]}.png`,
            }).click()
          }),
      },
    ])
  }, [
    register,
    navigateTo,
    setInputValue,
    setOpen,
    setPhase,
    setMode,
    setTool,
    setStructureLayer,
    isPreviewMode,
    setPreviewMode,
    exportScene,
    t,
  ])

  return null
}
