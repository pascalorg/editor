'use client'

import { LocalizedContent as EditorLocalizedContent } from '@pascal-app/editor'
import type { ReactNode } from 'react'

export function LocalizedContent({ children }: { children: ReactNode }) {
  return <EditorLocalizedContent>{children}</EditorLocalizedContent>
}
