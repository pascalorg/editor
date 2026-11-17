import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { WalkthroughHud } from '../../ui'

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
