import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Editor Workspace',
  description: 'Edit your Pascal projects in a full 3D workspace.',
  robots: {
    index: false,
    follow: false,
  },
}

export default function EditorProjectLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <div style={{ cursor: "url('/cursor.svg') 4 2, default" }}>
      {children}
    </div>
  )
}
