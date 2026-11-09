import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { AppCard } from '@/components/app-shell'
import { resolvePublicUrl } from '@/lib/public-url'
import { safeNextPath } from '@/lib/safe-next-path'
import { LoginForm } from './login-form'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Sign in · Pascal' }

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>
}) {
  const { next } = await searchParams
  const origin = resolvePublicUrl(
    new Request('http://localhost/login', { headers: await headers() }),
  )
  return (
    <AppCard>
      <h1 className="mt-6 font-semibold text-lg">Sign in to this editor</h1>
      <p className="mt-1 text-muted-foreground text-sm">
        Enter the admin password set for this instance.
      </p>
      <LoginForm next={safeNextPath(next, origin)} />
    </AppCard>
  )
}
