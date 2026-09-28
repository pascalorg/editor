import type { Control, ControlValue } from '@pascal-app/core'
import { operableParts, type ProceduralItemNode } from '@pascal-app/core/procedural-items'

export type ControlDescriptor = {
  key: string
  control: Control
  value: ControlValue
  onChange: (value: ControlValue) => void
}

export function proceduralControlDescriptors(
  recipe: Pick<ProceduralItemNode['recipe'], 'parts' | 'joints'>,
  state: { parts: Record<string, boolean>; lightsOn: boolean } | undefined,
  togglePart: (partId: string) => void,
  toggleLights: () => void,
  lampDefault = false,
): ControlDescriptor[] {
  const controls = operableParts(recipe).map((part) => ({
    key: part.id,
    control: { kind: 'toggle' as const, label: part.label },
    value: state?.parts[part.id] ?? part.kind === 'spin',
    onChange: () => togglePart(part.id),
  }))
  if (recipe.parts.some((part) => part.light))
    controls.push({
      key: 'lights',
      control: { kind: 'toggle', label: 'Lights' },
      value: state?.lightsOn ?? lampDefault,
      onChange: toggleLights,
    })
  return controls
}
