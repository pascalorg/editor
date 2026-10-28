import type { FoundationConstructionChoice, ToolOption } from '@pascal-app/core'
import { useEditor } from '@pascal-app/editor'
import { create } from 'zustand'

/**
 * What the Foundation tool pours, kept apart from the editor's tool defaults: a host clears those
 * when it arms a tool from its tile, which would forget the choice just picked.
 */
export const useFoundationDraw = create<{
  construction: FoundationConstructionChoice
  setConstruction: (construction: FoundationConstructionChoice) => void
}>((set) => ({
  construction: 'building',
  setConstruction: (construction) => set({ construction }),
}))

/** One of the foundation family's draws: an outline poured as one of three, or a footing. */
export type FoundationDraw = FoundationConstructionChoice | 'strip' | 'pad'

/** What the family draws now: the footing's shape while the Footing tool is armed, else the outline's construction. */
export function foundationDraw(): FoundationDraw {
  const editor = useEditor.getState()
  if (editor.tool === 'footing')
    return editor.toolDefaults.footing?.shape === 'pad' ? 'pad' : 'strip'
  return useFoundationDraw.getState().construction
}

/**
 * "Draw" for the Foundation and Footing tools, one family: an outline poured as the house's
 * foundation, a slab of its own (a porch, a patio, a garage pad) or a raised floor of its own, and
 * a strip or pad footing. Picking across the family switches between the two tools.
 */
export const foundationFamilyOption: ToolOption = {
  id: 'draw',
  label: 'Draw',
  choices: [
    {
      value: 'building',
      label: 'Foundation',
      description: "An outline poured as the house's foundation, in place of the walls' outline",
    },
    {
      value: 'slab',
      label: 'Slab',
      description: 'A slab of its own: a porch, a patio, a garage pad',
    },
    { value: 'raised', label: 'Raised', description: 'A raised floor on a stem wall of its own' },
    {
      value: 'strip',
      label: 'Strip footing',
      description: 'A continuous footing under a bearing wall: click its start and end',
    },
    {
      value: 'pad',
      label: 'Pad footing',
      description: 'A footing under a post: click where it goes',
    },
  ],
  subscribe: (onChange) => {
    const editor = useEditor.subscribe(onChange)
    const draw = useFoundationDraw.subscribe(onChange)
    return () => {
      editor()
      draw()
    }
  },
  value: foundationDraw,
  set: (value) => {
    const editor = useEditor.getState()
    if (value === 'strip' || value === 'pad') {
      editor.setToolDefaults('footing', { ...editor.toolDefaults.footing, shape: value })
      if (editor.tool !== 'footing') editor.armToolMode({ mode: 'build', tool: 'footing' })
      return
    }
    useFoundationDraw
      .getState()
      .setConstruction(value === 'slab' || value === 'raised' ? value : 'building')
    if (editor.tool !== 'foundation') editor.armToolMode({ mode: 'build', tool: 'foundation' })
  },
}
