import { expect, test } from 'bun:test'
import { fileURLToPath } from 'node:url'

test('viewer English formats in production without a provider or catalog registration', () => {
  // A fresh process excludes catalogs registered by other suites and Lingui's dev compiler.
  const registry = fileURLToPath(new URL('./index.ts', import.meta.url))
  const result = Bun.spawnSync(
    [
      'bun',
      '--eval',
      `
        import { createElement } from 'react'
        import { renderToStaticMarkup } from 'react-dom/server'
        import { createI18n, defaultI18n, usePascalI18n } from ${JSON.stringify(registry)}
        if (import.meta.env?.DEV) throw new Error('Development mode is enabled')
        const format = (i18n) => [
          i18n._({
            id: 'viewer.callout.state',
            message: '{state, select, open {Open} closed {Closed} on {On} other {Off}}',
            values: { state: 'closed' },
          }),
          i18n._({
            id: 'viewer.walkthrough.label',
            message: 'Walkthrough: {state}',
            values: { state: 'On' },
          }),
          i18n._({
            id: 'core.level.floorNumber',
            message: 'Floor {number}',
            values: { number: 2 },
          }),
          i18n._({
            id: 'node.shared.runHangerInspector.supportLabel',
            message: 'Hanger {number} support',
            values: { number: 3 },
          }),
          i18n._({ id: 'viewer.camera.topView', message: 'Top view' }),
        ]
        function ViewerMessages() {
          return createElement('button', null, format(usePascalI18n()).join(' / '))
        }
        console.log(renderToStaticMarkup(createElement(ViewerMessages)))
        console.log(JSON.stringify(format(createI18n({ locale: 'fr' }))))
        console.log(Object.hasOwn(defaultI18n.i18n.messages, 'viewer.camera.topView'))
      `,
    ],
    { env: { ...process.env, NODE_ENV: 'production' }, stdout: 'pipe', stderr: 'pipe' },
  )

  expect(result.exitCode).toBe(0)
  expect(result.stdout.toString().trim().split('\n')).toEqual([
    '<button>Closed / Walkthrough: On / Floor 2 / Hanger 3 support / Top view</button>',
    '["Closed","Walkthrough: On","Floor 2","Hanger 3 support","Top view"]',
    'false',
  ])
})
