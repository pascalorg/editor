'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Box, ArrowRight, AlertCircle } from 'lucide-react'
import { motion } from 'framer-motion'

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [resetUrl, setResetUrl] = useState<string | undefined>(undefined)
  const [copied, setCopied] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Something went wrong. Please try again.')
        setLoading(false)
        return
      }
      setResetUrl(data.resetUrl)
      setSubmitted(true)
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const handleCopy = () => {
    if (resetUrl) {
      navigator.clipboard.writeText(resetUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
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
        <div className="bg-white/[0.03] border border-white/[0.08] rounded-2xl p-6 backdrop-blur-sm">
          {!submitted ? (
            <>
              <h1 className="text-lg font-bold text-white mb-0.5">Forgot your password?</h1>
              <p className="text-zinc-500 text-sm mb-5">
                Enter your email and we&apos;ll generate a reset link.
              </p>

              {error && (
                <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 text-red-400 text-xs rounded-xl flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  {error}
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-3">
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Email address"
                  autoComplete="email"
                  className="w-full bg-white/[0.04] border border-white/[0.08] text-white rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-indigo-500/40 transition-all placeholder:text-zinc-600"
                />

                <button
                  type="submit"
                  disabled={loading || !email}
                  className="w-full mt-1 bg-gradient-to-r from-indigo-500 to-violet-600 hover:opacity-90 text-white font-medium py-2.5 rounded-xl flex items-center justify-center gap-2 text-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed shadow-lg shadow-indigo-500/15"
                >
                  {loading ? (
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : (
                    <>
                      Send reset link
                      <ArrowRight size={15} />
                    </>
                  )}
                </button>
              </form>
            </>
          ) : (
            <>
              <h1 className="text-lg font-bold text-white mb-0.5">Check your inbox</h1>
              <p className="text-zinc-400 text-sm mb-4">
                If an account exists for that email, a reset link has been generated.
              </p>

              {resetUrl && (
                <div className="p-4 bg-amber-500/10 border border-amber-500/20 rounded-xl mb-4">
                  <p className="text-amber-400 text-xs font-semibold mb-1">Dev mode (v1)</p>
                  <p className="text-zinc-400 text-xs mb-3">
                    Email isn&apos;t wired up yet. Use this link to reset your password:
                  </p>
                  <a
                    href={resetUrl}
                    className="block text-indigo-400 text-xs break-all hover:text-indigo-300 transition-colors mb-3"
                  >
                    {resetUrl}
                  </a>
                  <button
                    type="button"
                    onClick={handleCopy}
                    className="text-xs bg-white/[0.06] hover:bg-white/[0.1] border border-white/[0.08] text-white px-3 py-1.5 rounded-lg transition-all"
                  >
                    {copied ? 'Copied!' : 'Copy link'}
                  </button>
                </div>
              )}
            </>
          )}

          <Link
            href="/login"
            className="mt-4 block text-sm text-zinc-500 hover:text-zinc-300 transition-colors text-center"
          >
            Back to sign in
          </Link>
        </div>
      </motion.div>
    </div>
  )
}
