import { LoginForm } from './login-form'

export const dynamic = 'force-dynamic'

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>
}) {
  const { next } = await searchParams
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-sm rounded-2xl border border-border/60 bg-background p-6 shadow-xl">
        <p className="font-mono text-muted-foreground text-xs uppercase tracking-wide">Pascal</p>
        <h1 className="mt-2 font-semibold text-lg">Sign in to this editor</h1>
        <p className="mt-1 text-muted-foreground text-sm">
          Enter the admin password set for this instance.
        </p>
        <LoginForm next={safeNextPath(next)} />
      </div>
    </div>
  )
}

/** Only same-origin paths may be used as the post-login destination. */
function safeNextPath(next: string | undefined): string {
  if (!next?.startsWith('/') || next.startsWith('//')) return '/scenes'
  return next
}
