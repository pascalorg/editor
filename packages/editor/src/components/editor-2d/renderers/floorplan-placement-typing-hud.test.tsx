import { afterEach, expect, test } from 'bun:test'
import {
  PLACEMENT_TYPING_LENGTH_ANGLE,
  usePlacementTyping,
} from '../../../store/use-placement-typing'
import { renderCurrentMarkup } from '../../../test-utils/render-current-markup'
import { FloorplanPlacementTypingHud } from './floorplan-placement-typing-hud'

afterEach(() => {
  usePlacementTyping.getState().clear()
})

test('sizes and counter-rotates the HUD from the props it is given', () => {
  usePlacementTyping.getState().begin({ labels: PLACEMENT_TYPING_LENGTH_ANGLE, activeField: 0 })

  const markup = renderCurrentMarkup(
    <svg>
      <FloorplanPlacementTypingHud sceneRotationDeg={30} unitsPerPixel={0.02} x={1} y={2} />
    </svg>,
  )

  expect(markup).toContain('transform="translate(1 2) rotate(-30)"')
  expect(markup).toMatch(/<foreignObject[^>]*width="4.72"/)
  expect(markup).toContain('scale(0.02)')
})

test('renders nothing without a typing session', () => {
  const markup = renderCurrentMarkup(
    <svg>
      <FloorplanPlacementTypingHud sceneRotationDeg={0} unitsPerPixel={0.02} x={0} y={0} />
    </svg>,
  )

  expect(markup).not.toContain('foreignObject')
})
