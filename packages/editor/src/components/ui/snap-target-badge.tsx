import type { AnyNode, AssetInput } from '@pascal-app/core'
import type { ReactNode } from 'react'
import { cn } from '../../lib/utils'

export type SnapTarget = 'wall' | 'ceiling' | 'roof'

const SNAP_TARGET_ICONS: Record<SnapTarget, string> = {
  wall: '/icons/wall.png',
  ceiling: '/icons/ceiling.png',
  roof: '/icons/roof.png',
}

const SNAP_TARGET_LABELS: Record<SnapTarget, string> = {
  wall: 'Wall attachment',
  ceiling: 'Ceiling attachment',
  roof: 'Roof attachment',
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
  target,
}: {
  className?: string
  target: SnapTarget
}) {
  return (
    <span
      className={cn(
        'flex h-4 w-4 items-center justify-center rounded bg-black/65 ring-1 ring-white/20',
        className,
      )}
    >
      <img
        alt={SNAP_TARGET_LABELS[target]}
        className="h-3 w-3 object-contain"
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
    <span className="relative inline-flex h-4 w-4 items-center justify-center">
      {children}
      <SnapTargetBadge
        className="-right-1 -bottom-1 absolute h-2.5 w-2.5 rounded-[2px] [&_img]:h-2 [&_img]:w-2"
        target={target}
      />
    </span>
  )
}
