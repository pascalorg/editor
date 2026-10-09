'use client'

import { createContext, type ReactNode, useContext } from 'react'

export type DisplayTextTranslator = (text: string) => string

const identity: DisplayTextTranslator = (text) => text
const DisplayTextContext = createContext<DisplayTextTranslator>(identity)

export function DisplayTextProvider({
  children,
  translate = identity,
}: {
  children: ReactNode
  translate?: DisplayTextTranslator
}) {
  return <DisplayTextContext.Provider value={translate}>{children}</DisplayTextContext.Provider>
}

export function useDisplayText(): DisplayTextTranslator {
  return useContext(DisplayTextContext)
}
