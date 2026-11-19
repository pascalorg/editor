import { afterEach, expect, test } from 'bun:test'
import type { ToolHint } from '@pascal-app/core'
import { TooltipProvider } from '@pascal-app/viewer/ui'
import useEditor from '../../../store/use-editor'
import { renderCurrentMarkup } from '../../../test-utils/render-current-markup'
import { RegisteredToolHelper } from './registered-tool-helper'

// The card of a tool that draws an outline: what the next click does first, and the finishing
// key as soon as there is something to finish, without having to unfold the card.
const hints: ToolHint[] = [
  { key: 'Left click', label: 'Add an outline point' },
  { key: 'Enter', label: 'Finish the outline', minDraftVertices: 3 },
  { key: 'Backspace', label: 'Take the last point back' },
  { key: 'Esc', label: 'Cancel' },
]
const saved = useEditor.getState().draftVertexCount
afterEach(() => useEditor.getState().setDraftVertexCount(saved))

function card(points: number) {
  useEditor.getState().setDraftVertexCount(points)
  return renderCurrentMarkup(
    <TooltipProvider>
      <RegisteredToolHelper hints={hints} />
    </TooltipProvider>,
  )
}

test('the finishing key is absent while the outline cannot be finished, and shown unfolded once it can', () => {
  const early = card(2)
  expect(early).toContain('Add an outline point')
  expect(early).not.toContain('Finish the outline')
  expect(early).toContain('aria-expanded="false"')
  const ready = card(3)
  expect(ready).toContain('Add an outline point')
  expect(ready).toContain('Finish the outline')
  // The card is still folded: the other shortcuts stay behind "More shortcuts".
  expect(ready).toContain('aria-expanded="false"')
  expect(ready).toContain('More shortcuts')
  expect(ready).not.toContain('Take the last point back')
  expect(ready).toContain('Cancel')
})
