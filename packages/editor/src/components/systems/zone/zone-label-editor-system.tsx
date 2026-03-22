'use client'

import { useScene, type ZoneNode } from '@vesper/core'
import { useViewer } from '@vesper/viewer'
import { Check, Pencil } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useShallow } from 'zustand/react/shallow'
import useEditor from '../../../store/use-editor'

// ─── Per-zone label editor ────────────────────────────────────────────────────

function ZoneLabelEditor({ zoneId }: { zoneId: ZoneNode['id'] }) {
  const zone = useScene((s) => s.nodes[zoneId] as ZoneNode | undefined)
  const updateNode = useScene((s) => s.updateNode)
  const setSelection = useViewer((s) => s.setSelection)
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
  useEffect(() => {
    const el = document.getElementById(`${zoneId}-label`)
    if (!el) return
    setLabelEl(el)

    const textEl = el.children[0] as HTMLElement | undefined
    if (textEl) textEl.style.display = 'none'

    return () => {
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

  if (!labelEl) return null

  const shadowColor = zone?.color ?? '#6366f1'
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
          setSelection({ zoneId })
          setValue(zoneNameRef.current)
          setEditing(true)
        }}
        onMouseDown={(e) => e.stopPropagation()}
        style={{ ...sharedStyle, background: 'none', border: 'none', cursor: 'text', padding: 0 }}
        type="button"
      >
        <span>{zone?.name}</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', opacity: 0.55 }}>
          <Pencil size={10} />
        </span>
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
  const structureLayer = useEditor((s) => s.structureLayer)
  const mode = useEditor((s) => s.mode)

  if (structureLayer !== 'zones' || mode !== 'select') return null

  return (
    <>
      {zoneIds.map((id) => (
        <ZoneLabelEditor key={id} zoneId={id} />
      ))}
    </>
  )
}
