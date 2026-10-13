import { afterEach, expect, test } from 'bun:test'
import { useViewer } from '@pascal-app/viewer'
import { renderCurrentMarkup } from '../../../test-utils/render-current-markup'
import { GroundModeToggle } from './view-bar'

const saved = useViewer.getState()

afterEach(() => {
  useViewer.setState(saved, true)
})

test('over a level at grade the bar says nothing about the ground', () => {
  useViewer.setState({ belowGrade: false })
  expect(renderCurrentMarkup(<GroundModeToggle />)).toBe('')
})

test('over a level below grade the bar says the ground is veiled, the ground on Auto', () => {
  useViewer.setState({ belowGrade: true, groundMode: 'auto' })
  const bar = renderCurrentMarkup(<GroundModeToggle />)
  expect(bar).toContain('Below grade · ground veiled')
  expect(bar).toMatch(/aria-pressed="true"[^>]*>Auto</)
})

test('the person who keeps the ground solid is told so', () => {
  useViewer.setState({ belowGrade: true, groundMode: 'solid' })
  const bar = renderCurrentMarkup(<GroundModeToggle />)
  expect(bar).toContain('Below grade · ground solid')
  expect(bar).toMatch(/aria-pressed="true"[^>]*>Solid</)
})
