'use client'

import { PascalI18nProvider, usePascalI18n } from '@pascal-app/core'
import { Html as DreiHtml } from '@react-three/drei'
import * as ReactDOMClient from 'react-dom/client'
import { type ComponentProps, forwardRef } from 'react'

// React 19 / Drei Html compatibility:
// @react-three/drei's Html unmounts its root synchronously inside useLayoutEffect cleanup.
// In React 19, calling root.unmount() synchronously while React is rendering triggers:
// "Attempted to synchronously unmount a root while React was already rendering".
// Deferring root.unmount() via setTimeout(() => ..., 0) completely avoids this race condition.
if (typeof window !== 'undefined') {
  try {
    const rdc = ReactDOMClient as any
    const originalCreateRoot = rdc.createRoot
    if (typeof originalCreateRoot === 'function' && !originalCreateRoot.__react19Patched) {
      const patchedCreateRoot = function (...args: any[]) {
        const root = originalCreateRoot.apply(this, args)
        const originalUnmount = root.unmount.bind(root)
        root.unmount = function () {
          setTimeout(() => {
            try {
              originalUnmount()
            } catch {
              // Root may already have unmounted
            }
          }, 0)
        }
        return root
      }
      patchedCreateRoot.__react19Patched = true
      rdc.createRoot = patchedCreateRoot
    }
  } catch {
    // Read-only or unsupported environment
  }
}

/**
 * drei's `Html`, keeping the editor's i18n scope. `Html` renders its children
 * in a separate React root, which sees none of the surrounding context, so a
 * component inside it would translate with the default (English) scope instead
 * of the editor's `?lang=` or `<Editor locale>` one.
 */
export const Html = forwardRef<HTMLDivElement, Omit<ComponentProps<typeof DreiHtml>, 'ref'>>(
  function Html({ children, ...props }, ref) {
    if (typeof document === 'undefined' || typeof document.createElement !== 'function') {
      return null
    }
    const i18n = usePascalI18n()
    return (
      <DreiHtml {...props} ref={ref}>
        <PascalI18nProvider i18n={i18n}>{children}</PascalI18nProvider>
      </DreiHtml>
    )
  },
)
