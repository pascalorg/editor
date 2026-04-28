'use client'

import { useState } from 'react'
import { signIn } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import Link from 'next/link'
import { Box, ArrowRight, AlertCircle } from 'lucide-react'

type Mode = 'signin' | 'signup'

export default function AuthPage() {
  const [mode, setMode] = useState<Mode>('signin')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const router = useRouter()

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
      router.push('/dashboard')
      router.refresh()
    }
  }

  const switchMode = (m: Mode) => {
    setMode(m)
    setError('')
    setPassword('')
    if (m === 'signin') setName('')
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
