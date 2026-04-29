'use client'

import { Suspense, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { Box, ArrowRight, AlertCircle } from 'lucide-react'
import { motion } from 'framer-motion'

function ResetPasswordForm() {
  const searchParams = useSearchParams()
  const token = searchParams.get('token')
  const router = useRouter()

  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [fieldError, setFieldError] = useState('')
  const [success, setSuccess] = useState('')

  if (!token) {
    return (
      <div className="text-center">
        <p className="text-zinc-400 text-sm mb-4">
          This link is invalid. Request a new one.
        </p>
        <Link
          href="/forgot-password"
          className="text-sm text-indigo-400 hover:text-indigo-300 transition-colors"
        >
          Request a new reset link
        </Link>
      </div>
    )
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setFieldError('')
    setError('')

    if (newPassword.length < 8) {
      setFieldError('Password must be at least 8 characters.')
      return
    }
    if (newPassword !== confirmPassword) {
      setFieldError('Passwords do not match.')
      return
    }

    setLoading(true)

    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, newPassword }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Failed to reset password')
        setLoading(false)
        return
      }
      setSuccess('Password updated. Redirecting to sign in\u2026')
      setTimeout(() => router.push('/login?reset=success'), 1500)
    } catch {
      setError('Network error. Please try again.')
      setLoading(false)
    }
  }

  return (
    <>
      <h1 className="text-lg font-bold text-white mb-0.5">Set a new password</h1>
      <p className="text-zinc-500 text-sm mb-5">
        Choose a strong password of at least 8 characters.
      </p>

      {error && (
        <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 text-red-400 text-xs rounded-xl flex items-start gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          {error}
        </div>
      )}

      {success && (
        <div className="mb-4 p-3 bg-green-500/10 border border-green-500/20 text-green-400 text-xs rounded-xl">
          {success}
        </div>
      )}

      {!success && (
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <input
              type="password"
              required
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="New password (8+ characters)"
              autoComplete="new-password"
              minLength={8}
              className="w-full bg-white/[0.04] border border-white/[0.08] text-white rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-indigo-500/40 transition-all placeholder:text-zinc-600"
            />
          </div>
          <div>
            <input
              type="password"
              required
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Confirm new password"
              autoComplete="new-password"
              className="w-full bg-white/[0.04] border border-white/[0.08] text-white rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-indigo-500/40 transition-all placeholder:text-zinc-600"
            />
          </div>

          {fieldError && (
            <p className="text-red-400 text-xs">{fieldError}</p>
          )}

          <button
            type="submit"
            disabled={loading || !newPassword || !confirmPassword}
            className="w-full mt-1 bg-gradient-to-r from-indigo-500 to-violet-600 hover:opacity-90 text-white font-medium py-2.5 rounded-xl flex items-center justify-center gap-2 text-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed shadow-lg shadow-indigo-500/15"
          >
            {loading ? (
              <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <>
                Update password
                <ArrowRight size={15} />
              </>
            )}
          </button>
        </form>
      )}

      <Link
        href="/login"
        className="mt-4 block text-sm text-zinc-500 hover:text-zinc-300 transition-colors text-center"
      >
        Back to sign in
      </Link>
    </>
  )
}

export default function ResetPasswordPage() {
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
          <Suspense fallback={<div className="text-zinc-500 text-sm text-center">Loading…</div>}>
            <ResetPasswordForm />
          </Suspense>
        </div>
      </motion.div>
    </div>
  )
}
