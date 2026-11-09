import { expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import tailwindcss from '@tailwindcss/postcss'
import postcss from 'postcss'

const stylesheet = new URL('../app/globals.css', import.meta.url)

test('the editor stylesheet emits shared layout, theme and reduced-motion styles', async () => {
  const result = await postcss([tailwindcss()]).process(await readFile(stylesheet, 'utf8'), {
    from: stylesheet.pathname,
  })

  expect(result.warnings()).toEqual([])
  expect(result.css).not.toContain('@apply')
  expect(result.css).toContain('.flex')
  expect(result.css).toContain('var(--background)')
  expect(result.css).toContain('prefers-reduced-motion')
})

test('zero spacing remains a length in calc and shadows support fractional opacity', async () => {
  const result = await postcss([tailwindcss({ optimize: false })]).process(
    '@import "tailwindcss"; @source inline("w-[calc(--spacing(0)+1px)] shadow-sm/12.5");',
    { from: stylesheet.pathname },
  )
  const values: string[] = []
  result.root.walkDecls((declaration) => {
    values.push(declaration.value)
  })

  expect(values).toContain('calc(0px + 1px)')
  expect(values.some((value) => value.includes('12.5%'))).toBe(true)
})
