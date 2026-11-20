'use client'

import { useHasPointAskHandler, usePascalI18n } from '@pascal-app/core'
import type { ReactNode } from 'react'
import { canPoint, enterPointMode, leavePointMode } from '../../../lib/point-ask/session'
import { cn } from '../../../lib/utils'
import useEditor from '../../../store/use-editor'
import { usePointAsk } from '../../../store/use-point-ask'
import { isViewVisible, VIEW_3D } from '../../../store/view-layout'
import { ActionButton } from '@pascal-app/viewer/ui'

/**
 * Point and ask (key C): the toolbar's way into the mode where hovering names what Pascal would
 * be told about and a click opens a bubble to ask. Offered only where a host answers asks. In
 * the 2D plan and the walkthrough it is disabled and says so (v1 works in the 3D view).
 */
export function PointAskButton({ icon }: { icon?: ReactNode }) {
  const i18n = usePascalI18n()
  const available = useHasPointAskHandler()
  const active = usePointAsk((s) => s.active)
  const sceneVisible = useEditor((s) => isViewVisible(s, VIEW_3D))
  const firstPerson = useEditor((s) => s.isFirstPersonMode)
  if (!(available || active)) return null
  const unavailable = !active && (!sceneVisible || firstPerson)
  return (
    <ActionButton
      className={cn(
        'group text-muted-foreground',
        active
          ? 'bg-[#a99bff]/20 text-[#5d49df] dark:text-[#c9c1ff] dark:hover:text-accent-foreground'
          : 'hover:bg-[#a99bff]/15 hover:text-[#5d49df] dark:hover:text-[#c9c1ff]',
      )}
      data-guide-target="mode-point-ask"
      disabled={unavailable}
      isActive={active}
      label={i18n._({ id: 'editor.actionMenu.pointAskButton.pointAndAsk', message: 'Point and ask' })}
      onClick={() => {
        if (active) leavePointMode()
        else if (canPoint()) enterPointMode(true)
      }}
      shortcut="C"
      size="icon"
      tooltipContent={
        unavailable ? <p>{i18n._({ id: 'editor.actionMenu.pointAskButton.pointAndAskWorksInThe', message: 'Point and ask works in the 3D view' })}</p> : <p>{i18n._({ id: 'editor.actionMenu.pointAskButton.pointAndAskC', message: 'Point and ask (C)' })}</p>
      }
      variant="ghost"
    >
      {icon ?? (
        <svg
          aria-hidden
          className="size-4"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
          viewBox="0 0 24 24"
        >
          <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />
          <path d="M12 8v6" />
          <path d="M9 11h6" />
        </svg>
      )}
    </ActionButton>
  )
}
