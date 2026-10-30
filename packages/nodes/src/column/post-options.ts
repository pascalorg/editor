import {
  type ColumnPostBase,
  FRAMING_POST_BASE_LABELS,
  type FramingPostSize,
  type ToolOption,
} from '@pascal-app/core'
import { useEditor } from '@pascal-app/editor'
import {
  armFramingPostTool,
  dropInflightColumnPlacement,
  framingPostToolChoices,
} from './post-placement'

const subscribe = (onChange: () => void) => useEditor.subscribe(() => onChange())

/** The Post tool's size, or null while the column tool places ornamental columns. */
const postChoices = () => framingPostToolChoices(useEditor.getState().toolDefaults.column)

/**
 * "Place" for the column tool, one family with the Post tool: a column of the chosen style, or a
 * pressure-treated framing post of a size, which stands up to the beam over it. Picking across
 * the family switches what the tool places.
 */
export const columnPlaceOption: ToolOption = {
  id: 'column-place',
  label: 'Place',
  choices: [
    {
      value: 'column',
      label: 'Column',
      description: 'A column of a chosen style: round, square or tapered, or a support frame',
    },
    {
      value: '4x4',
      label: '4x4 post',
      description: 'A treated 4x4 framing post, for a light porch or a deck post up to 8 ft',
    },
    {
      value: '6x6',
      label: '6x6 post',
      description: 'A treated 6x6 framing post: the post under a porch or a deck beam',
    },
    {
      value: '8x8',
      label: '8x8 post',
      description: 'A treated 8x8 framing post, for a tall post or a heavy load',
    },
  ],
  subscribe,
  value: () => postChoices()?.size ?? 'column',
  set: (value) => {
    if (value !== 'column') {
      armFramingPostTool(value as FramingPostSize)
      return
    }
    // Already placing columns (perhaps a preset following the cursor): nothing to switch.
    if (postChoices() === null) return
    dropInflightColumnPlacement()
    const editor = useEditor.getState()
    editor.setToolDefaults('column', null)
    if (!(editor.mode === 'build' && editor.tool === 'column'))
      editor.armToolMode({ mode: 'build', tool: 'column' })
  },
}

/** What a framing post stands on, shown while the tool places posts. */
export const postBaseOption: ToolOption = {
  id: 'post-base',
  label: 'Base',
  choices: (['none', 'post-base', 'pier'] as const).map((base) => ({
    value: base,
    label: FRAMING_POST_BASE_LABELS[base],
    description:
      base === 'none'
        ? 'Straight on the floor or the footing under it'
        : base === 'post-base'
          ? 'A steel post base holding the wood off the concrete'
          : 'A concrete pier 8 in tall under the post',
  })),
  subscribe,
  value: () => postChoices()?.base ?? 'none',
  set: (value) => armFramingPostTool(undefined, value as ColumnPostBase),
  visible: { subscribe, value: () => postChoices() !== null },
}
