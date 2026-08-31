'use client'

import type { Control, ControlValue } from '@pascal-app/core'

/** One interactive control (toggle / slider / temperature) rendered inside the
 *  item controls overlay. Shared by the parametric `InteractiveSystem` and the
 *  baked-GLB `GlbInteractive` overlay so both look and behave identically. */
export const ControlWidget = ({
  control,
  value,
  onChange,
}: {
  control: Control
  value: ControlValue
  onChange: (v: ControlValue) => void
}) => {
  const labelStyle: React.CSSProperties = {
    color: 'white',
    fontSize: 11,
    fontFamily: 'monospace',
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
  }

  if (control.kind === 'toggle') {
    return (
      <button
        onClick={() => onChange(!value)}
        style={{
          background: value ? '#4ade80' : '#374151',
          color: 'white',
          border: 'none',
          borderRadius: 4,
          padding: '4px 8px',
          cursor: 'pointer',
          fontSize: 12,
          fontFamily: 'monospace',
          transition: 'background 0.2s',
        }}
      >
        {control.label ?? (value ? 'On' : 'Off')}
      </button>
    )
  }

  if (control.kind === 'slider') {
    return (
      <label style={labelStyle}>
        <span>
          {control.label}: {value}
          {control.unit ? ` ${control.unit}` : ''}
        </span>
        <input
          max={control.max}
          min={control.min}
          onChange={(e) => onChange(Number(e.target.value))}
          onPointerDown={(e) => e.stopPropagation()}
          step={control.step}
          type="range"
          value={value as number}
        />
      </label>
    )
  }

  if (control.kind === 'temperature') {
    return (
      <label style={labelStyle}>
        <span>
          {control.label}: {value}°{control.unit}
        </span>
        <input
          max={control.max}
          min={control.min}
          onChange={(e) => onChange(Number(e.target.value))}
          onPointerDown={(e) => e.stopPropagation()}
          step={1}
          type="range"
          value={value as number}
        />
      </label>
    )
  }

  return null
}
