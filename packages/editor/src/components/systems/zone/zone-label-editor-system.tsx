'use client'

import { type AnyNodeId, emitter, useScene, type ZoneNode } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { Check, Pencil } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useShallow } from 'zustand/react/shallow'
import { sfxEmitter } from '../../../lib/sfx-bus'
import useEditor from '../../../store/use-editor'

// ─── Per-zone label editor ────────────────────────────────────────────────────

function ZoneLabelEditor({ zoneId }: { zoneId: ZoneNode['id'] }) {
  const zone = useScene((s) => s.nodes[zoneId] as ZoneNode | undefined)
  const updateNode = useScene((s) => s.updateNode)
  const deleteNode = useScene((s) => s.deleteNode)
  const setSelection = useViewer((s) => s.setSelection)
  const selectedZoneId = useViewer((s) => s.selection.zoneId)
  const hoveredId = useViewer((s) => s.hoveredId)
  const mode = useEditor((s) => s.mode)
  const isSelected = selectedZoneId === zoneId
  const isDeleteHovered = mode === 'delete' && hoveredId === zoneId
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const [labelEl, setLabelEl] = useState<HTMLElement | null>(null)

  // Keep a ref so the click handler never has a stale zone name
  const zoneNameRef = useRef(zone?.name ?? '')
  useEffect(() => {
    zoneNameRef.current = zone?.name ?? ''
  }, [zone?.name])

  // Setup: find the label element, enable pointer events, and hide the
  // zone-renderer's own text node (children[0]) — we replace it via portal.
  // Retries via rAF because the <Html> element from drei may not exist yet at mount time.
  useEffect(() => {
    let cancelled = false
    let textEl: HTMLElement | undefined

    const tryFind = () => {
      const el = document.getElementById(`${zoneId}-label`)
      if (!el) {
        if (!cancelled) requestAnimationFrame(tryFind)
        return
      }
      setLabelEl(el)
      textEl = el.children[0] as HTMLElement | undefined
      if (textEl) textEl.style.display = 'none'
    }

    tryFind()

    return () => {
      cancelled = true
      if (textEl) textEl.style.display = ''
    }
  }, [zoneId])

  // Focus + select-all when entering edit mode
  useEffect(() => {
    if (editing) {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [editing])

  // Tint the label pin red when delete-hovered
  useEffect(() => {
    if (!labelEl) return
    const pin = labelEl.querySelector('.label-pin') as HTMLElement | null
    if (!pin) return
    const line = pin.children[0] as HTMLElement | undefined
    const circle = pin.children[1] as HTMLElement | undefined
    const color = isDeleteHovered ? '#dc2626' : (zone?.color ?? '#6366f1')
    if (line) line.style.backgroundColor = color
    if (circle) {
      circle.style.backgroundColor = color
    }
    if (isDeleteHovered) {
      pin.style.opacity = '1'
    }
    return () => {
      // Restore zone color
      const originalColor = zone?.color ?? '#6366f1'
      if (line) line.style.backgroundColor = originalColor
      if (circle) circle.style.backgroundColor = originalColor
    }
  }, [isDeleteHovered, labelEl, zone?.color])

  const save = useCallback(() => {
    const trimmed = value.trim()
    if (trimmed !== (zone?.name ?? '')) {
      updateNode(zoneId, { name: trimmed || undefined })
    }
    setEditing(false)
  }, [value, zone?.name, updateNode, zoneId])

  const cancel = useCallback(() => {
    setValue(zone?.name ?? '')
    setEditing(false)
  }, [zone?.name])

  // Select zone + switch to zone mode from any mode
  const selectZone = useCallback(() => {
    useEditor.getState().setPhase('structure')
    useEditor.getState().setStructureLayer('zones')
    useEditor.getState().setMode('select')
    setSelection({ zoneId })
  }, [zoneId, setSelection])

  // Enter text editing
  const enterTextEditing = useCallback(() => {
    selectZone()
    setValue(zoneNameRef.current)
    setEditing(true)
  }, [selectZone])

  // Listen for edit-label events from the 2D floorplan (double-click on zone label)
  useEffect(() => {
    const handler = (event: { zoneId: string }) => {
      if (event.zoneId === zoneId) {
        setValue(zoneNameRef.current)
        setEditing(true)
      }
    }
    emitter.on('zone:edit-label' as any, handler as any)
    return () => {
      emitter.off('zone:edit-label' as any, handler as any)
    }
  }, [zoneId])

  if (!labelEl) return null

  const shadowColor = isDeleteHovered ? '#dc2626' : (zone?.color ?? '#6366f1')
  const textShadow = [
    `-1px -1px 0 ${shadowColor}`,
    ` 1px -1px 0 ${shadowColor}`,
    `-1px  1px 0 ${shadowColor}`,
    ` 1px  1px 0 ${shadowColor}`,
  ].join(',')

  // order: -1 puts this flex item before children[0] (hidden) and children[1] (pin)
  const sharedStyle: React.CSSProperties = {
    order: -1,
    color: 'white',
    textShadow,
    fontSize: 14,
    fontFamily: 'sans-serif',
    userSelect: 'none',
    pointerEvents: 'auto',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    whiteSpace: 'nowrap',
  }

  return createPortal(
    editing ? (
      <div
        onMouseDown={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        style={sharedStyle}
      >
        <input
          onBlur={save}
          onChange={(e) => setValue(e.target.value)}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Enter') {
              e.preventDefault()
              save()
            }
            if (e.key === 'Escape') {
              e.preventDefault()
              cancel()
            }
          }}
          ref={inputRef}
          style={{
            width: `${Math.max((value || zone?.name || '').length + 1, 4)}ch`,
            border: 'none',
            borderBottom: `1px solid ${shadowColor}`,
            background: 'transparent',
            color: 'white',
            textShadow,
            outline: 'none',
            padding: 0,
            margin: 0,
            fontSize: 'inherit',
            lineHeight: 'inherit',
            fontFamily: 'inherit',
            textAlign: 'center',
          }}
          type="text"
          value={value}
        />
        <button
          onClick={(e) => {
            e.stopPropagation()
            save()
          }}
          onMouseDown={(e) => e.stopPropagation()}
          style={{
            background: 'none',
            border: 'none',
            color: 'white',
            cursor: 'pointer',
            padding: 0,
            display: 'inline-flex',
            alignItems: 'center',
          }}
          type="button"
        >
          <Check size={12} />
        </button>
      </div>
    ) : (
      <button
        onClick={(e) => {
          e.stopPropagation()
          if (mode === 'delete') {
            sfxEmitter.emit('sfx:structure-delete')
            deleteNode(zoneId as AnyNodeId)
            setSelection({ zoneId: null })
            return
          }
          if (isSelected) {
            // Already selected → enter text editing
            enterTextEditing()
          } else {
            // Not selected → select zone + switch to zone mode
            selectZone()
          }
        }}
        onMouseDown={(e) => e.stopPropagation()}
        onPointerEnter={(e) => {
          if (mode === 'delete') {
            useViewer.setState({ hoveredId: zoneId })
          }
        }}
        onPointerLeave={() => {
          if (mode === 'delete' && useViewer.getState().hoveredId === zoneId) {
            useViewer.setState({ hoveredId: null })
          }
        }}
        onPointerMove={
          mode === 'delete'
            ? (e) => {
                // Re-dispatch pointermove to the viewer container so DeleteCursorBadge tracks the cursor.
                const viewerDiv = (e.currentTarget as HTMLElement).closest(
                  '.relative.overflow-hidden',
                )
                if (viewerDiv) {
                  viewerDiv.dispatchEvent(
                    new PointerEvent('pointermove', {
                      clientX: e.clientX,
                      clientY: e.clientY,
                      bubbles: true,
                    }),
                  )
                }
              }
            : undefined
        }
        style={{
          ...sharedStyle,
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          padding: 0,
        }}
        type="button"
      >
        <span>{zone?.name}</span>
        {isSelected && (
          <span
            onClick={(e) => {
              e.stopPropagation()
              enterTextEditing()
            }}
            role="button"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              cursor: 'text',
              filter: `drop-shadow(0 0 2px ${shadowColor})`,
            }}
            tabIndex={0}
          >
            <Pencil size={12} />
          </span>
        )}
      </button>
    ),
    labelEl,
  )
}

// ─── System: rendered in the main React tree (outside Canvas) ─────────────────

export function ZoneLabelEditorSystem() {
  const zoneIds = useScene(
    useShallow((s) =>
      Object.values(s.nodes)
        .filter((n) => n.type === 'zone')
        .map((n) => n.id as ZoneNode['id']),
    ),
  )

  return (
    <>
      {zoneIds.map((id) => (
        <ZoneLabelEditor key={id} zoneId={id} />
      ))}
    </>
  )
}
