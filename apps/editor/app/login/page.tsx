import type { Metadata } from 'next'
import { AppCard } from '@/components/app-shell'
import { LoginForm } from './login-form'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Sign in · Pascal' }

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>
}) {
  const { next } = await searchParams
  return (
    <AppCard>
      <h1 className="mt-6 font-semibold text-lg">Sign in to this editor</h1>
      <p className="mt-1 text-muted-foreground text-sm">
        Enter the admin password set for this instance.
      </p>
      <LoginForm next={safeNextPath(next)} />
    </AppCard>
  )
}

/** Only same-origin paths may be used as the post-login destination. */
function safeNextPath(next: string | undefined): string {
  if (!next?.startsWith('/') || next.startsWith('//')) return '/'
  return next
}
