'use client'

import { PascalI18nProvider, usePascalI18n } from '@pascal-app/core'
import { Html as DreiHtml } from '@react-three/drei'
import { type ComponentProps, forwardRef } from 'react'

/**
 * drei's `Html`, keeping the editor's i18n scope. `Html` renders its children
 * in a separate React root, which sees none of the surrounding context, so a
 * component inside it would translate with the default (English) scope instead
 * of the editor's `?lang=` or `<Editor locale>` one.
 */
export const Html = forwardRef<HTMLDivElement, Omit<ComponentProps<typeof DreiHtml>, 'ref'>>(
  function Html({ children, ...props }, ref) {
    const i18n = usePascalI18n()
    return (
      <DreiHtml {...props} ref={ref}>
        <PascalI18nProvider i18n={i18n}>{children}</PascalI18nProvider>
      </DreiHtml>
    )
  },
)
