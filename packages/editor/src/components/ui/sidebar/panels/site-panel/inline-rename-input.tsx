'use client'

import { type AnyNodeId, useScene } from '@pascal-app/core'
import { Pencil } from 'lucide-react'
import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { cn } from './../../../../../lib/utils'
import { messages, useLocale } from '../../../../../lib/i18n'

/**
 * Resolve a label string.
 * - If it contains a dot (.) it is treated as an i18n key.
 * - If it contains {param} placeholders, pass `params` to fill them.
 * - Otherwise returned as-is (custom user name).
 */
function resolveLabel(label: string, locale: string, params?: Record<string, string | number>): string {
  if (label.includes('.')) {
    const str = (messages[locale as 'en' | 'zh'] as Record<string, string>)[label] || label
    if (!params) return str
    return Object.entries(params).reduce(
      (s, [k, v]) => s.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v)),
      str,
    )
  }
  return label
}

interface InlineRenameInputProps {
  nodeId: AnyNodeId
  isEditing: boolean
  onStopEditing: () => void
  /** e.g. 'nodeTypes.wall' or 'nodeTypes.zoneWithArea' (params fills {area}) */
  defaultName: string
  /** Params for resolving parameterized i18n keys (e.g. { area: 23 }) */
  defaultNameParams?: Record<string, string | number>
  className?: string
  onStartEditing?: () => void
}

export const InlineRenameInput = memo(function InlineRenameInput({
  nodeId,
  isEditing,
  onStopEditing,
  defaultName,
  defaultNameParams,
  className,
  onStartEditing,
}: InlineRenameInputProps) {
  const { locale } = useLocale()
  const updateNode = useScene((s) => s.updateNode)
  const name = useScene((s) => s.nodes[nodeId]?.name)
  const [value, setValue] = useState(name || '')
  const inputRef = useRef<HTMLInputElement>(null)
  const resolvedDefault = resolveLabel(defaultName, locale, defaultNameParams)
  const inputSize = Math.max((value || resolvedDefault).length, 1)

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
    if (trimmed !== name) {
      updateNode(nodeId, { name: trimmed || undefined })
    }
    onStopEditing()
  }, [value, nodeId, name, updateNode, onStopEditing])

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
          {name || resolvedDefault}
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
      placeholder={resolvedDefault}
      ref={inputRef}
      size={inputSize}
      type="text"
      value={value}
    />
  )
})
