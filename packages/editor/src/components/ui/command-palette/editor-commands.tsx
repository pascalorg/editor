'use client'

import type { AnyNodeId } from '@pascal-app/core'
import { LevelNode, useScene } from '@pascal-app/core'
import useViewer from '@pascal-app/viewer/store'
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
  Package,
  PencilLine,
  Plus,
  Redo2,
  Square,
  SquareStack,
  Sun,
  Trash2,
  Undo2,
  Video,
} from 'lucide-react'
import { useEffect } from 'react'
import { t } from '../../../i18n'
import { runRedo, runUndo } from '../../../lib/history'
import { deleteLevelWithFallbackSelection } from '../../../lib/level-selection'
import { useCommandRegistry } from '../../../store/use-command-registry'
import type { StructureTool } from '../../../store/use-editor'
import useEditor from '../../../store/use-editor'
import { useCommandPalette } from './index'

function wallModeBadge(mode: string): string {
  const fallbacks: Record<string, string> = { cutaway: 'Cutaway', up: 'Up', down: 'Down' }
  return t(`command.badge.wallMode.${mode}`, fallbacks[mode] ?? mode)
}

function levelModeBadge(mode: string): string {
  const fallbacks: Record<string, string> = {
    manual: 'Manual',
    stacked: 'Stacked',
    exploded: 'Exploded',
    solo: 'Solo',
  }
  return t(`command.badge.levelMode.${mode}`, fallbacks[mode] ?? mode)
}

export function EditorCommands() {
  const register = useCommandRegistry((s) => s.register)
  const { navigateTo, setInputValue, setOpen } = useCommandPalette()

  const setPhase = useEditor((s) => s.setPhase)
  const setMode = useEditor((s) => s.setMode)
  const setTool = useEditor((s) => s.setTool)
  const setStructureLayer = useEditor((s) => s.setStructureLayer)
  const isPreviewMode = useEditor((s) => s.isPreviewMode)
  const setPreviewMode = useEditor((s) => s.setPreviewMode)

  const exportScene = useViewer((s) => s.exportScene)

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

    const groupScene = t('command.groups.scene', 'Scene')
    const groupLevels = t('command.groups.levels', 'Levels')
    const groupViewerControls = t('command.groups.viewerControls', 'Viewer Controls')
    const groupView = t('command.groups.view', 'View')
    const groupHistory = t('command.groups.history', 'History')
    const groupExportShare = t('command.groups.exportShare', 'Export & Share')

    return register([
      {
        id: 'editor.tool.wall',
        label: t('command.tools.wall', 'Wall Tool'),
        group: groupScene,
        icon: <Square className="h-4 w-4" />,
        keywords: ['draw', 'build', 'structure'],
        execute: () => activateTool('wall'),
      },
      {
        id: 'editor.tool.slab',
        label: t('command.tools.slab', 'Slab Tool'),
        group: groupScene,
        icon: <Layers className="h-4 w-4" />,
        keywords: ['floor', 'build'],
        execute: () => activateTool('slab'),
      },
      {
        id: 'editor.tool.ceiling',
        label: t('command.tools.ceiling', 'Ceiling Tool'),
        group: groupScene,
        icon: <Grid3X3 className="h-4 w-4" />,
        keywords: ['top', 'build'],
        execute: () => activateTool('ceiling'),
      },
      {
        id: 'editor.tool.door',
        label: t('command.tools.door', 'Door Tool'),
        group: groupScene,
        icon: <DoorOpen className="h-4 w-4" />,
        keywords: ['opening', 'entrance'],
        execute: () => activateTool('door'),
      },
      {
        id: 'editor.tool.window',
        label: t('command.tools.window', 'Window Tool'),
        group: groupScene,
        icon: <AppWindow className="h-4 w-4" />,
        keywords: ['opening', 'glass'],
        execute: () => activateTool('window'),
      },
      {
        id: 'editor.tool.item',
        label: t('command.tools.item', 'Item Tool'),
        group: groupScene,
        icon: <Package className="h-4 w-4" />,
        keywords: ['furniture', 'object', 'asset', 'furnish'],
        execute: () => activateTool('item'),
      },
      {
        id: 'editor.tool.stair',
        label: t('command.tools.stair', 'Stair Tool'),
        group: groupScene,
        icon: <ArrowRight className="h-4 w-4" />,
        keywords: ['stairs', 'staircase', 'flight', 'landing', 'steps'],
        execute: () => activateTool('stair'),
      },
      {
        id: 'editor.tool.zone',
        label: t('command.tools.zone', 'Zone Tool'),
        group: groupScene,
        icon: <Hexagon className="h-4 w-4" />,
        keywords: ['area', 'room', 'space'],
        execute: () => activateTool('zone'),
      },
      {
        id: 'editor.tool.cable-tray',
        label: t('command.tools.cableTray', 'Cable Tray Tool'),
        group: groupScene,
        icon: <SquareStack className="h-4 w-4" />,
        keywords: ['industrial', 'factory', 'cable', 'tray', 'conduit'],
        execute: () => {
          run(() => {
            setPhase('structure')
            setMode('build')
            setStructureLayer('industrial')
            setTool('cable-tray')
          })
        },
      },
      {
        id: 'editor.tool.ladder',
        label: t('command.tools.ladder', 'Ladder Tool'),
        group: groupScene,
        icon: <ArrowRight className="h-4 w-4" />,
        keywords: ['industrial', 'factory', 'ladder', 'climb'],
        execute: () => {
          run(() => {
            setPhase('structure')
            setMode('build')
            setStructureLayer('elements')
            setTool('ladder')
          })
        },
      },
      {
        id: 'editor.tool.steel-beam',
        label: t('command.tools.steelBeam', 'Steel Beam Tool'),
        group: groupScene,
        icon: <Building2 className="h-4 w-4" />,
        keywords: ['industrial', 'factory', 'beam', 'steel', 'column'],
        execute: () => {
          run(() => {
            setPhase('structure')
            setMode('build')
            setStructureLayer('industrial')
            setTool('steel-beam')
          })
        },
      },
      {
        id: 'editor.delete-selection',
        label: t('command.tools.deleteSelection', 'Delete Selection'),
        group: groupScene,
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
        id: 'editor.level.goto',
        label: t('command.levels.goto', 'Go to Level'),
        group: groupLevels,
        icon: <ArrowRight className="h-4 w-4" />,
        keywords: ['level', 'floor', 'go', 'navigate', 'switch', 'select'],
        navigate: true,
        when: () => Object.values(useScene.getState().nodes).some((n) => n.type === 'level'),
        execute: () => navigateTo('goto-level'),
      },
      {
        id: 'editor.level.add',
        label: t('command.levels.add', 'Add Level'),
        group: groupLevels,
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
              children: [],
              parentId: building.id,
            })
            useScene.getState().createNode(newLevel, building.id)
            useViewer.getState().setSelection({ levelId: newLevel.id })
          }),
      },
      {
        id: 'editor.level.rename',
        label: t('command.levels.rename', 'Rename Level'),
        group: groupLevels,
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
        label: t('command.levels.delete', 'Delete Level'),
        group: groupLevels,
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

      {
        id: 'editor.viewer.wall-mode',
        label: t('command.viewer.wallMode', 'Wall Mode'),
        group: groupViewerControls,
        icon: <Layers className="h-4 w-4" />,
        keywords: ['wall', 'cutaway', 'up', 'down', 'view'],
        badge: () => wallModeBadge(useViewer.getState().wallMode),
        navigate: true,
        execute: () => navigateTo('wall-mode'),
      },
      {
        id: 'editor.viewer.level-mode',
        label: t('command.viewer.levelMode', 'Level Mode'),
        group: groupViewerControls,
        icon: <SquareStack className="h-4 w-4" />,
        keywords: ['level', 'floor', 'exploded', 'stacked', 'solo'],
        badge: () => levelModeBadge(useViewer.getState().levelMode),
        navigate: true,
        execute: () => navigateTo('level-mode'),
      },
      {
        id: 'editor.viewer.camera-mode',
        label: () => {
          const mode = useViewer.getState().cameraMode
          const targetMode =
            mode === 'perspective'
              ? t('command.cameraMode.orthographic', 'Orthographic')
              : t('command.cameraMode.perspective', 'Perspective')
          return t('command.viewer.cameraSwitch', {
            fallback: 'Camera: Switch to {mode}',
            params: { mode: targetMode },
          })
        },
        group: groupViewerControls,
        icon: <Video className="h-4 w-4" />,
        keywords: ['camera', 'ortho', 'perspective', '2d', '3d', 'view'],
        execute: () =>
          run(() => {
            const { cameraMode, setCameraMode } = useViewer.getState()
            setCameraMode(cameraMode === 'perspective' ? 'orthographic' : 'perspective')
          }),
      },
      {
        id: 'editor.viewer.theme',
        label: () => {
          const theme = useViewer.getState().theme
          return theme === 'dark'
            ? t('command.viewer.themeSwitchLight', 'Switch to Light Theme')
            : t('command.viewer.themeSwitchDark', 'Switch to Dark Theme')
        },
        group: groupViewerControls,
        icon: <Sun className="h-4 w-4" />,
        keywords: ['theme', 'dark', 'light', 'appearance', 'color'],
        execute: () =>
          run(() => {
            const { theme, setTheme } = useViewer.getState()
            setTheme(theme === 'dark' ? 'light' : 'dark')
          }),
      },
      {
        id: 'editor.viewer.camera-snapshot',
        label: t('command.viewer.takeSnapshot', 'Take Snapshot'),
        group: groupViewerControls,
        icon: <Camera className="h-4 w-4" />,
        keywords: ['camera', 'snapshot', 'capture', 'save', 'view', 'bookmark'],
        execute: () => {
          setOpen(false)
          useEditor.getState().setCaptureMode(true)
        },
      },

      {
        id: 'editor.view.preview',
        label: () =>
          isPreviewMode
            ? t('command.view.exitPreview', 'Exit Preview')
            : t('command.view.enterPreview', 'Enter Preview'),
        group: groupView,
        icon: isPreviewMode ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />,
        keywords: ['preview', 'view', 'read-only', 'present'],
        execute: () => run(() => setPreviewMode(!isPreviewMode)),
      },
      {
        id: 'editor.view.fullscreen',
        label: t('command.view.toggleFullscreen', 'Toggle Fullscreen'),
        group: groupView,
        icon: <Maximize2 className="h-4 w-4" />,
        keywords: ['fullscreen', 'maximize', 'expand', 'window'],
        execute: () =>
          run(() => {
            if (document.fullscreenElement) document.exitFullscreen()
            else document.documentElement.requestFullscreen()
          }),
      },

      {
        id: 'editor.history.undo',
        label: t('command.history.undo', 'Undo'),
        group: groupHistory,
        icon: <Undo2 className="h-4 w-4" />,
        keywords: ['undo', 'revert', 'back'],
        execute: () => run(() => runUndo()),
      },
      {
        id: 'editor.history.redo',
        label: t('command.history.redo', 'Redo'),
        group: groupHistory,
        icon: <Redo2 className="h-4 w-4" />,
        keywords: ['redo', 'forward', 'repeat'],
        execute: () => run(() => runRedo()),
      },

      {
        id: 'editor.export.json',
        label: t('command.export.json', 'Export Scene (JSON)'),
        group: groupExportShare,
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
              label: t('command.export.glb', 'Export 3D Model (GLB)'),
              group: groupExportShare,
              icon: <Box className="h-4 w-4" />,
              keywords: ['export', 'glb', 'gltf', '3d', 'model', 'download'],
              execute: () => run(() => exportScene()),
            },
          ]
        : []),
      {
        id: 'editor.export.share-link',
        label: t('command.export.shareLink', 'Copy Share Link'),
        group: groupExportShare,
        icon: <Copy className="h-4 w-4" />,
        keywords: ['share', 'copy', 'url', 'link'],
        execute: () => run(() => navigator.clipboard.writeText(window.location.href)),
      },
      {
        id: 'editor.export.screenshot',
        label: t('command.export.screenshot', 'Take Screenshot'),
        group: groupExportShare,
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
  ])

  return null
}
