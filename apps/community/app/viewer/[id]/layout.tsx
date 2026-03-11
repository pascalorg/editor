import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Project Viewer',
  description: 'View and share 3D projects built with Pascal Editor.',
}

export default function ViewerLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return children
}
