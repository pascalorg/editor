'use client'

import { Suspense, lazy, useState } from 'react'
import { motion } from 'framer-motion'
import {
  ArrowRight, Layers, Zap, Users2, ShieldCheck, Globe2,
  Cpu, Building2, Box, MousePointer2, Share2, Play,
  Check, ChevronRight, Sparkles, Eye, FolderOpen, Download,
  Palette, Grid3X3, LayoutGrid, Star, GitBranch, Package,
} from 'lucide-react'
import Link from 'next/link'

const HeroCanvas = lazy(() => import('./_components/HeroCanvas'))

const fade = { initial: { opacity: 0, y: 20 }, animate: { opacity: 1, y: 0 } }

/* Glass CTA button */
function GlassButton({ href, children, primary = false }: { href: string; children: React.ReactNode; primary?: boolean }) {
  if (primary) {
    return (
      <Link href={href} className="relative group inline-flex items-center gap-2 px-8 py-3.5 rounded-xl font-semibold text-[15px] text-white overflow-hidden transition-all hover:scale-[1.02] active:scale-[0.98]">
        <span className="absolute inset-0 bg-gradient-to-r from-indigo-500 to-violet-600 transition-opacity" />
        <span className="absolute inset-0 bg-gradient-to-r from-indigo-400 to-violet-500 opacity-0 group-hover:opacity-100 transition-opacity" />
        <span className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/40 to-transparent" />
        <span className="absolute inset-0 rounded-xl shadow-xl shadow-indigo-500/30" />
        <span className="relative flex items-center gap-2">{children}</span>
      </Link>
    )
  }
  return (
    <Link href={href} className="relative group inline-flex items-center gap-2 px-8 py-3.5 rounded-xl font-semibold text-[15px] text-white overflow-hidden transition-all hover:scale-[1.02] active:scale-[0.98]">
      <span className="absolute inset-0 bg-white/[0.04] backdrop-blur-md border border-white/[0.10] rounded-xl group-hover:bg-white/[0.07] transition-colors" />
      <span className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/15 to-transparent" />
      <span className="relative flex items-center gap-2">{children}</span>
    </Link>
  )
}

export default function LandingPage() {
  const [activeUseCase, setActiveUseCase] = useState(0)
  const useCases = [
    { title: 'Architecture', icon: <Building2 className="w-5 h-5" />, desc: 'Create detailed building models with parametric walls, slabs, roofs, and intelligent room layouts. Iterate with your team in real-time.', features: ['Parametric building elements', 'Multi-level editing', 'Material library'] },
    { title: 'Real Estate', icon: <LayoutGrid className="w-5 h-5" />, desc: 'Present interactive 3D walkthroughs to clients. Showcase properties with photorealistic materials and lighting before construction begins.', features: ['Interactive presentations', 'First-person walkthroughs', 'One-click sharing'] },
    { title: 'Construction', icon: <Grid3X3 className="w-5 h-5" />, desc: 'Coordinate across teams with shared project workspaces. Track changes, manage versions, and keep everyone aligned on the latest design.', features: ['Version history', 'Team permissions', 'Export to CAD formats'] },
  ]

  return (
    <div className="min-h-screen bg-[#09090b] text-white selection:bg-indigo-500/30 selection:text-white">
      {/* Navbar */}
      <nav className="fixed top-0 left-0 right-0 z-50 border-b border-white/[0.06] bg-[#09090b]/80 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5">
            <div className="w-8 h-8 bg-gradient-to-br from-indigo-500 to-violet-600 rounded-lg flex items-center justify-center shadow-lg shadow-indigo-500/20">
              <Box className="w-4.5 h-4.5 text-white" />
            </div>
            <span className="font-bold text-lg tracking-tight">archly</span>
          </Link>
          <div className="hidden md:flex items-center gap-8 text-[13px] font-medium text-zinc-400">
            <a href="#features" className="hover:text-white transition-colors">Features</a>
            <a href="#use-cases" className="hover:text-white transition-colors">Use Cases</a>
            <a href="#pricing" className="hover:text-white transition-colors">Pricing</a>
            <Link href="/marketplace" className="hover:text-white transition-colors">Marketplace</Link>
          </div>
          <div className="flex items-center gap-3">
            <Link href="/login" className="hidden sm:block text-[13px] font-medium text-zinc-400 hover:text-white transition-colors px-3 py-1.5">Sign In</Link>
            <GlassButton href="/signup" primary>Get Started Free</GlassButton>
          </div>
        </div>
      </nav>

      {/* ── HERO ── */}
      <section className="relative pt-36 pb-0 px-6 overflow-hidden" style={{ minHeight: '100vh' }}>
        {/* Ambient glow */}
        <div className="absolute top-20 left-1/2 -translate-x-1/2 w-[900px] h-[500px] bg-indigo-600/12 blur-[160px] rounded-full pointer-events-none" />
        <div className="absolute top-60 right-1/4 w-72 h-72 bg-violet-600/8 blur-[120px] rounded-full pointer-events-none" />

        <div className="max-w-5xl mx-auto text-center relative z-10">
          <motion.div {...fade} transition={{ duration: 0.5 }} className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full border border-indigo-500/20 bg-indigo-500/5 text-xs font-medium text-indigo-300 mb-8">
            <Sparkles className="w-3.5 h-3.5" />
            Now in Open Beta — Free for teams up to 5
            <ArrowRight className="w-3 h-3" />
          </motion.div>
          <motion.h1 {...fade} transition={{ duration: 0.5, delay: 0.1 }} className="text-5xl sm:text-6xl md:text-7xl font-extrabold tracking-[-0.035em] mb-6 leading-[1.05]">
            <span className="bg-gradient-to-b from-white via-white to-zinc-400 bg-clip-text text-transparent">Design buildings{' '}</span>
            <span className="bg-gradient-to-r from-indigo-400 to-violet-400 bg-clip-text text-transparent">together,</span>
            <br className="hidden sm:block" />
            <span className="bg-gradient-to-b from-white via-white to-zinc-400 bg-clip-text text-transparent"> in real-time.</span>
          </motion.h1>
          <motion.p {...fade} transition={{ duration: 0.5, delay: 0.2 }} className="text-lg text-zinc-400 max-w-2xl mx-auto mb-10 leading-relaxed">
            Archly is the collaborative 3D spatial platform built for architecture, real estate, and construction teams. Powered by WebGPU for native performance.
          </motion.p>
          <motion.div {...fade} transition={{ duration: 0.5, delay: 0.3 }} className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <GlassButton href="/signup" primary>
              Start Building Free <ArrowRight className="w-4 h-4" />
            </GlassButton>
            <GlassButton href="/playground">
              <Play className="w-4 h-4" /> Try the Playground
            </GlassButton>
          </motion.div>
        </div>

        {/* 3D Hero Canvas */}
        <motion.div
          initial={{ opacity: 0, y: 60 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1, delay: 0.5 }}
          className="mt-16 max-w-6xl mx-auto"
        >
          <div className="relative p-px rounded-2xl overflow-hidden" style={{ background: 'linear-gradient(180deg, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0.02) 100%)' }}>
            {/* Specular rim */}
            <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />
            <div className="w-full aspect-[16/9] rounded-2xl bg-[#050510] overflow-hidden relative">
              <Suspense fallback={
                <div className="w-full h-full bg-gradient-to-tr from-indigo-500/5 via-transparent to-violet-500/5 flex items-center justify-center">
                  <Box className="w-16 h-16 text-zinc-700 animate-pulse" />
                </div>
              }>
                <HeroCanvas />
              </Suspense>

              {/* Floating presence cursors overlay */}
              <div className="absolute inset-0 pointer-events-none">
                <div className="absolute top-[28%] left-[22%] flex flex-col items-start gap-0.5 animate-pulse">
                  <MousePointer2 className="w-4 h-4 text-indigo-400 fill-indigo-400 drop-shadow-lg" />
                  <span className="bg-indigo-500 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-md ml-3 shadow-lg">Sarah K.</span>
                </div>
                <div className="absolute top-[52%] right-[28%] flex flex-col items-start gap-0.5 animate-pulse" style={{ animationDelay: '1s' }}>
                  <MousePointer2 className="w-4 h-4 text-emerald-400 fill-emerald-400 drop-shadow-lg" />
                  <span className="bg-emerald-500 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-md ml-3 shadow-lg">Marcus R.</span>
                </div>
                <div className="absolute bottom-[22%] left-[48%] flex flex-col items-start gap-0.5 animate-pulse" style={{ animationDelay: '2s' }}>
                  <MousePointer2 className="w-4 h-4 text-amber-400 fill-amber-400 drop-shadow-lg" />
                  <span className="bg-amber-500 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-md ml-3 shadow-lg">Alex T.</span>
                </div>
              </div>

              {/* Bottom fade into page */}
              <div className="absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-[#09090b] to-transparent" />
            </div>
          </div>
        </motion.div>
      </section>

      {/* Logos strip */}
      <section className="py-16 border-y border-white/[0.04]">
        <div className="max-w-7xl mx-auto px-6">
          <p className="text-center text-[11px] font-semibold text-zinc-500 uppercase tracking-[0.2em] mb-10">Trusted by forward-thinking teams</p>
          <div className="flex flex-wrap justify-center items-center gap-x-16 gap-y-6 opacity-20">
            {[Building2, Globe2, Layers, ShieldCheck, Cpu].map((Icon, i) => <Icon key={i} className="w-28 h-10" />)}
          </div>
        </div>
      </section>

      {/* ── BENTO FEATURE GRID ── */}
      <section id="features" className="py-28 px-6">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <p className="text-indigo-400 font-semibold text-sm uppercase tracking-widest mb-4">Platform</p>
            <h2 className="text-4xl md:text-5xl font-bold tracking-tight">Everything you need<br />to build together.</h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Large hero cell: Real-Time Sync */}
            <motion.div
              initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}
              className="md:col-span-2 relative rounded-3xl border border-white/[0.07] bg-white/[0.02] p-8 overflow-hidden group hover:border-indigo-500/20 transition-all min-h-[300px]"
            >
              <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-indigo-500/20 to-transparent" />
              <div className="absolute -bottom-20 -right-20 w-64 h-64 bg-indigo-500/8 blur-[80px] rounded-full" />
              <div className="flex items-center gap-3 mb-4">
                <div className="p-2.5 bg-indigo-500/10 rounded-xl"><Users2 className="w-5 h-5 text-indigo-400" /></div>
                <h3 className="font-bold text-lg">Real-Time Sync</h3>
              </div>
              <p className="text-zinc-400 text-sm leading-relaxed max-w-sm mb-8">
                Every edit, selection, and cursor move is broadcast instantly. Powered by CRDTs — no conflicts, no merge hell.
              </p>
              {/* Animated presence avatars */}
              <div className="flex items-center gap-3">
                {['S', 'M', 'A', 'J'].map((initial, i) => (
                  <div key={i} className={`w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold text-white border-2 border-[#0a0a0a] shadow-lg ${['bg-indigo-500', 'bg-emerald-500', 'bg-amber-500', 'bg-violet-500'][i]}`} style={{ marginLeft: i > 0 ? '-8px' : 0 }}>
                    {initial}
                  </div>
                ))}
                <span className="text-xs text-zinc-500 ml-2">4 collaborators online</span>
                <span className="ml-auto flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-medium">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" /> Live
                </span>
              </div>
            </motion.div>

            {/* Tall cell: Component Marketplace */}
            <motion.div
              initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: 0.1 }}
              className="relative rounded-3xl border border-white/[0.07] bg-white/[0.02] p-7 overflow-hidden group hover:border-violet-500/20 transition-all min-h-[300px]"
            >
              <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-violet-500/20 to-transparent" />
              <div className="absolute -bottom-16 -right-16 w-48 h-48 bg-violet-500/8 blur-[60px] rounded-full" />
              <div className="flex items-center gap-3 mb-4">
                <div className="p-2.5 bg-violet-500/10 rounded-xl"><Package className="w-5 h-5 text-violet-400" /></div>
                <h3 className="font-bold text-base">Marketplace</h3>
              </div>
              <p className="text-zinc-400 text-sm leading-relaxed mb-6">
                Share scenes and clone community designs. Zero storage cost — pointer-based duplication.
              </p>
              {/* Mini asset cards */}
              <div className="space-y-2">
                {['Modern Villa', 'Glass Tower', 'Urban Loft'].map((name, i) => (
                  <div key={i} className="flex items-center gap-2.5 px-3 py-2 rounded-xl bg-white/[0.03] border border-white/[0.06]">
                    <div className="w-7 h-7 rounded-lg bg-violet-500/15 flex items-center justify-center flex-shrink-0">
                      <Building2 className="w-3.5 h-3.5 text-violet-400" />
                    </div>
                    <span className="text-xs font-medium flex-1">{name}</span>
                    <Download className="w-3 h-3 text-zinc-600" />
                  </div>
                ))}
              </div>
            </motion.div>

            {/* Medium cell: Client Presentation */}
            <motion.div
              initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: 0.15 }}
              className="relative rounded-3xl border border-white/[0.07] bg-white/[0.02] p-7 overflow-hidden group hover:border-cyan-500/20 transition-all"
            >
              <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-500/20 to-transparent" />
              <div className="flex items-center gap-3 mb-4">
                <div className="p-2.5 bg-cyan-500/10 rounded-xl"><Eye className="w-5 h-5 text-cyan-400" /></div>
                <h3 className="font-bold text-base">Client Presentation</h3>
              </div>
              <p className="text-zinc-400 text-sm leading-relaxed">
                Share a live link. Clients join as Viewers — they can explore the 3D scene and comment, without edit access.
              </p>
            </motion.div>

            {/* Small cell: RBAC */}
            <motion.div
              initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: 0.2 }}
              className="relative rounded-3xl border border-white/[0.07] bg-white/[0.02] p-7 overflow-hidden group hover:border-emerald-500/20 transition-all"
            >
              <div className="flex items-center gap-3 mb-4">
                <div className="p-2.5 bg-emerald-500/10 rounded-xl"><ShieldCheck className="w-5 h-5 text-emerald-400" /></div>
                <h3 className="font-bold text-base">RBAC Permissions</h3>
              </div>
              <div className="space-y-2">
                {['Owner', 'Editor', 'Commenter', 'Viewer'].map((role, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs">
                    <div className={`w-1.5 h-1.5 rounded-full ${['bg-violet-400', 'bg-indigo-400', 'bg-amber-400', 'bg-zinc-500'][i]}`} />
                    <span className="text-zinc-400">{role}</span>
                  </div>
                ))}
              </div>
            </motion.div>

            {/* Wide cell: R2 Pipeline */}
            <motion.div
              initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: 0.25 }}
              className="md:col-span-1 relative rounded-3xl border border-white/[0.07] bg-white/[0.02] p-7 overflow-hidden group hover:border-amber-500/20 transition-all"
            >
              <div className="flex items-center gap-3 mb-4">
                <div className="p-2.5 bg-amber-500/10 rounded-xl"><Zap className="w-5 h-5 text-amber-400" /></div>
                <h3 className="font-bold text-base">CDN Asset Pipeline</h3>
              </div>
              <p className="text-zinc-400 text-sm leading-relaxed">
                Direct-to-R2 uploads via presigned URLs. Draco compression + KTX2 textures on the way.
              </p>
            </motion.div>
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="py-28 px-6 bg-white/[0.01]">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-20">
            <p className="text-indigo-400 font-semibold text-sm uppercase tracking-widest mb-4">How It Works</p>
            <h2 className="text-4xl md:text-5xl font-bold tracking-tight">From concept to collaboration<br />in three steps.</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {[
              { step: '01', title: 'Import or Create', desc: 'Start with a blank canvas or import existing floorplans. Our parametric engine generates smart building elements instantly.', icon: <FolderOpen className="w-6 h-6" /> },
              { step: '02', title: 'Collaborate Live', desc: 'Invite your team. See cursors, selections, and edits in real-time. No more emailing files back and forth.', icon: <Users2 className="w-6 h-6" /> },
              { step: '03', title: 'Share & Export', desc: 'Generate interactive walkthroughs, export to standard formats, or share a live link with stakeholders.', icon: <Download className="w-6 h-6" /> },
            ].map((item, i) => (
              <motion.div key={i} initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.15 }}
                className="relative bg-zinc-900/50 border border-white/[0.06] rounded-2xl p-8 group hover:border-indigo-500/20 transition-all">
                <div className="text-[11px] font-bold text-indigo-400/60 tracking-widest mb-4">{item.step}</div>
                <div className="p-3 bg-indigo-500/10 rounded-xl w-fit mb-5 group-hover:bg-indigo-500/15 transition-colors">{item.icon}</div>
                <h3 className="text-lg font-bold mb-2">{item.title}</h3>
                <p className="text-sm text-zinc-400 leading-relaxed">{item.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Use Cases */}
      <section id="use-cases" className="py-28 px-6">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <p className="text-indigo-400 font-semibold text-sm uppercase tracking-widest mb-4">Use Cases</p>
            <h2 className="text-4xl md:text-5xl font-bold tracking-tight">Built for every stage<br />of the building lifecycle.</h2>
          </div>
          <div className="flex justify-center gap-2 mb-12">
            {useCases.map((uc, i) => (
              <button key={i} onClick={() => setActiveUseCase(i)}
                className={`flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium transition-all ${activeUseCase === i ? 'bg-indigo-500/15 text-indigo-300 border border-indigo-500/25' : 'text-zinc-400 hover:text-white hover:bg-white/[0.04] border border-transparent'}`}>
                {uc.icon} {uc.title}
              </button>
            ))}
          </div>
          <motion.div key={activeUseCase} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}
            className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
            <div>
              <h3 className="text-2xl font-bold mb-4">{useCases[activeUseCase]?.title} Teams</h3>
              <p className="text-zinc-400 leading-relaxed mb-8">{useCases[activeUseCase]?.desc}</p>
              <ul className="space-y-3">
                {useCases[activeUseCase]?.features.map((f, i) => (
                  <li key={i} className="flex items-center gap-3 text-zinc-300 text-sm">
                    <div className="w-5 h-5 rounded-full bg-indigo-500/15 flex items-center justify-center flex-shrink-0">
                      <Check className="w-3 h-3 text-indigo-400" />
                    </div>
                    {f}
                  </li>
                ))}
              </ul>
              <Link href="/signup" className="inline-flex items-center gap-2 mt-8 text-indigo-400 font-medium text-sm hover:text-indigo-300 transition-colors group">
                Get started <ChevronRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
              </Link>
            </div>
            <div className="bg-zinc-900/50 border border-white/[0.06] rounded-2xl aspect-[4/3] flex items-center justify-center">
              <div className="text-zinc-600 text-sm font-medium flex flex-col items-center gap-3">
                <Eye className="w-10 h-10" />
                <span>Interactive Preview</span>
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="py-28 px-6 bg-white/[0.01]">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-16">
            <p className="text-indigo-400 font-semibold text-sm uppercase tracking-widest mb-4">Pricing</p>
            <h2 className="text-4xl md:text-5xl font-bold tracking-tight mb-5">Start free. Scale as you grow.</h2>
            <p className="text-zinc-400 text-lg">No credit card required. Upgrade when you need more.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[
              { name: 'Starter', price: 'Free', period: 'forever', desc: 'For individuals and small teams exploring 3D design.', features: ['Up to 5 team members', '3 active projects', 'Community support', 'Basic export formats'], cta: 'Get Started', highlighted: false },
              { name: 'Pro', price: '$29', period: '/seat/mo', desc: 'For professional teams that need advanced collaboration.', features: ['Unlimited members', 'Unlimited projects', 'Real-time collaboration', 'Priority support', 'Version history', 'Custom materials'], cta: 'Start Free Trial', highlighted: true },
              { name: 'Enterprise', price: 'Custom', period: '', desc: 'For organizations that need security, compliance, and scale.', features: ['Everything in Pro', 'SSO & SAML', 'Dedicated support', 'Custom integrations', 'SLA guarantee', 'On-premise option'], cta: 'Contact Sales', highlighted: false },
            ].map((plan, i) => (
              <motion.div key={i} initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.1 }}
                className={`rounded-2xl p-8 flex flex-col ${plan.highlighted ? 'bg-gradient-to-b from-indigo-500/10 to-violet-500/5 border-2 border-indigo-500/30 relative' : 'bg-zinc-900/40 border border-white/[0.06]'}`}>
                {plan.highlighted && <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-0.5 bg-gradient-to-r from-indigo-500 to-violet-500 text-white text-[10px] font-bold rounded-full uppercase tracking-wider">Most Popular</div>}
                <h3 className="text-lg font-bold mb-1">{plan.name}</h3>
                <div className="flex items-baseline gap-1 mb-3">
                  <span className="text-3xl font-extrabold">{plan.price}</span>
                  <span className="text-zinc-500 text-sm">{plan.period}</span>
                </div>
                <p className="text-sm text-zinc-400 mb-6">{plan.desc}</p>
                <ul className="space-y-2.5 mb-8 flex-1">
                  {plan.features.map((f, j) => (
                    <li key={j} className="flex items-center gap-2.5 text-sm text-zinc-300">
                      <Check className="w-4 h-4 text-indigo-400 flex-shrink-0" /> {f}
                    </li>
                  ))}
                </ul>
                <Link href="/signup" className={`w-full py-3 rounded-xl font-semibold text-sm text-center transition-all ${plan.highlighted ? 'bg-gradient-to-r from-indigo-500 to-violet-600 text-white hover:opacity-90 shadow-lg shadow-indigo-500/20' : 'bg-white/[0.05] border border-white/10 text-white hover:bg-white/[0.08]'}`}>
                  {plan.cta}
                </Link>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-32 px-6">
        <div className="max-w-4xl mx-auto text-center relative">
          <div className="absolute inset-0 bg-indigo-600/10 blur-[100px] rounded-full pointer-events-none" />
          <div className="relative border border-white/[0.08] rounded-[32px] p-16 md:p-24 overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-b from-white/[0.04] to-transparent pointer-events-none" />
            <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/15 to-transparent" />
            <h2 className="relative text-4xl md:text-5xl font-bold mb-6 tracking-tight">Ready to build together?</h2>
            <p className="relative text-lg text-zinc-400 mb-10 max-w-xl mx-auto">Join hundreds of teams already designing the future with Archly. Free to start, no credit card required.</p>
            <GlassButton href="/signup" primary>
              Get Started Free
            </GlassButton>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-16 px-6 border-t border-white/[0.06]">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-start gap-12">
          <div className="space-y-4 max-w-xs">
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 bg-gradient-to-br from-indigo-500 to-violet-600 rounded-lg flex items-center justify-center">
                <Box className="w-4 h-4 text-white" />
              </div>
              <span className="font-bold text-base tracking-tight">archly</span>
            </div>
            <p className="text-zinc-500 text-sm leading-relaxed">The collaborative 3D spatial platform for teams that build the physical world.</p>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-12">
            {[
              { title: 'Product', links: [{ label: 'Features', href: '#features' }, { label: 'Pricing', href: '#pricing' }, { label: 'Marketplace', href: '/marketplace' }, { label: 'Playground', href: '/playground' }] },
              { title: 'Resources', links: [{ label: 'Documentation', href: '#' }, { label: 'Community', href: '#' }, { label: 'Support', href: 'mailto:support@archly.cloud' }, { label: 'Changelog', href: '#' }] },
              { title: 'Legal', links: [{ label: 'Terms', href: '/terms' }, { label: 'Privacy', href: '/privacy' }, { label: 'Contact', href: 'mailto:support@archly.cloud' }] },
            ].map((col, i) => (
              <div key={i} className="space-y-3">
                <h4 className="text-[11px] font-bold uppercase tracking-[0.15em] text-zinc-400">{col.title}</h4>
                <ul className="space-y-2">
                  {col.links.map((link, j) => (
                    <li key={j}><Link href={link.href} className="text-sm text-zinc-500 hover:text-white transition-colors">{link.label}</Link></li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
        <div className="max-w-7xl mx-auto mt-12 pt-6 border-t border-white/[0.04] flex justify-between items-center text-xs text-zinc-600">
          <span>&copy; {new Date().getFullYear()} Archly Inc. All rights reserved.</span>
          <div className="flex gap-5">
            <a href="#" className="hover:text-zinc-400 transition-colors">Twitter</a>
            <a href="#" className="hover:text-zinc-400 transition-colors">Discord</a>
            <a href="#" className="hover:text-zinc-400 transition-colors">GitHub</a>
          </div>
        </div>
      </footer>
    </div>
  )
}
