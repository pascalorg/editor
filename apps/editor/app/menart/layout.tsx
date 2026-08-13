import type { Metadata } from 'next'
import { Archivo } from 'next/font/google'
import './menart.css'

// `latin-ext` carries the Turkish dotless ı, ğ and ş the UI copy depends on.
const archivo = Archivo({
  subsets: ['latin', 'latin-ext'],
  weight: ['400', '600', '800'],
  variable: '--font-archivo',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'Menart 3D',
  description: 'Menart 3D kat planı ve model editörü.',
}

export default function MenartLayout({ children }: { children: React.ReactNode }) {
  return <div className={archivo.variable}>{children}</div>
}
