import { afterEach, beforeEach, expect, test } from 'bun:test'
import { useFirstPersonHud, useViewer } from '@pascal-app/viewer'
import { WalkthroughHud, WalkthroughTouchControls } from '@pascal-app/viewer/ui'
import { renderToStaticMarkup } from 'react-dom/server'

const initialState = { ...useViewer.getInitialState() }
const initialHud = { ...useFirstPersonHud.getInitialState() }
beforeEach(() => {
  // SSR normally sees the initial snapshot; these cases exercise a host's active touch session.
  useViewer.getState().setWalkthroughInputMode('touch')
  useViewer.getState().setWalkthroughMode(true)
  useFirstPersonHud.getState().reset()
  Object.assign(useViewer.getInitialState(), useViewer.getState())
  Object.assign(useFirstPersonHud.getInitialState(), useFirstPersonHud.getState())
})
afterEach(() => {
  Object.assign(useViewer.getInitialState(), initialState)
  Object.assign(useFirstPersonHud.getInitialState(), initialHud)
  useViewer.getState().setWalkthroughMode(false)
  useViewer.getState().setWalkthroughInputMode('desktop')
})

test('touch controls expose two surfaces and disable Interact until the HUD has a target', () => {
  const empty = renderToStaticMarkup(<WalkthroughTouchControls className="host-skin" />)
  expect(empty).toContain('data-walkthrough-stick')
  expect(empty).toContain('data-walkthrough-look')
  expect(empty).toContain('touch-action:none')
  expect(empty).toContain('host-skin')
  expect(empty).toMatch(/disabled=""[^>]*>Interact<\/button>/)
  expect(empty).toContain('>Jump</button>')
  expect(empty).toContain('>Exit</button>')
  expect(empty).toContain('>Crouch</button>')
  expect(empty).not.toContain('>Shutters</button>')
  expect(empty).not.toContain('>Close</button>')
  useFirstPersonHud.getState().setHud({ interact: { label: 'door', verb: 'open' } })
  Object.assign(useFirstPersonHud.getInitialState(), useFirstPersonHud.getState())
  expect(renderToStaticMarkup(<WalkthroughTouchControls />)).not.toContain('disabled=""')
})

test('controls are opt-in and keyboard hints disappear from the touch HUD', () => {
  const props = {
    hints: [{ keys: ['WASD'], action: 'move' }],
    interact: { label: 'door', verb: 'open' },
  }
  const touch = renderToStaticMarkup(<WalkthroughHud {...props} />)
  expect(touch).toContain('data-walkthrough-crosshair')
  expect(touch).not.toContain('<kbd')
  useViewer.getState().setWalkthroughInputMode('desktop')
  Object.assign(useViewer.getInitialState(), useViewer.getState())
  expect(renderToStaticMarkup(<WalkthroughTouchControls />)).toBe('')
  expect(renderToStaticMarkup(<WalkthroughHud {...props} />)).toContain('WASD')
  useViewer.getState().setWalkthroughInputMode('touch')
  useViewer.getState().setWalkthroughMode(false)
  Object.assign(useViewer.getInitialState(), useViewer.getState())
  expect(renderToStaticMarkup(<WalkthroughTouchControls />)).toBe('')
})

test('the shared HUD exposes Shutters and controller-specific Close only when available', () => {
  useFirstPersonHud.getState().setHud({ shuttersInView: true, canClose: true })
  Object.assign(useFirstPersonHud.getInitialState(), useFirstPersonHud.getState())
  const controls = renderToStaticMarkup(<WalkthroughTouchControls />)
  expect(controls).toContain('>Shutters</button>')
  expect(controls).toContain('>Close</button>')
  expect(controls).not.toContain('<kbd')
  useFirstPersonHud.getState().reset()
  Object.assign(useFirstPersonHud.getInitialState(), useFirstPersonHud.getState())
  const cleared = renderToStaticMarkup(<WalkthroughTouchControls />)
  expect(cleared).not.toContain('>Shutters</button>')
  expect(cleared).not.toContain('>Close</button>')
})
