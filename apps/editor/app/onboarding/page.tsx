'use client'

import { useState, useTransition } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Building2, Users2, GraduationCap, ArrowRight, Check, Box, Loader2 } from 'lucide-react'
import { provisionWorkspace } from './actions'

type Role = 'solo' | 'agency' | 'student'

const ROLES = [
  {
    id: 'solo' as Role,
    icon: Building2,
    label: 'Solo Architect',
    desc: 'Individual practitioner working on personal or client projects.',
    color: 'indigo',
  },
  {
    id: 'agency' as Role,
    icon: Users2,
    label: 'Agency / Team',
    desc: 'Multi-person firm collaborating on multiple active projects.',
    color: 'violet',
  },
  {
    id: 'student' as Role,
    icon: GraduationCap,
    label: 'Student',
    desc: 'Learning architectural design in an academic setting.',
    color: 'emerald',
  },
]

const slideVariants = {
  enter: (dir: number) => ({ x: dir * 60, opacity: 0 }),
  center: { x: 0, opacity: 1 },
  exit: (dir: number) => ({ x: dir * -60, opacity: 0 }),
}

export default function OnboardingPage() {
  const [step, setStep] = useState(0)
  const [direction, setDirection] = useState(1)
  const [role, setRole] = useState<Role | null>(null)
  const [orgName, setOrgName] = useState('')
  const [isPending, startTransition] = useTransition()

  function advance() {
    setDirection(1)
    setStep((s) => s + 1)
  }

  function submit() {
    const fd = new FormData()
    fd.append('orgName', orgName)
    fd.append('role', role ?? 'solo')
    startTransition(() => { void provisionWorkspace(fd) })
  }

  const steps = [
    /* Step 0: Welcome */
    <div key="welcome" className="flex flex-col items-center text-center gap-6">
      <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center shadow-2xl shadow-indigo-500/30">
        <Box className="w-8 h-8 text-white" />
      </div>
      <div>
        <h1 className="text-3xl font-bold tracking-tight mb-2">Welcome to Archly</h1>
        <p className="text-zinc-400 text-base max-w-sm">
          Let's get your workspace set up in a few quick steps.
        </p>
      </div>
      <button onClick={advance} className="mt-2 px-8 py-3 bg-gradient-to-r from-indigo-500 to-violet-600 text-white font-semibold rounded-xl hover:opacity-90 transition-all flex items-center gap-2 shadow-lg shadow-indigo-500/25">
        Get Started <ArrowRight className="w-4 h-4" />
      </button>
    </div>,

    /* Step 1: Role selection */
    <div key="role" className="flex flex-col gap-6 w-full">
      <div className="text-center">
        <h2 className="text-2xl font-bold tracking-tight mb-1">How do you work?</h2>
        <p className="text-zinc-400 text-sm">We'll tailor your workspace to fit your workflow.</p>
      </div>
      <div className="grid gap-3">
        {ROLES.map((r) => {
          const Icon = r.icon
          const selected = role === r.id
          return (
            <button
              key={r.id}
              onClick={() => setRole(r.id)}
              className={`flex items-center gap-4 p-4 rounded-2xl border text-left transition-all ${
                selected
                  ? 'border-indigo-500/40 bg-indigo-500/10 shadow-lg shadow-indigo-500/10'
                  : 'border-white/[0.08] bg-white/[0.03] hover:border-white/[0.14] hover:bg-white/[0.05]'
              }`}
            >
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${selected ? 'bg-indigo-500/20' : 'bg-white/[0.06]'}`}>
                <Icon className={`w-5 h-5 ${selected ? 'text-indigo-400' : 'text-zinc-400'}`} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-sm">{r.label}</div>
                <div className="text-zinc-500 text-xs mt-0.5">{r.desc}</div>
              </div>
              {selected && (
                <div className="w-5 h-5 rounded-full bg-indigo-500 flex items-center justify-center flex-shrink-0">
                  <Check className="w-3 h-3 text-white" />
                </div>
              )}
            </button>
          )
        })}
      </div>
      <button
        onClick={advance}
        disabled={!role}
        className="px-8 py-3 bg-gradient-to-r from-indigo-500 to-violet-600 text-white font-semibold rounded-xl hover:opacity-90 disabled:opacity-40 transition-all flex items-center justify-center gap-2 shadow-lg shadow-indigo-500/25"
      >
        Continue <ArrowRight className="w-4 h-4" />
      </button>
    </div>,

    /* Step 2: Org name */
    <div key="org" className="flex flex-col gap-6 w-full">
      <div className="text-center">
        <h2 className="text-2xl font-bold tracking-tight mb-1">Name your workspace</h2>
        <p className="text-zinc-400 text-sm">This will be visible to everyone you invite.</p>
      </div>
      <div className="space-y-2">
        <label className="block text-sm font-medium text-zinc-300">Workspace name</label>
        <input
          type="text"
          value={orgName}
          onChange={(e) => setOrgName(e.target.value)}
          placeholder="Acme Architecture Studio"
          maxLength={64}
          className="w-full px-4 py-3 rounded-xl bg-white/[0.04] border border-white/[0.10] text-white placeholder-zinc-600 focus:outline-none focus:border-indigo-500/50 focus:bg-white/[0.06] transition-all text-sm"
          onKeyDown={(e) => { if (e.key === 'Enter' && orgName.trim().length >= 2) submit() }}
        />
      </div>
      <button
        onClick={submit}
        disabled={orgName.trim().length < 2 || isPending}
        className="px-8 py-3 bg-gradient-to-r from-indigo-500 to-violet-600 text-white font-semibold rounded-xl hover:opacity-90 disabled:opacity-40 transition-all flex items-center justify-center gap-2 shadow-lg shadow-indigo-500/25"
      >
        {isPending ? (
          <><Loader2 className="w-4 h-4 animate-spin" /> Creating workspace…</>
        ) : (
          <>Create Workspace <ArrowRight className="w-4 h-4" /></>
        )}
      </button>
    </div>,
  ]

  return (
    <div className="min-h-screen bg-[#0A0A0A] text-white flex flex-col items-center justify-center px-6">
      {/* Ambient glow */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 w-[600px] h-[400px] bg-indigo-600/12 blur-[140px] rounded-full" />
      </div>

      <div className="relative w-full max-w-md">
        {/* Progress dots */}
        <div className="flex items-center justify-center gap-2 mb-10">
          {steps.map((_, i) => (
            <div
              key={i}
              className={`h-1.5 rounded-full transition-all duration-300 ${
                i === step ? 'w-8 bg-indigo-500' : i < step ? 'w-4 bg-indigo-500/50' : 'w-4 bg-white/10'
              }`}
            />
          ))}
        </div>

        {/* Glass card */}
        <div className="relative rounded-3xl border border-white/[0.08] bg-white/[0.03] backdrop-blur-2xl p-8 overflow-hidden shadow-2xl">
          <div className="absolute inset-0 bg-gradient-to-b from-white/[0.04] to-transparent pointer-events-none" />
          <div className="relative">
            <AnimatePresence mode="wait" custom={direction}>
              <motion.div
                key={step}
                custom={direction}
                variants={slideVariants}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{ duration: 0.25, ease: 'easeInOut' }}
              >
                {steps[step]}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </div>
    </div>
  )
}
