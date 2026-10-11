'use client'

import { Video } from 'lucide-react'
import { cn } from '../../../lib/utils'
import useFollowPascal from '../../../store/use-follow-pascal'
import { ActionButton } from './action-button'

/** The toolbar's switch for Follow Pascal: the camera follows what the agent builds. */
export function FollowPascalToggle({ className }: { className?: string }) {
  const on = useFollowPascal((state) => state.on)
  const setOn = useFollowPascal((state) => state.setOn)
  return (
    <ActionButton
      aria-pressed={on}
      className={cn(
        on ? 'bg-violet-500/20 text-violet-300' : 'hover:bg-white/5 hover:text-violet-300',
        className,
      )}
      label={`Follow Pascal: ${on ? 'On' : 'Off'}`}
      onClick={() => setOn(!on)}
      size="icon"
      variant="ghost"
    >
      <Video className="h-6 w-6" />
    </ActionButton>
  )
}
