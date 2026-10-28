import { type AnyNodeId, usePascalI18n, useScene } from '@pascal-app/core'
import { Pencil } from 'lucide-react'
import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { displayRoomName } from './../../../../../lib/room-name-messages'
import { renameRoom } from './../../../../../lib/room-structure-commands'
import { cn } from './../../../../../lib/utils'
import { commitRoomNameEdit } from './../../../panels/room-name-options'

interface InlineRenameFieldProps {
  name: string | undefined
  /** Receives the trimmed name, or `undefined` when cleared. */
  onRename: (name: string | undefined) => void
  isEditing: boolean
  onStopEditing: () => void
  defaultName: string
  /** Shown instead of the stored name when not editing (a level's display name). */
  displayName?: string
  className?: string
  onStartEditing?: () => void
}

type InlineRenameInputProps = Omit<InlineRenameFieldProps, 'name' | 'onRename'> & {
  nodeId: AnyNodeId
  /** The part of the stored name the user edits; a generated default edits as empty. */
  editableName?: (name: string | undefined) => string | undefined
}

/**
 * Renames a scene node through `updateNode`; a room through its intent (`renameRoom`), so a name
 * carries what it asks of the room (a garage stands on a slab) as the room panel's does.
 */
export const InlineRenameInput = memo(function InlineRenameInput({
  nodeId,
  editableName,
  ...props
}: InlineRenameInputProps) {
  const updateNode = useScene((s) => s.updateNode)
  const stored = useScene((s) => s.nodes[nodeId]?.name)
  const name = editableName ? editableName(stored) : stored
  const isRoom = useScene((s) => s.nodes[nodeId]?.type === 'zone')
  const handleRename = useCallback(
    (next: string | undefined) =>
      isRoom ? renameRoom(nodeId, next ?? '') : updateNode(nodeId, { name: next }),
    [isRoom, nodeId, updateNode],
  )
  return <InlineRenameField {...props} name={name} onRename={handleRename} />
})

/**
 * Renames a room or zone from the layer tree. The field edits the name in the
 * UI language, as the room panel shows it, and stores what an edit there
 * stores: a catalog name stays English ("Salon 3" on a Lounge stores "Lounge 3").
 * Like the room panel's, it writes through the room's intent (`renameRoom`), so
 * a name carries what it asks of the room (a garage stands on a slab).
 */
export const RoomRenameInput = memo(function RoomRenameInput({
  nodeId,
  ...props
}: Omit<InlineRenameInputProps, 'editableName' | 'displayName'>) {
  const i18n = usePascalI18n()
  const stored = useScene((s) => s.nodes[nodeId]?.name)
  const handleRename = useCallback(
    (next: string | undefined) => {
      if (next === undefined) {
        renameRoom(nodeId, '')
        return
      }
      const name = useScene.getState().nodes[nodeId]?.name ?? ''
      commitRoomNameEdit(nodeId, name, displayRoomName(name, i18n), next, i18n)
    },
    [nodeId, i18n],
  )
  return (
    <InlineRenameField
      {...props}
      name={stored ? displayRoomName(stored, i18n) : stored}
      onRename={handleRename}
    />
  )
})

export const InlineRenameField = memo(function InlineRenameField({
  name,
  onRename,
  isEditing,
  onStopEditing,
  defaultName,
  displayName,
  className,
  onStartEditing,
}: InlineRenameFieldProps) {
  const i18n = usePascalI18n()
  const [value, setValue] = useState(name || '')
  const inputRef = useRef<HTMLInputElement>(null)
  const inputSize = Math.max((value || defaultName).length, 1)

  useEffect(() => {
    if (isEditing) {
      setValue(name || '')
      // Focus and select all text after a short delay
      setTimeout(() => {
        if (inputRef.current) {
          inputRef.current.focus()
          inputRef.current.select()
        }
      }, 0)
    }
  }, [isEditing, name])

  const handleSave = useCallback(() => {
    const trimmed = value.trim()
    if ((trimmed || undefined) !== (name || undefined)) {
      onRename(trimmed || undefined)
    }
    onStopEditing()
  }, [value, name, onRename, onStopEditing])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleSave()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onStopEditing()
    }
  }

  if (!isEditing) {
    return (
      <div className="group/rename flex h-5 min-w-0 items-center gap-1">
        <span className={cn('truncate border-transparent border-b', className)}>
          {displayName ?? (name || defaultName)}
        </span>
        {onStartEditing && (
          <button
            aria-label={i18n._({ id: 'editor.layers.rename', message: 'Rename' })}
            className="shrink-0 text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover/rename:opacity-100"
            onClick={(e) => {
              e.stopPropagation()
              onStartEditing()
            }}
          >
            <Pencil className="h-3 w-3" />
          </button>
        )}
      </div>
    )
  }

  return (
    <input
      aria-label={i18n._({ id: 'editor.layers.rename', message: 'Rename' })}
      className={cn(
        'm-0 h-5 min-w-[1ch] max-w-full flex-none rounded-none border-primary/50 border-b bg-transparent px-0 py-0 text-foreground text-sm outline-none focus:border-primary',
        className,
      )}
      onBlur={handleSave}
      onChange={(e) => setValue(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onKeyDown={handleKeyDown}
      placeholder={defaultName}
      ref={inputRef}
      size={inputSize}
      type="text"
      value={value}
    />
  )
})
