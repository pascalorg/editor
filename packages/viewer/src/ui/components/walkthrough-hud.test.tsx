import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { DroneHud, WalkthroughHud } from '../../ui'

const seenInteract = { kind: 'door', label: 'Front door', verb: 'open', distance: 4 }

test('the default HUD keeps its dot and output; the come-closer prompt is opt-in', () => {
  const original = renderToStaticMarkup(<WalkthroughHud />)
  expect(renderToStaticMarkup(<WalkthroughHud seenInteract={seenInteract} />)).toBe(original)
  expect(original).toContain('data-walkthrough-crosshair')
  const optedIn = renderToStaticMarkup(
    <WalkthroughHud seenInteract={seenInteract} comeCloserLabel="Come a little closer" />,
  )
  expect(optedIn).toContain('Front door · Come a little closer')
  expect(optedIn).not.toContain('or click to')
})

test('extraHints stay visible and clickable when cursor is freed (suspended) in both Walk and Drone HUDs', () => {
  const extraHints = [{ keys: ['C'], action: 'comment', onClick: () => {} }]

  const walkActive = renderToStaticMarkup(<WalkthroughHud extraHints={extraHints} />)
  expect(walkActive).toContain('<button')
  expect(walkActive).toContain('comment')
  expect(walkActive).toContain('free cursor')

  const walkSuspended = renderToStaticMarkup(
    <WalkthroughHud extraHints={extraHints} onExit={() => {}} suspended />,
  )
  expect(walkSuspended).toContain('to resume')
  expect(walkSuspended).toContain('comment')
  expect(walkSuspended).toContain('<button')
  expect(walkSuspended).toContain('to exit')

  const droneSuspended = renderToStaticMarkup(
    <DroneHud extraHints={extraHints} onExit={() => {}} suspended />,
  )
  expect(droneSuspended).toContain('to resume')
  expect(droneSuspended).toContain('comment')
  expect(droneSuspended).toContain('<button')
})
