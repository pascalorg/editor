import { afterEach, expect, test } from 'bun:test'
import { useViewer } from '@pascal-app/viewer'
import useEditor from '../../../store/use-editor'
import { activeViewLayout, VIEW_3D } from '../../../store/view-layout'
import { renderCurrentMarkup } from '../../../test-utils/render-current-markup'
import { GroundModeToggle, leaveUnavailableView, ViewTabs } from './view-bar'

const saved = useViewer.getState()

afterEach(() => {
  useViewer.setState(saved, true)
})

test('over a level at grade the bar says nothing about the ground', () => {
  useViewer.setState({ belowGrade: false })
  expect(renderCurrentMarkup(<GroundModeToggle />)).toBe('')
})

test('over a level below grade the bar says the ground is veiled, the ground on Auto', () => {
  useViewer.setState({ belowGrade: true, gradeStanding: 'below-grade', groundMode: 'auto' })
  const bar = renderCurrentMarkup(<GroundModeToggle />)
  expect(bar).toContain('Below grade · ground veiled')
  expect(bar).toMatch(/aria-pressed="true"[^>]*>Auto</)
})

test('the person who keeps the ground solid is told so', () => {
  useViewer.setState({ belowGrade: true, gradeStanding: 'below-grade', groundMode: 'solid' })
  const bar = renderCurrentMarkup(<GroundModeToggle />)
  expect(bar).toContain('Below grade · ground solid')
  expect(bar).toMatch(/aria-pressed="true"[^>]*>Solid</)
})

test('a level only partly below grade is named as such, its ground veiled where the hill stands', () => {
  useViewer.setState({
    belowGrade: true,
    gradeStanding: 'partly-below-grade',
    groundWindowVeiled: true,
    groundMode: 'auto',
  })
  expect(renderCurrentMarkup(<GroundModeToggle />)).toContain('Partly below grade · ground veiled')
  // From the walk-out side nothing is in the way: the ground reads solid, the toggle stays.
  useViewer.setState({ groundWindowVeiled: false })
  expect(renderCurrentMarkup(<GroundModeToggle />)).toContain('Partly below grade · ground solid')
})

test("a hillside in the eye's way over a level at grade says only that the ground is veiled", () => {
  useViewer.setState({
    belowGrade: false,
    gradeStanding: 'at-grade',
    groundWindowVeiled: true,
    groundMode: 'auto',
  })
  expect(renderCurrentMarkup(<GroundModeToggle />)).toContain('Ground veiled')
  useViewer.setState({ groundMode: 'solid' })
  expect(renderCurrentMarkup(<GroundModeToggle />)).toContain('Ground solid')
})

test('a view this project cannot show still gets its tab, flagged, beside 3D and 2D', () => {
  const editor = useEditor.getState()
  editor.setPaneView(0, 'plugin-gone:board')
  try {
    const bar = renderCurrentMarkup(<ViewTabs pane={0} />)
    expect(bar).toContain('Unavailable view')
    expect(bar).toContain('aria-label="Close this view"')
    expect(bar).toMatch(/aria-selected="true"[^>]*title="Unavailable view isn&#x27;t available/)
    leaveUnavailableView(0)
    expect(activeViewLayout(useEditor.getState()).panes[0]).toBe(VIEW_3D)
  } finally {
    editor.setPaneView(0, VIEW_3D)
  }
})
