import type { AnyNode, AssetInput } from '@pascal-app/core'
import type { ReactNode } from 'react'
import { cn } from '../../lib/utils'

export type SnapTarget = 'wall' | 'ceiling' | 'roof'
export type SnapTargetBadgeSize = 'tile' | 'tree'

const SNAP_TARGET_ICONS: Record<SnapTarget, string> = {
  wall: '/icons/wall.webp',
  ceiling: '/icons/ceiling.webp',
  roof: '/icons/roof.webp',
}

const SNAP_TARGET_LABELS: Record<SnapTarget, string> = {
  wall: 'Wall attachment',
  ceiling: 'Ceiling attachment',
  roof: 'Roof attachment',
}

const SNAP_TARGET_BADGE_SIZE_CLASSES: Record<SnapTargetBadgeSize, string> = {
  tile: 'h-6 w-6 rounded-md',
  tree: 'h-3.5 w-3.5 rounded-[3px]',
}

const SNAP_TARGET_ICON_SIZE_CLASSES: Record<SnapTargetBadgeSize, string> = {
  tile: 'h-[18px] w-[18px]',
  tree: 'h-2.5 w-2.5',
}

export function resolveAssetSnapTarget(attachTo: AssetInput['attachTo']): SnapTarget | null {
  if (attachTo === 'wall' || attachTo === 'wall-side') return 'wall'
  if (attachTo === 'ceiling') return 'ceiling'
  return null
}

export function resolveNodeSnapTarget(node: AnyNode | null | undefined): SnapTarget | null {
  if (!node) return null
  if ('roofSegmentId' in node && typeof node.roofSegmentId === 'string') return 'roof'
  if (node.type === 'downspout') return 'roof'
  if (node.type === 'door' || node.type === 'window') return 'wall'
  if (node.type === 'item') return resolveAssetSnapTarget(node.asset?.attachTo)
  return null
}

export function SnapTargetBadge({
  className,
  size = 'tile',
  target,
}: {
  className?: string
  size?: SnapTargetBadgeSize
  target: SnapTarget
}) {
  return (
    <span
      className={cn(
        'flex items-center justify-center bg-black/65 ring-1 ring-white/20',
        SNAP_TARGET_BADGE_SIZE_CLASSES[size],
        className,
      )}
    >
      <img
        alt={SNAP_TARGET_LABELS[target]}
        className={cn('object-contain', SNAP_TARGET_ICON_SIZE_CLASSES[size])}
        src={SNAP_TARGET_ICONS[target]}
      />
    </span>
  )
}

export function SnapTargetIcon({
  children,
  target,
}: {
  children: ReactNode
  target: SnapTarget
}) {
  return (
    <span className="relative inline-flex h-5 w-5 items-center justify-center">
      {children}
      <SnapTargetBadge
        className="-right-1.5 -bottom-1.5 absolute"
        size="tree"
        target={target}
      />
    </span>
  )
}
