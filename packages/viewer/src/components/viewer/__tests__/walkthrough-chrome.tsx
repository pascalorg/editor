import { mock } from 'bun:test'
import * as drei from '@react-three/drei'
import { extend } from '@react-three/fiber'
import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Group } from 'three'

// Only the isolated child process uses this in-memory chrome renderer. All input,
// targeting, animation and React event handlers are the actual package components.
class Button extends Group {
  override type = 'button'
}
class Div extends Group {
  override type = 'div'
}
extend({ Button, Div })
require('@react-three/fiber').extend({ Button, Div })
const warn = console.warn
console.warn = (...args) => {
  if (String(args[0]).startsWith('Text is not allowed in the R3F tree!')) return
  warn(...args)
}
mock.module('@react-three/drei', () => ({
  ...drei,
  Html: ({ children }: { children: ReactNode }) => (
    <group userData={{ html: renderToStaticMarkup(children) }} />
  ),
}))
