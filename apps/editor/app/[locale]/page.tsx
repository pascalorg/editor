'use client'

import { Editor } from '@pascal-app/editor'
import { LanguageSwitcher } from '../../components/language-switcher'

export default function Home() {
  return (
    <div className="relative h-screen w-screen">
      <Editor projectId="local-editor" />
      <div className="absolute top-4 right-4 z-50">
        <LanguageSwitcher />
      </div>
    </div>
  )
}
