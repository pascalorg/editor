import { type AnyNode, useScene } from '@pascal-app/core'
import { Pencil } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { cn } from './../../../../../lib/utils'

interface InlineRenameInputProps {
  node: AnyNode
  isEditing: boolean
  onStopEditing: () => void
  defaultName: string
  className?: string
  onStartEditing?: () => void
}

export function InlineRenameInput({
  node,
  isEditing,
  onStopEditing,
  defaultName,
  className,
  onStartEditing,
}: InlineRenameInputProps) {
  const updateNode = useScene((s) => s.updateNode)
  const [value, setValue] = useState(node.name || '')
  const inputRef = useRef<HTMLInputElement>(null)
  const inputSize = Math.max((value || defaultName).length, 1)

  useEffect(() => {
    if (isEditing) {
      setValue(node.name || '')
      // Focus and select all text after a short delay
      setTimeout(() => {
        if (inputRef.current) {
          inputRef.current.focus()
          inputRef.current.select()
        }
      }, 0)
    }
  }, [isEditing, node.name])

  const handleSave = useCallback(() => {
    const trimmed = value.trim()
    if (trimmed !== node.name) {
      updateNode(node.id, { name: trimmed || undefined })
    }
    onStopEditing()
  }, [value, node.id, node.name, updateNode, onStopEditing])

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
          {node.name || defaultName}
        </span>
        {onStartEditing && (
          <button
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
}
