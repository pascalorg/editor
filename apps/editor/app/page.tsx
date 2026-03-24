'use client'

import { Editor } from '@pascal-app/editor'

export default function Home() {
  return (
    <div className="h-screen w-screen">
      <Editor projectId="local-editor" />
    </div>
  )
}
