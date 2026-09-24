import type { Control, ControlValue } from '@pascal-app/core'
import type { ProceduralItemNode } from '@pascal-app/core/procedural-items'

export type ControlDescriptor = {
  key: string
  control: Control
  value: ControlValue
  onChange: (value: ControlValue) => void
}

export function proceduralControlDescriptors(
  parts: ProceduralItemNode['recipe']['parts'],
  state: { parts: Record<string, boolean>; lightsOn: boolean } | undefined,
  togglePart: (partId: string) => void,
  toggleLights: () => void,
): ControlDescriptor[] {
  const controls = parts
    .filter((part) => part.motion)
    .map((part) => ({
      key: part.id,
      control: { kind: 'toggle' as const, label: part.label },
      value: state?.parts[part.id] ?? part.motion?.kind === 'spin',
      onChange: () => togglePart(part.id),
    }))
  if (parts.some((part) => part.light))
    controls.push({
      key: 'lights',
      control: { kind: 'toggle', label: 'Lights' },
      value: state?.lightsOn ?? true,
      onChange: toggleLights,
    })
  return controls
}
