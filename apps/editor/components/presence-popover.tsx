'use client'

import * as PopoverPrimitive from '@radix-ui/react-popover'
import { cn } from '@/lib/utils'
import type { Person } from './use-scene-presence'

export interface PresencePopoverProps {
  present: Person[]
  currentUserId?: string | null
  isEditor?: boolean
  canEdit?: boolean
  editor?: { userId: string; email: string | null } | null
  onTakeOver?: () => void
  onPassControl?: (targetUserId: string) => void | Promise<void>
  className?: string
  defaultOpen?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

/** Local-part of an email, falling back to a short id, as a display name. */
export function displayName(email: string | null, userId: string): string {
  if (email) {
    const local = email.split('@')[0]
    if (local) return local
  }
  return userId.slice(0, 6)
}

export function initials(name: string): string {
  return name.slice(0, 2).toUpperCase()
}

export function PresencePopover({
  present = [],
  currentUserId,
  isEditor = false,
  canEdit = false,
  editor = null,
  onTakeOver,
  onPassControl,
  className,
  defaultOpen,
  open,
  onOpenChange,
}: PresencePopoverProps) {
  const visibleAvatars = present.slice(0, 3)
  const overflowCount = present.length > 3 ? present.length - 3 : 0
  const editorName = editor ? displayName(editor.email, editor.userId) : null

  return (
    <PopoverPrimitive.Root
      defaultOpen={defaultOpen}
      onOpenChange={onOpenChange}
      open={open}
    >
      <div
        aria-label="Presence avatars"
        className={cn('relative inline-flex items-center', className)}
        role="group"
      >
        <PopoverPrimitive.Trigger asChild>
          <button
            aria-label="Presence avatars"
            className="flex items-center -space-x-1.5 rounded-full p-0.5 transition-opacity hover:opacity-90 focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            type="button"
          >
            {visibleAvatars.map((person) => {
              const name = displayName(person.email, person.userId)
              return (
                <span
                  className={cn(
                    'flex h-6 w-6 items-center justify-center rounded-full border border-background bg-muted font-medium text-[10px] text-muted-foreground shadow-sm',
                    person.isEditor && 'ring-1.5 ring-emerald-500',
                  )}
                  key={person.userId}
                  title={person.email ?? person.userId}
                >
                  {initials(name)}
                </span>
              )
            })}
            {overflowCount > 0 ? (
              <span className="flex h-6 w-6 items-center justify-center rounded-full border border-background bg-accent font-semibold text-[10px] text-accent-foreground shadow-sm">
                +{overflowCount}
              </span>
            ) : null}
          </button>
        </PopoverPrimitive.Trigger>

        <PopoverPrimitive.Content
          align="start"
          className="z-50 min-w-56 rounded-xl border border-border bg-popover/95 p-3 text-popover-foreground shadow-xl backdrop-blur-md outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2"
          side="bottom"
          sideOffset={8}
        >
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between border-border/40 border-b pb-1.5">
                <span className="font-semibold text-foreground text-xs">
                  Çevrimiçi Kullanıcılar ({present.length})
                </span>
              </div>

              {present.length === 0 ? (
                <div className="py-2 text-center text-muted-foreground text-xs">
                  Kimse çevrimiçi değil
                </div>
              ) : (
                <div className="flex flex-col divide-y divide-border/40">
                  {present.map((person) => {
                    const name = displayName(person.email, person.userId)
                    const isSelf = person.userId === currentUserId
                    return (
                      <div
                        className={cn(
                          'flex items-center justify-between py-1.5',
                          isSelf && 'rounded-md bg-primary/10 px-1.5 font-semibold text-foreground',
                        )}
                        key={person.userId}
                      >
                        <div className="flex items-center gap-2">
                          <span
                            className={cn(
                              'flex h-5 w-5 items-center justify-center rounded-full bg-muted font-medium text-[10px]',
                              person.isEditor && 'ring-1 ring-emerald-500 text-emerald-500',
                            )}
                          >
                            {initials(name)}
                          </span>
                          <span className="text-xs">{name}</span>
                          {isSelf ? (
                            <span className="rounded bg-primary/10 px-1 py-0.5 font-medium text-[9px] text-primary">
                              (Sen)
                            </span>
                          ) : null}
                          {person.isEditor ? (
                            <span className="rounded bg-emerald-500/15 px-1 py-0.5 font-medium text-[9px] text-emerald-500">
                              editör
                            </span>
                          ) : (
                            <span className="text-[9px] text-muted-foreground">izleyici</span>
                          )}
                        </div>

                        {/* Role handoff button: only shown for active editor next to other viewers */}
                        {isEditor && !isSelf && !person.isEditor ? (
                          <button
                            className="rounded border border-border bg-background px-2 py-0.5 font-medium text-[10px] text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                            onClick={() => onPassControl?.(person.userId)}
                            type="button"
                          >
                            Yetki Devret
                          </button>
                        ) : null}
                      </div>
                    )
                  })}
                </div>
              )}

              {/* Bottom status and actions */}
              {!isEditor && canEdit && editor === null ? (
                <button
                  className="mt-1 w-full rounded-md bg-primary py-1 font-medium text-primary-foreground text-xs transition-colors hover:bg-primary/90"
                  onClick={onTakeOver}
                  type="button"
                >
                  Düzenlemeye geç
                </button>
              ) : !isEditor && editorName ? (
                <p className="border-border/30 border-t pt-1.5 text-[11px] text-muted-foreground">
                  {editorName} düzenliyor — siz izliyorsunuz
                </p>
              ) : isEditor ? (
                <p className="border-border/30 border-t pt-1.5 font-medium text-[11px] text-emerald-500">
                  Düzenliyorsunuz
                </p>
              ) : null}
            </div>
          </PopoverPrimitive.Content>
      </div>
    </PopoverPrimitive.Root>
  )
}
