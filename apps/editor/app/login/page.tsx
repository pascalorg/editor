'use client'

import { Suspense, useState, useEffect } from 'react'
import { signIn } from 'next-auth/react'
import { useRouter, useSearchParams } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import Link from 'next/link'
import { Box, ArrowRight, AlertCircle } from 'lucide-react'

type Mode = 'signin' | 'signup'

const OAUTH_ERROR_MESSAGES: { [key: string]: string | undefined; Default: string } = {
  OAuthAccountNotLinked: 'This email is already registered. Please sign in with your password first.',
  OAuthSignin: 'Could not start Google sign-in. Please try again.',
  Callback: 'Something went wrong during Google sign-in. Please try again.',
  Default: 'An error occurred during Google sign-in. Please try again.',
}

function AuthPageInner() {
  const [mode, setMode] = useState<Mode>('signin')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)
  const [error, setError] = useState('')
  const router = useRouter()
  const searchParams = useSearchParams()

  const [resetSuccess, setResetSuccess] = useState(false)

  useEffect(() => {
    const oauthError = searchParams.get('error')
    if (oauthError) {
      setError(OAUTH_ERROR_MESSAGES[oauthError] ?? OAUTH_ERROR_MESSAGES['Default'])
    }
    if (searchParams.get('reset') === 'success') {
      setResetSuccess(true)
    }
  }, [searchParams])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    if (mode === 'signup') {
      const res = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, name }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Could not create account. Try again.')
        setLoading(false)
        return
      }
    }

    const res = await signIn('credentials', { redirect: false, email, password })

    if (res?.error) {
      setError(mode === 'signin' ? 'Incorrect email or password.' : 'Account created but sign-in failed. Try signing in.')
      setLoading(false)
    } else if (res?.ok) {
      router.push(mode === 'signup' ? '/onboarding' : '/dashboard')
      router.refresh()
    }
  }

  const switchMode = (m: Mode) => {
    setMode(m)
    setError('')
    setPassword('')
    if (m === 'signin') setName('')
  }

  const handleGoogleSignIn = async () => {
    setGoogleLoading(true)
    await signIn('google', { callbackUrl: '/onboarding' })
    // NextAuth redirects — reset only on error (unmount handles the rest)
    setGoogleLoading(false)
  }

  return (
    <div className="min-h-screen bg-[#050505] flex flex-col items-center justify-center p-4 relative overflow-hidden">
      <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[500px] bg-indigo-600/5 blur-[160px] rounded-full pointer-events-none" />

      <Link href="/" className="flex items-center gap-2 mb-10 z-10">
        <div className="w-8 h-8 bg-gradient-to-br from-indigo-500 to-violet-600 rounded-lg flex items-center justify-center shadow-lg shadow-indigo-500/20">
          <Box className="w-5 h-5 text-white" />
        </div>
        <span className="font-bold tracking-tight text-white text-xl">archly</span>
      </Link>

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="w-full max-w-sm z-10"
      >
        {/* Mode switcher */}
        <div className="flex bg-white/[0.04] border border-white/[0.07] rounded-xl p-1 mb-5">
          {(['signin', 'signup'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => switchMode(m)}
              className={`flex-1 py-2 text-sm font-medium rounded-lg transition-all duration-200 ${
                mode === m
                  ? 'bg-white/[0.09] text-white shadow-sm'
                  : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              {m === 'signin' ? 'Sign in' : 'Sign up'}
            </button>
          ))}
        </div>

        <div className="bg-white/[0.03] border border-white/[0.08] rounded-2xl p-6 backdrop-blur-sm">
          <AnimatePresence mode="wait">
            <motion.div
              key={mode}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.15 }}
            >
              <h1 className="text-lg font-bold text-white mb-0.5">
                {mode === 'signin' ? 'Welcome back' : 'Create your account'}
              </h1>
              <p className="text-zinc-500 text-sm mb-5">
                {mode === 'signin'
                  ? 'Sign in to continue to archly'
                  : 'Free to start. No credit card required.'}
              </p>
            </motion.div>
          </AnimatePresence>

          {resetSuccess && (
            <div className="mb-4 p-3 bg-green-500/10 border border-green-500/20 text-green-400 text-xs rounded-xl">
              Password updated. Sign in with your new password.
            </div>
          )}

          {error && (
            <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 text-red-400 text-xs rounded-xl flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-3">
            <AnimatePresence>
              {mode === 'signup' && (
                <motion.div
                  initial={{ opacity: 0, height: 0, marginBottom: 0 }}
                  animate={{ opacity: 1, height: 'auto', marginBottom: 0 }}
                  exit={{ opacity: 0, height: 0, marginBottom: 0 }}
                  transition={{ duration: 0.2 }}
                  className="overflow-hidden"
                >
                  <input
                    type="text"
                    required={mode === 'signup'}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Full name"
                    autoComplete="name"
                    className="w-full bg-white/[0.04] border border-white/[0.08] text-white rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-indigo-500/40 transition-all placeholder:text-zinc-600 mb-3"
                  />
                </motion.div>
              )}
            </AnimatePresence>

            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email address"
              autoComplete="email"
              className="w-full bg-white/[0.04] border border-white/[0.08] text-white rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-indigo-500/40 transition-all placeholder:text-zinc-600"
            />
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={mode === 'signup' ? 'Password (8+ characters)' : 'Password'}
              autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
              minLength={mode === 'signup' ? 8 : undefined}
              className="w-full bg-white/[0.04] border border-white/[0.08] text-white rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-indigo-500/40 transition-all placeholder:text-zinc-600"
            />

            {mode === 'signin' && (
              <div className="flex justify-end">
                <Link href="/forgot-password" className="text-sm text-zinc-500 hover:text-zinc-300 transition-colors">
                  Forgot password?
                </Link>
              </div>
            )}

            <button
              type="submit"
              disabled={loading || !email || !password || (mode === 'signup' && !name)}
              className="w-full mt-1 bg-gradient-to-r from-indigo-500 to-violet-600 hover:opacity-90 text-white font-medium py-2.5 rounded-xl flex items-center justify-center gap-2 text-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed shadow-lg shadow-indigo-500/15"
            >
              {loading ? (
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <>
                  {mode === 'signin' ? 'Continue' : 'Create account'}
                  <ArrowRight size={15} />
                </>
              )}
            </button>
          </form>

          <div className="my-4 flex items-center gap-3">
            <div className="h-px flex-1 bg-white/[0.06]" />
            <span className="text-xs text-zinc-600">or</span>
            <div className="h-px flex-1 bg-white/[0.06]" />
          </div>

          <button
            type="button"
            onClick={handleGoogleSignIn}
            disabled={googleLoading}
            className="w-full bg-white/[0.05] hover:bg-white/[0.09] border border-white/[0.08] text-white font-medium py-2.5 rounded-xl flex items-center justify-center gap-2.5 text-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {googleLoading ? (
              <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <>
                <svg width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                  <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z" fill="#4285F4"/>
                  <path d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.258c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" fill="#34A853"/>
                  <path d="M3.964 10.707A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.707V4.961H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.039l3.007-2.332z" fill="#FBBC05"/>
                  <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.961L3.964 7.293C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
                </svg>
                Continue with Google
              </>
            )}
          </button>
        </div>

        <p className="mt-5 text-center text-xs text-zinc-600">
          By continuing, you agree to our{' '}
          <Link href="/terms" className="text-zinc-500 hover:text-zinc-300 transition-colors">Terms</Link>
          {' '}and{' '}
          <Link href="/privacy" className="text-zinc-500 hover:text-zinc-300 transition-colors">Privacy Policy</Link>
        </p>
      </motion.div>
    </div>
  )
}

export default function AuthPage() {
  return (
    <Suspense>
      <AuthPageInner />
    </Suspense>
  )
}
