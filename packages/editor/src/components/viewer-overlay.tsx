'use client'

import {
  type AnyNode,
  type AnyNodeId,
  type BuildingNode,
  emitter,
  type LevelNode,
  useScene,
  type ZoneNode,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import {
  ArrowLeft,
  Camera,
  ChevronRight,
  Diamond,
  Layers,
  Layers2,
  Moon,
  Sun,
  X,
} from 'lucide-react'
import { motion } from 'motion/react'
import Link from 'next/link'
import { cn } from '../lib/utils'
import useEditor from '../store/use-editor'
import { ActionButton } from './ui/action-menu/action-button'
import { TooltipProvider } from './ui/primitives/tooltip'

type ProjectOwner = {
  id: string
  name: string
  username: string | null
  image: string | null
}

const levelModeLabels: Record<'stacked' | 'exploded' | 'solo', string> = {
  stacked: '積層',
  exploded: '分解',
  solo: '単独',
}

const wallModeConfig = {
  up: {
    icon: (props: any) => (
      <img alt="フルハイト" height={28} src="/icons/room.png" width={28} {...props} />
    ),
    label: 'フルハイト',
  },
  cutaway: {
    icon: (props: any) => (
      <img alt="カットアウェイ" height={28} src="/icons/wallcut.png" width={28} {...props} />
    ),
    label: 'カットアウェイ',
  },
  down: {
    icon: (props: any) => (
      <img alt="ロー" height={28} src="/icons/walllow.png" width={28} {...props} />
    ),
    label: 'ロー',
  },
}

const getNodeName = (node: AnyNode): string => {
  if ('name' in node && node.name) return node.name
  if (node.type === 'wall') return '壁'
  if (node.type === 'item') return (node as { asset: { name: string } }).asset?.name || 'アイテム'
  if (node.type === 'slab') return '床'
  if (node.type === 'ceiling') return '天井'
  if (node.type === 'roof') return '屋根'
  return node.type
}

interface ViewerOverlayProps {
  projectName?: string | null
  owner?: ProjectOwner | null
  canShowScans?: boolean
  canShowGuides?: boolean
  onBack?: () => void
}

export const ViewerOverlay = ({
  projectName,
  owner,
  canShowScans = true,
  canShowGuides = true,
  onBack,
}: ViewerOverlayProps) => {
  const selection = useViewer((s) => s.selection)
  const nodes = useScene((s) => s.nodes)
  const showScans = useViewer((s) => s.showScans)
  const showGuides = useViewer((s) => s.showGuides)
  const cameraMode = useViewer((s) => s.cameraMode)
  const levelMode = useViewer((s) => s.levelMode)
  const wallMode = useViewer((s) => s.wallMode)
  const theme = useViewer((s) => s.theme)
  const enablePreviewTrackpadControls = useEditor((s) => s.enablePreviewTrackpadControls)
  const showPreviewCameraHints = useEditor((s) => s.showPreviewCameraHints)
  const setShowPreviewCameraHints = useEditor((s) => s.setShowPreviewCameraHints)

  const building = selection.buildingId
    ? (nodes[selection.buildingId] as BuildingNode | undefined)
    : null
  const level = selection.levelId ? (nodes[selection.levelId] as LevelNode | undefined) : null
  const zone = selection.zoneId ? (nodes[selection.zoneId] as ZoneNode | undefined) : null

  // Get the first selected item (if any)
  const selectedNode =
    selection.selectedIds.length > 0
      ? (nodes[selection.selectedIds[0] as AnyNodeId] as AnyNode | undefined)
      : null

  // Get all levels for the selected building
  const levels =
    building?.children
      .map((id) => nodes[id as AnyNodeId] as LevelNode | undefined)
      .filter((n): n is LevelNode => n?.type === 'level')
      .sort((a, b) => a.level - b.level) ?? []

  const handleLevelClick = (levelId: LevelNode['id']) => {
    // When switching levels, deselect zone and items
    useViewer.getState().setSelection({ levelId })
  }

  const handleBreadcrumbClick = (depth: 'root' | 'building' | 'level' | 'zone') => {
    switch (depth) {
      case 'root':
        useViewer.getState().resetSelection()
        break
      case 'building':
        useViewer.getState().setSelection({ levelId: null })
        break
      case 'level':
        useViewer.getState().setSelection({ zoneId: null })
        break
    }
  }

  return (
    <>
      {/* Unified top-left card */}
      <div className="dark absolute top-4 left-4 z-20 flex flex-col gap-3 text-foreground">
        <div className="pointer-events-auto flex min-w-[200px] flex-col overflow-hidden rounded-2xl border border-border/40 bg-background/95 shadow-lg backdrop-blur-xl transition-colors duration-200 ease-out">
          {/* Project info + back */}
          <div className="flex items-center gap-3 px-3 py-2.5">
            {onBack ? (
              <button
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-white/10"
                onClick={onBack}
              >
                <ArrowLeft className="h-4 w-4 text-muted-foreground" />
              </button>
            ) : (
              <Link
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-white/10"
                href="/"
              >
                <ArrowLeft className="h-4 w-4 text-muted-foreground" />
              </Link>
            )}
            <div className="min-w-0">
              <div className="truncate font-medium text-foreground text-sm">
                {projectName || '無題'}
              </div>
              {owner?.username && (
                <Link
                  className="text-muted-foreground text-xs transition-colors hover:text-foreground"
                  href={`/u/${owner.username}`}
                >
                  @{owner.username}
                </Link>
              )}
            </div>
          </div>

          {/* Breadcrumb — only shown when navigated into a building */}
          {building && (
            <div className="border-border/40 border-t px-3 py-2">
              <div className="flex items-center gap-1.5 text-xs">
                <button
                  className="text-muted-foreground transition-colors hover:text-foreground"
                  onClick={() => handleBreadcrumbClick('root')}
                >
                  敷地
                </button>

                {building && (
                  <>
                    <ChevronRight className="h-3 w-3 text-muted-foreground/50" />
                    <button
                      className={`truncate transition-colors ${level ? 'text-muted-foreground hover:text-foreground' : 'font-medium text-foreground'}`}
                      onClick={() => handleBreadcrumbClick('building')}
                    >
                      {building.name || 'Building'}
                    </button>
                  </>
                )}

                {level && (
                  <>
                    <ChevronRight className="h-3 w-3 text-muted-foreground/50" />
                    <button
                      className={`truncate transition-colors ${zone ? 'text-muted-foreground hover:text-foreground' : 'font-medium text-foreground'}`}
                      onClick={() => handleBreadcrumbClick('level')}
                    >
                      {level.name || `レベル ${level.level}`}
                    </button>
                  </>
                )}

                {zone && (
                  <>
                    <ChevronRight className="h-3 w-3 text-muted-foreground/50" />
                    <span
                      className={`truncate transition-colors ${selectedNode ? 'text-muted-foreground' : 'font-medium text-foreground'}`}
                    >
                      {zone.name}
                    </span>
                  </>
                )}

                {selectedNode && zone && (
                  <>
                    <ChevronRight className="h-3 w-3 text-muted-foreground/50" />
                    <span className="truncate font-medium text-foreground">
                      {getNodeName(selectedNode)}
                    </span>
                  </>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Level List (only when building is selected) */}
        {building && levels.length > 0 && (
          <div className="pointer-events-auto flex w-48 flex-col overflow-hidden rounded-2xl border border-border/40 bg-background/95 py-1 shadow-lg backdrop-blur-xl transition-colors duration-200 ease-out">
            <span className="px-3 py-2 font-medium text-[10px] text-muted-foreground uppercase tracking-wider">
              レベル
            </span>
            <div className="flex flex-col">
              {levels.map((lvl) => {
                const isSelected = lvl.id === selection.levelId
                return (
                  <button
                    className={cn(
                      'group/row relative flex h-8 w-full cursor-pointer select-none items-center border-border/50 border-r border-r-transparent border-b px-3 text-sm transition-all duration-200',
                      isSelected
                        ? 'border-r-3 border-r-white bg-accent/50 text-foreground'
                        : 'text-muted-foreground hover:bg-accent/30 hover:text-foreground',
                    )}
                    key={lvl.id}
                    onClick={() => handleLevelClick(lvl.id)}
                  >
                    <div className="flex min-w-0 flex-1 items-center gap-2">
                      <span
                        className={cn(
                          'flex h-4 w-4 shrink-0 items-center justify-center transition-all duration-200',
                          !isSelected && 'opacity-60 grayscale',
                        )}
                      >
                        <Layers className="h-3.5 w-3.5" />
                      </span>
                      <div className="min-w-0 flex-1 truncate text-left">
                        {lvl.name || `レベル ${lvl.level}`}
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {showPreviewCameraHints && (
        <div className="dark absolute top-4 right-4 z-20 w-[320px] text-foreground">
          <div className="pointer-events-auto rounded-2xl border border-border/40 bg-background/95 p-4 shadow-lg backdrop-blur-xl transition-colors duration-200 ease-out">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="font-medium text-sm">プレビュー操作</div>
                <div className="mt-1 text-muted-foreground text-xs leading-5">
                  {enablePreviewTrackpadControls
                    ? 'トラックパッドモードは有効です。プレビュー中でも修飾キーでズーム、移動、回転を切り替えられます。'
                    : 'トラックパッドモードは無効です。スクロールでズームでき、修飾キー操作は設定から有効化できます。'}
                </div>
              </div>
              <button
                aria-label="プレビュー操作ヒントを閉じる"
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground"
                onClick={() => setShowPreviewCameraHints(false)}
                type="button"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-3 space-y-2 rounded-xl border border-border/30 bg-accent/20 p-3 text-xs">
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">トラックパッドスクロール</span>
                <span className="font-medium text-foreground">ズーム</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Shift + スクロール</span>
                <span className="font-medium text-foreground">
                  {enablePreviewTrackpadControls ? '移動' : 'トラックパッドモードで利用可能'}
                </span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Alt/Option + スクロール</span>
                <span className="font-medium text-foreground">
                  {enablePreviewTrackpadControls ? '回転' : 'トラックパッドモードで利用可能'}
                </span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">回転ボタン</span>
                <span className="font-medium text-foreground">クイック回転</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Controls Panel - Bottom Center */}
      <div className="dark absolute bottom-6 left-1/2 z-20 -translate-x-1/2 text-foreground">
        <TooltipProvider delayDuration={0}>
          <div className="pointer-events-auto flex h-14 flex-row items-center justify-center gap-1.5 rounded-2xl border border-border/40 bg-background/95 p-1.5 shadow-lg backdrop-blur-xl transition-colors duration-200 ease-out">
            {/* Theme Toggle */}
            <button
              aria-label="テーマを切り替え"
              className="flex h-[36px] shrink-0 cursor-pointer items-center rounded-full border border-border/50 bg-accent/50 p-1"
              onClick={() => useViewer.getState().setTheme(theme === 'dark' ? 'light' : 'dark')}
              type="button"
            >
              <div className="relative flex">
                {/* Sliding Background */}
                <motion.div
                  animate={{
                    x: theme === 'light' ? '100%' : '0%',
                  }}
                  className="absolute inset-0 rounded-full bg-white shadow-sm dark:bg-white/20"
                  initial={false}
                  style={{ width: '50%' }}
                  transition={{
                    type: 'spring',
                    stiffness: 500,
                    damping: 35,
                  }}
                />

                {/* Dark Mode Icon */}
                <div
                  className={cn(
                    'pointer-events-none relative z-10 flex h-7 w-9 items-center justify-center rounded-full transition-colors duration-200',
                    theme === 'dark' ? 'text-foreground' : 'text-muted-foreground',
                  )}
                >
                  <Moon className="h-4 w-4" />
                </div>

                {/* Light Mode Icon */}
                <div
                  className={cn(
                    'pointer-events-none relative z-10 flex h-7 w-9 items-center justify-center rounded-full transition-colors duration-200',
                    theme === 'light' ? 'text-foreground' : 'text-muted-foreground',
                  )}
                >
                  <Sun className="h-4 w-4" />
                </div>
              </div>
            </button>

            <div className="mx-1 h-5 w-px bg-border/40" />

            {/* Scans and Guides Visibility */}
            {canShowScans && (
              <ActionButton
                className={
                  showScans
                    ? 'bg-white/10'
                    : 'opacity-60 grayscale hover:bg-white/5 hover:opacity-100 hover:grayscale-0'
                }
                label={`スキャン: ${showScans ? '表示' : '非表示'}`}
                onClick={() => useViewer.getState().setShowScans(!showScans)}
                size="icon"
                tooltipSide="top"
                variant="ghost"
              >
                <img
                  alt="スキャン"
                  className="h-[28px] w-[28px] object-contain"
                  src="/icons/mesh.png"
                />
              </ActionButton>
            )}

            {canShowGuides && (
              <ActionButton
                className={
                  showGuides
                    ? 'bg-white/10'
                    : 'opacity-60 grayscale hover:bg-white/5 hover:opacity-100 hover:grayscale-0'
                }
                label={`ガイド: ${showGuides ? '表示' : '非表示'}`}
                onClick={() => useViewer.getState().setShowGuides(!showGuides)}
                size="icon"
                tooltipSide="top"
                variant="ghost"
              >
                <img
                  alt="ガイド"
                  className="h-[28px] w-[28px] object-contain"
                  src="/icons/floorplan.png"
                />
              </ActionButton>
            )}

            {(canShowScans || canShowGuides) && <div className="mx-1 h-5 w-px bg-border/40" />}

            {/* Camera Mode */}
            <ActionButton
              className={
                cameraMode === 'orthographic'
                  ? 'bg-violet-500/20 text-violet-400'
                  : 'hover:bg-white/5 hover:text-violet-400'
              }
              label={`カメラ: ${cameraMode === 'perspective' ? '透視' : '平行投影'}`}
              onClick={() =>
                useViewer
                  .getState()
                  .setCameraMode(cameraMode === 'perspective' ? 'orthographic' : 'perspective')
              }
              size="icon"
              tooltipSide="top"
              variant="ghost"
            >
              <Camera className="h-6 w-6" />
            </ActionButton>

            {/* Level Mode */}
            <ActionButton
              className={
                levelMode !== 'stacked'
                  ? 'bg-amber-500/20 text-amber-400'
                  : 'hover:bg-white/5 hover:text-amber-400'
              }
              label={`レベル: ${levelMode === 'manual' ? '手動' : levelModeLabels[levelMode as keyof typeof levelModeLabels]}`}
              onClick={() => {
                if (levelMode === 'manual') return useViewer.getState().setLevelMode('stacked')
                const modes: ('stacked' | 'exploded' | 'solo')[] = ['stacked', 'exploded', 'solo']
                const nextIndex = (modes.indexOf(levelMode as any) + 1) % modes.length
                useViewer.getState().setLevelMode(modes[nextIndex] ?? 'stacked')
              }}
              size="icon"
              tooltipSide="top"
              variant="ghost"
            >
              {levelMode === 'solo' && <Diamond className="h-6 w-6" />}
              {levelMode === 'exploded' && <Layers2 className="h-6 w-6" />}
              {(levelMode === 'stacked' || levelMode === 'manual') && (
                <Layers className="h-6 w-6" />
              )}
            </ActionButton>

            {/* Wall Mode */}
            <ActionButton
              className={
                wallMode !== 'cutaway'
                  ? 'bg-white/10'
                  : 'opacity-60 grayscale hover:bg-white/5 hover:opacity-100 hover:grayscale-0'
              }
              label={`壁: ${wallModeConfig[wallMode as keyof typeof wallModeConfig].label}`}
              onClick={() => {
                const modes: ('cutaway' | 'up' | 'down')[] = ['cutaway', 'up', 'down']
                const nextIndex = (modes.indexOf(wallMode as any) + 1) % modes.length
                useViewer.getState().setWallMode(modes[nextIndex] ?? 'cutaway')
              }}
              size="icon"
              tooltipSide="top"
              variant="ghost"
            >
              {(() => {
                const Icon = wallModeConfig[wallMode as keyof typeof wallModeConfig].icon
                return <Icon className="h-[28px] w-[28px]" />
              })()}
            </ActionButton>

            <div className="mx-1 h-5 w-px bg-border/40" />

            {/* Camera Actions */}
            <ActionButton
              className="group hidden hover:bg-white/5 sm:inline-flex"
              label="左回転"
              onClick={() => emitter.emit('camera-controls:orbit-ccw')}
              size="icon"
              tooltipSide="top"
              variant="ghost"
            >
              <img
                alt="左回転"
                className="h-[28px] w-[28px] -scale-x-100 object-contain opacity-70 transition-opacity group-hover:opacity-100"
                src="/icons/rotate.png"
              />
            </ActionButton>

            <ActionButton
              className="group hidden hover:bg-white/5 sm:inline-flex"
              label="右回転"
              onClick={() => emitter.emit('camera-controls:orbit-cw')}
              size="icon"
              tooltipSide="top"
              variant="ghost"
            >
              <img
                alt="右回転"
                className="h-[28px] w-[28px] object-contain opacity-70 transition-opacity group-hover:opacity-100"
                src="/icons/rotate.png"
              />
            </ActionButton>

            <ActionButton
              className="group hover:bg-white/5"
              label="上面図"
              onClick={() => emitter.emit('camera-controls:top-view')}
              size="icon"
              tooltipSide="top"
              variant="ghost"
            >
              <img
                alt="上面図"
                className="h-[28px] w-[28px] object-contain opacity-70 transition-opacity group-hover:opacity-100"
                src="/icons/topview.png"
              />
            </ActionButton>
          </div>
        </TooltipProvider>
      </div>
    </>
  )
}
