import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Pascal Home Assistant',
  description: 'Create a Pascal house locally and export it as a Home Assistant Lovelace card.',
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html className="dark" lang="en">
      <body>{children}</body>
    </html>
  )
}
