'use client'

import type { Person } from './use-scene-presence'

export interface PresenceBarProps {
  present: Person[]
  isEditor: boolean
  canEdit: boolean
  editor: { userId: string; email: string | null } | null
  onTakeOver: () => void
  onPassControl?: (targetUserId: string) => void | Promise<void>
  currentUserId?: string | null
}

/** Local-part of an email, falling back to a short id, as a display name. */
function displayName(email: string | null, userId: string): string {
  if (email) {
    const local = email.split('@')[0]
    if (local) return local
  }
  return userId.slice(0, 6)
}

function initials(name: string): string {
  return name.slice(0, 2).toUpperCase()
}

export function PresenceBar({ present, isEditor, canEdit, editor, onTakeOver }: PresenceBarProps) {
  const editorName = editor ? displayName(editor.email, editor.userId) : null

  return (
    <div className="pointer-events-auto absolute top-4 left-1/2 z-40 -translate-x-1/2">
      <div className="flex items-center gap-3 rounded-full border border-border bg-background/90 px-3 py-1.5 shadow-lg backdrop-blur">
        <div className="-space-x-1.5 flex items-center">
          {present.map((person) => {
            const name = displayName(person.email, person.userId)
            return (
              <span
                className="flex items-center gap-1.5 rounded-full border border-border bg-accent/60 py-0.5 pr-2 pl-0.5"
                key={person.userId}
                title={person.email ?? person.userId}
              >
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-muted font-medium text-[10px] text-muted-foreground">
                  {initials(name)}
                </span>
                <span className="font-medium text-foreground text-xs">{name}</span>
                {person.isEditor && (
                  <span className="rounded-full bg-primary/15 px-1.5 py-px font-medium text-[10px] text-primary">
                    editör
                  </span>
                )}
              </span>
            )
          })}
        </div>

        {isEditor ? (
          <span className="text-muted-foreground text-xs">Düzenliyorsunuz</span>
        ) : canEdit && editor === null ? (
          <button
            className="rounded-full bg-primary px-3 py-1 font-medium text-primary-foreground text-xs hover:bg-primary/90"
            onClick={onTakeOver}
            type="button"
          >
            Düzenlemeye geç
          </button>
        ) : canEdit && editorName ? (
          <span className="text-muted-foreground text-xs">
            {editorName} düzenliyor — siz izliyorsunuz
          </span>
        ) : null}
      </div>
    </div>
  )
}
