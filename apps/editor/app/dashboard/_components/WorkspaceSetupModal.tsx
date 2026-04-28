'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import { Building2, Users2, GraduationCap, ArrowRight, Check, Loader2 } from 'lucide-react'
import { createWorkspace } from '@/app/onboarding/actions'

const USE_CASES = [
  {
    id: 'solo',
    icon: Building2,
    label: 'Solo practice',
    desc: 'Personal projects and client work',
  },
  {
    id: 'team',
    icon: Users2,
    label: 'Team collaboration',
    desc: 'Multi-person firm or studio',
  },
  {
    id: 'student',
    icon: GraduationCap,
    label: 'Academic / Student',
    desc: 'Learning and coursework',
  },
]

export function WorkspaceSetupModal() {
  const [step, setStep] = useState<0 | 1>(0)
  const [useCase, setUseCase] = useState('')
  const [orgName, setOrgName] = useState('')
  const [error, setError] = useState('')
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  const slug = orgName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

  const handleCreate = () => {
    if (!orgName.trim() || isPending) return
    setError('')
    startTransition(async () => {
      const result = await createWorkspace(orgName.trim(), useCase)
      if (result.success) {
        router.refresh()
      } else {
        setError(result.error ?? 'Something went wrong')
      }
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-md">
      <motion.div
        initial={{ opacity: 0, scale: 0.97, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
        className="w-full max-w-md mx-4"
      >
        {/* Step indicators */}
        <div className="flex items-center justify-center gap-1.5 mb-6">
          {[0, 1].map((i) => (
            <motion.div
              key={i}
              animate={{ width: i === step ? 28 : i < step ? 16 : 14 }}
              className={`h-1 rounded-full transition-colors duration-300 ${
                i <= step ? 'bg-indigo-500' : 'bg-white/10'
              }`}
            />
          ))}
        </div>

        <div className="relative bg-[#0d0d0d] border border-white/[0.09] rounded-2xl overflow-hidden shadow-2xl shadow-black/60">
          <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-indigo-500/50 to-transparent" />

          <div className="p-7">
            <AnimatePresence mode="wait">
              {step === 0 && (
                <motion.div
                  key="step0"
                  initial={{ opacity: 0, x: 24 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -24 }}
                  transition={{ duration: 0.2, ease: 'easeOut' }}
                >
                  <p className="text-xs font-semibold text-indigo-400 uppercase tracking-wider mb-2">Step 1 of 2</p>
                  <h2 className="text-xl font-bold text-white mb-1">How will you use archly?</h2>
                  <p className="text-zinc-500 text-sm mb-5">We'll tailor your workspace to fit your needs.</p>

                  <div className="space-y-2">
                    {USE_CASES.map(({ id, label, desc, icon: Icon }) => {
                      const selected = useCase === id
                      return (
                        <button
                          key={id}
                          type="button"
                          onClick={() => setUseCase(id)}
                          className={`w-full flex items-center gap-3.5 p-3.5 rounded-xl border text-left transition-all duration-150 ${
                            selected
                              ? 'border-indigo-500/40 bg-indigo-500/[0.08]'
                              : 'border-white/[0.07] hover:border-white/[0.14] hover:bg-white/[0.03]'
                          }`}
                        >
                          <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 transition-colors ${
                            selected ? 'bg-indigo-500/20' : 'bg-white/[0.05]'
                          }`}>
                            <Icon className={`w-4 h-4 ${selected ? 'text-indigo-400' : 'text-zinc-400'}`} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className={`text-sm font-medium ${selected ? 'text-white' : 'text-zinc-300'}`}>{label}</p>
                            <p className="text-xs text-zinc-500 mt-0.5">{desc}</p>
                          </div>
                          <div className={`w-4 h-4 rounded-full border-2 flex-shrink-0 flex items-center justify-center transition-all ${
                            selected ? 'border-indigo-500 bg-indigo-500' : 'border-white/20'
                          }`}>
                            {selected && <Check className="w-2.5 h-2.5 text-white" />}
                          </div>
                        </button>
                      )
                    })}
                  </div>

                  <button
                    type="button"
                    onClick={() => setStep(1)}
                    disabled={!useCase}
                    className="mt-5 w-full bg-gradient-to-r from-indigo-500 to-violet-600 hover:opacity-90 text-white font-medium py-2.5 rounded-xl flex items-center justify-center gap-2 text-sm disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-lg shadow-indigo-500/15"
                  >
                    Continue <ArrowRight size={15} />
                  </button>
                </motion.div>
              )}

              {step === 1 && (
                <motion.div
                  key="step1"
                  initial={{ opacity: 0, x: 24 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -24 }}
                  transition={{ duration: 0.2, ease: 'easeOut' }}
                >
                  <p className="text-xs font-semibold text-indigo-400 uppercase tracking-wider mb-2">Step 2 of 2</p>
                  <h2 className="text-xl font-bold text-white mb-1">Name your workspace</h2>
                  <p className="text-zinc-500 text-sm mb-5">This is what your team will see when they join.</p>

                  <div>
                    <input
                      type="text"
                      autoFocus
                      value={orgName}
                      onChange={(e) => setOrgName(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && orgName.trim().length >= 2 && handleCreate()}
                      placeholder="Acme Architecture Studio"
                      maxLength={64}
                      className="w-full bg-white/[0.04] border border-white/[0.08] text-white rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-indigo-500/40 transition-all placeholder:text-zinc-600"
                    />
                    <AnimatePresence>
                      {orgName && (
                        <motion.p
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: 'auto' }}
                          exit={{ opacity: 0, height: 0 }}
                          className="mt-1.5 text-xs text-zinc-600 pl-1"
                        >
                          archly.cloud/<span className="text-zinc-400">{slug || 'your-workspace'}</span>
                        </motion.p>
                      )}
                    </AnimatePresence>
                    {error && <p className="mt-2 text-xs text-red-400 pl-1">{error}</p>}
                  </div>

                  <div className="flex gap-2 mt-5">
                    <button
                      type="button"
                      onClick={() => setStep(0)}
                      className="px-4 py-2.5 rounded-xl border border-white/[0.08] text-zinc-400 hover:text-white hover:border-white/[0.14] text-sm transition-colors"
                    >
                      Back
                    </button>
                    <button
                      type="button"
                      onClick={handleCreate}
                      disabled={orgName.trim().length < 2 || isPending}
                      className="flex-1 bg-gradient-to-r from-indigo-500 to-violet-600 hover:opacity-90 text-white font-medium py-2.5 rounded-xl flex items-center justify-center gap-2 text-sm disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-lg shadow-indigo-500/15"
                    >
                      {isPending ? (
                        <><Loader2 className="w-4 h-4 animate-spin" /> Creating…</>
                      ) : (
                        <>Create workspace <ArrowRight size={15} /></>
                      )}
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </motion.div>
    </div>
  )
}
