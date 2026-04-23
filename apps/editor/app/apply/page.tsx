'use client'

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { CheckCircle2, Send, Building2, Users, Mail, MessageSquare, AlertCircle, ArrowLeft, ArrowRight, Box, Briefcase, ChevronRight, User } from 'lucide-react'
import Link from 'next/link'
import { submitApplication } from './actions'

const STEPS = ['Organization', 'Contact', 'Use Case']

const INDUSTRIES = [
  'Architecture & Design',
  'Real Estate Development',
  'Construction Management',
  'Interior Design',
  'Urban Planning',
  'Education & Research',
  'Other',
]

export default function ApplyPage() {
  const [step, setStep] = useState(0)
  const [submitted, setSubmitted] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState({
    orgName: '',
    teamSize: '1-5 members',
    industry: '',
    contactName: '',
    contactEmail: '',
    role: '',
    useCase: '',
  })

  const update = (field: string, value: string) => setForm(prev => ({ ...prev, [field]: value }))

  const canAdvance = () => {
    if (step === 0) return form.orgName && form.industry
    if (step === 1) return form.contactName && form.contactEmail
    if (step === 2) return form.useCase
    return false
  }

  const handleSubmit = async () => {
    setLoading(true)
    setError(null)
    const result = await submitApplication({
      orgName: form.orgName,
      contactName: form.contactName,
      contactEmail: form.contactEmail,
      useCase: `[${form.industry}] [${form.role || 'N/A'}] ${form.useCase}`,
      teamSize: form.teamSize,
    })
    if (result.success) {
      setSubmitted(true)
    } else {
      setError(result.error || 'Something went wrong')
    }
    setLoading(false)
  }

  if (submitted) {
    return (
      <div className="min-h-screen bg-[#09090b] flex items-center justify-center p-4">
        <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
          className="max-w-md w-full bg-zinc-900/80 border border-white/[0.08] rounded-2xl p-10 text-center space-y-6">
          <div className="flex justify-center">
            <div className="w-20 h-20 bg-emerald-500/15 rounded-full flex items-center justify-center">
              <CheckCircle2 className="w-10 h-10 text-emerald-400" />
            </div>
          </div>
          <h1 className="text-3xl font-bold text-white">You&apos;re in! 🎉</h1>
          <p className="text-zinc-400">Thank you for joining the Archly beta. We&apos;ll review your application and get back to you within 24 hours.</p>
          <div className="flex flex-col gap-3">
            <Link href="/editor" className="w-full py-3 bg-gradient-to-r from-indigo-500 to-violet-600 text-white font-semibold rounded-xl hover:opacity-90 transition-all text-center">
              Try the Playground Now
            </Link>
            <Link href="/" className="w-full py-3 bg-white/[0.05] border border-white/10 text-white font-medium rounded-xl hover:bg-white/[0.08] transition-colors text-center text-sm">
              Return Home
            </Link>
          </div>
        </motion.div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#09090b] text-white flex flex-col">
      {/* Header */}
      <nav className="border-b border-white/[0.06] px-6 py-4">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <div className="w-7 h-7 bg-gradient-to-br from-indigo-500 to-violet-600 rounded-lg flex items-center justify-center">
              <Box className="w-4 h-4 text-white" />
            </div>
            <span className="font-bold text-sm tracking-tight">archly</span>
          </Link>
          <span className="text-xs text-zinc-500">Already have an account? <Link href="/admin" className="text-indigo-400 hover:text-indigo-300">Sign in</Link></span>
        </div>
      </nav>

      <div className="flex-1 flex flex-col items-center justify-center py-12 px-4">
        <div className="max-w-lg w-full space-y-8">
          {/* Progress */}
          <div className="flex items-center gap-2">
            {STEPS.map((s, i) => (
              <div key={i} className="flex items-center gap-2 flex-1">
                <div className={`flex items-center gap-2 text-xs font-medium ${i <= step ? 'text-indigo-400' : 'text-zinc-600'}`}>
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold ${i < step ? 'bg-indigo-500 text-white' : i === step ? 'border-2 border-indigo-500 text-indigo-400' : 'border border-zinc-700 text-zinc-600'}`}>
                    {i < step ? <CheckCircle2 className="w-3.5 h-3.5" /> : i + 1}
                  </div>
                  <span className="hidden sm:inline">{s}</span>
                </div>
                {i < STEPS.length - 1 && <div className={`flex-1 h-px ${i < step ? 'bg-indigo-500' : 'bg-zinc-800'}`} />}
              </div>
            ))}
          </div>

          {/* Form */}
          <div className="bg-zinc-900/60 border border-white/[0.08] rounded-2xl p-8">
            {error && (
              <div className="bg-red-500/10 border border-red-500/20 text-red-400 px-4 py-3 rounded-xl flex items-center gap-3 mb-6">
                <AlertCircle size={18} /><p className="text-sm font-medium">{error}</p>
              </div>
            )}

            <AnimatePresence mode="wait">
              <motion.div key={step} initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.2 }}>
                {step === 0 && (
                  <div className="space-y-6">
                    <div><h2 className="text-xl font-bold mb-1">Tell us about your organization</h2><p className="text-sm text-zinc-400">We&apos;ll use this to set up your workspace.</p></div>
                    <Field label="Organization Name" icon={<Building2 className="w-4 h-4" />}>
                      <input required value={form.orgName} onChange={e => update('orgName', e.target.value)} type="text" placeholder="Acme Architecture"
                        className="w-full bg-black/40 border border-white/[0.08] rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500/30 transition-all text-sm" />
                    </Field>
                    <Field label="Team Size" icon={<Users className="w-4 h-4" />}>
                      <select value={form.teamSize} onChange={e => update('teamSize', e.target.value)}
                        className="w-full bg-black/40 border border-white/[0.08] rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 transition-all text-sm">
                        <option>1-5 members</option><option>6-20 members</option><option>21-100 members</option><option>100+ members</option>
                      </select>
                    </Field>
                    <Field label="Industry" icon={<Briefcase className="w-4 h-4" />}>
                      <div className="flex flex-wrap gap-2">
                        {INDUSTRIES.map(ind => (
                          <button key={ind} type="button" onClick={() => update('industry', ind)}
                            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${form.industry === ind ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30' : 'bg-white/[0.03] border border-white/[0.08] text-zinc-400 hover:text-white hover:border-white/15'}`}>
                            {ind}
                          </button>
                        ))}
                      </div>
                    </Field>
                  </div>
                )}

                {step === 1 && (
                  <div className="space-y-6">
                    <div><h2 className="text-xl font-bold mb-1">Your contact details</h2><p className="text-sm text-zinc-400">So we can reach you about your application.</p></div>
                    <Field label="Your Name" icon={<User className="w-4 h-4" />}>
                      <input required value={form.contactName} onChange={e => update('contactName', e.target.value)} type="text" placeholder="Jane Doe"
                        className="w-full bg-black/40 border border-white/[0.08] rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500/30 transition-all text-sm" />
                    </Field>
                    <Field label="Work Email" icon={<Mail className="w-4 h-4" />}>
                      <input required value={form.contactEmail} onChange={e => update('contactEmail', e.target.value)} type="email" placeholder="jane@acme.com"
                        className="w-full bg-black/40 border border-white/[0.08] rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500/30 transition-all text-sm" />
                    </Field>
                    <Field label="Your Role (optional)" icon={<Briefcase className="w-4 h-4" />}>
                      <input value={form.role} onChange={e => update('role', e.target.value)} type="text" placeholder="Lead Architect"
                        className="w-full bg-black/40 border border-white/[0.08] rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500/30 transition-all text-sm" />
                    </Field>
                  </div>
                )}

                {step === 2 && (
                  <div className="space-y-6">
                    <div><h2 className="text-xl font-bold mb-1">How will your team use Archly?</h2><p className="text-sm text-zinc-400">Help us tailor your experience.</p></div>
                    <Field label="Describe your use case" icon={<MessageSquare className="w-4 h-4" />}>
                      <textarea required value={form.useCase} onChange={e => update('useCase', e.target.value)} rows={5}
                        placeholder="e.g. We need to collaborate on residential building designs across our 3 offices in real-time..."
                        className="w-full bg-black/40 border border-white/[0.08] rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500/30 transition-all resize-none text-sm" />
                    </Field>
                  </div>
                )}
              </motion.div>
            </AnimatePresence>

            {/* Navigation */}
            <div className="flex items-center justify-between mt-8 pt-6 border-t border-white/[0.06]">
              {step > 0 ? (
                <button onClick={() => setStep(s => s - 1)} className="flex items-center gap-2 text-sm text-zinc-400 hover:text-white transition-colors">
                  <ArrowLeft className="w-4 h-4" /> Back
                </button>
              ) : <div />}
              {step < STEPS.length - 1 ? (
                <button onClick={() => canAdvance() && setStep(s => s + 1)} disabled={!canAdvance()}
                  className="px-6 py-2.5 bg-gradient-to-r from-indigo-500 to-violet-600 text-white font-semibold rounded-xl hover:opacity-90 transition-all flex items-center gap-2 text-sm disabled:opacity-30 disabled:cursor-not-allowed shadow-lg shadow-indigo-500/20">
                  Continue <ArrowRight className="w-4 h-4" />
                </button>
              ) : (
                <button onClick={handleSubmit} disabled={!canAdvance() || loading}
                  className="px-6 py-2.5 bg-gradient-to-r from-indigo-500 to-violet-600 text-white font-semibold rounded-xl hover:opacity-90 transition-all flex items-center gap-2 text-sm disabled:opacity-30 disabled:cursor-not-allowed shadow-lg shadow-indigo-500/20">
                  {loading ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <><Send className="w-4 h-4" /> Submit Application</>}
                </button>
              )}
            </div>
          </div>

          <p className="text-center text-zinc-600 text-xs">
            By applying, you agree to our <Link href="/terms" className="text-zinc-400 hover:text-white underline">Terms</Link> and <Link href="/privacy" className="text-zinc-400 hover:text-white underline">Privacy Policy</Link>.
          </p>
        </div>
      </div>
    </div>
  )
}

function Field({ label, icon, children }: { label: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <label className="text-xs font-medium text-zinc-400 flex items-center gap-1.5">{icon} {label}</label>
      {children}
    </div>
  )
}
