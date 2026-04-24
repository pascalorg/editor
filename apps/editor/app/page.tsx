'use client'

import { motion } from 'framer-motion'
import {
  ArrowRight, Layers, Zap, Users2, ShieldCheck, Globe2,
  Cpu, Building2, Box, MousePointer2, Share2, Play,
  Check, ChevronRight, Sparkles, Eye, FolderOpen, Download,
  Palette, Grid3X3, LayoutGrid, Star
} from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'

const fade = { initial: { opacity: 0, y: 20 }, animate: { opacity: 1, y: 0 } }

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
            <Link href="/terms" className="hover:text-white transition-colors">Legal</Link>
          </div>
          <div className="flex items-center gap-3">
            <Link href="/login" className="hidden sm:block text-[13px] font-medium text-zinc-400 hover:text-white transition-colors px-3 py-1.5">Sign In</Link>
            <Link href="/apply" className="px-4 py-2 bg-gradient-to-r from-indigo-500 to-violet-600 text-white text-[13px] font-semibold rounded-lg hover:opacity-90 transition-all shadow-lg shadow-indigo-500/20">
              Get Started Free
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative pt-36 pb-24 px-6 overflow-hidden">
        <div className="absolute top-20 left-1/2 -translate-x-1/2 w-[800px] h-[500px] bg-indigo-600/15 blur-[140px] rounded-full pointer-events-none" />
        <div className="absolute top-60 right-1/4 w-72 h-72 bg-violet-600/10 blur-[120px] rounded-full pointer-events-none" />
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
            <Link href="/apply" className="w-full sm:w-auto px-8 py-3.5 bg-gradient-to-r from-indigo-500 to-violet-600 text-white font-semibold rounded-xl hover:opacity-90 transition-all flex items-center justify-center gap-2 text-[15px] shadow-xl shadow-indigo-500/25">
              Start Building Free <ArrowRight className="w-4 h-4" />
            </Link>
            <Link href="/editor" className="w-full sm:w-auto px-8 py-3.5 bg-white/[0.04] border border-white/10 text-white font-semibold rounded-xl hover:bg-white/[0.08] transition-all flex items-center justify-center gap-2 text-[15px]">
              <Play className="w-4 h-4" /> Try the Playground
            </Link>
          </motion.div>
        </div>

        {/* Hero Mockup */}
        <motion.div initial={{ opacity: 0, y: 50 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8, delay: 0.4 }} className="mt-20 max-w-6xl mx-auto">
          <div className="relative p-1.5 rounded-2xl border border-white/[0.08] bg-gradient-to-b from-white/[0.03] to-transparent shadow-2xl overflow-hidden">
            <div className="w-full aspect-[16/9] bg-zinc-900 rounded-xl flex items-center justify-center relative overflow-hidden">
              <div className="absolute inset-0 bg-gradient-to-tr from-indigo-500/5 via-transparent to-violet-500/5" />
              <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:60px_60px]" />
              <div className="flex flex-col items-center gap-4 text-zinc-500">
                <Box className="w-16 h-16 text-zinc-600" />
                <p className="text-sm font-medium">3D Editor Canvas</p>
              </div>
              {/* Floating cursors */}
              <div className="absolute top-[30%] left-[25%] flex flex-col items-start gap-0.5 pointer-events-none animate-pulse">
                <MousePointer2 className="w-4 h-4 text-indigo-400 fill-indigo-400 drop-shadow-lg" />
                <span className="bg-indigo-500 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-md ml-3">Sarah K.</span>
              </div>
              <div className="absolute top-[55%] right-[30%] flex flex-col items-start gap-0.5 pointer-events-none animate-pulse" style={{ animationDelay: '1s' }}>
                <MousePointer2 className="w-4 h-4 text-emerald-400 fill-emerald-400 drop-shadow-lg" />
                <span className="bg-emerald-500 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-md ml-3">Marcus R.</span>
              </div>
              <div className="absolute bottom-[25%] left-[45%] flex flex-col items-start gap-0.5 pointer-events-none animate-pulse" style={{ animationDelay: '2s' }}>
                <MousePointer2 className="w-4 h-4 text-amber-400 fill-amber-400 drop-shadow-lg" />
                <span className="bg-amber-500 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-md ml-3">Alex T.</span>
              </div>
            </div>
          </div>
        </motion.div>
      </section>

      {/* Logos */}
      <section className="py-16 border-y border-white/[0.04]">
        <div className="max-w-7xl mx-auto px-6">
          <p className="text-center text-[11px] font-semibold text-zinc-500 uppercase tracking-[0.2em] mb-10">Trusted by forward-thinking teams</p>
          <div className="flex flex-wrap justify-center items-center gap-x-16 gap-y-6 opacity-20">{[Building2, Globe2, Layers, ShieldCheck, Cpu].map((Icon, i) => <Icon key={i} className="w-28 h-10" />)}</div>
        </div>
      </section>

      {/* How It Works */}
      <section className="py-28 px-6">
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

      {/* Features */}
      <section id="features" className="py-28 px-6 bg-white/[0.01]">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-20">
            <p className="text-indigo-400 font-semibold text-sm uppercase tracking-widest mb-4">Platform</p>
            <h2 className="text-4xl md:text-5xl font-bold tracking-tight mb-5">Everything teams need<br />to build together.</h2>
            <p className="text-zinc-400 text-lg max-w-2xl mx-auto">Purpose-built for spatial collaboration with no compromise on performance.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {[
              { icon: <Zap className="w-5 h-5 text-amber-400" />, title: 'WebGPU Rendering', desc: 'Native-grade 3D performance directly in the browser. No plugins, no downloads.' },
              { icon: <Users2 className="w-5 h-5 text-indigo-400" />, title: 'Real-time Multiplayer', desc: 'See teammates cursors and edits live. Conflict-free sync powered by Redis.' },
              { icon: <Layers className="w-5 h-5 text-violet-400" />, title: 'Smart Building System', desc: 'Parametric walls, doors, windows, and slabs that snap together intelligently.' },
              { icon: <ShieldCheck className="w-5 h-5 text-emerald-400" />, title: 'Team Permissions', desc: 'Organization-level RBAC with Owner, Admin, and Member roles built-in.' },
              { icon: <Palette className="w-5 h-5 text-pink-400" />, title: 'Material Library', desc: 'Curated library of photorealistic materials — wood, concrete, glass, and more.' },
              { icon: <Share2 className="w-5 h-5 text-cyan-400" />, title: 'Instant Sharing', desc: 'Generate shareable links for interactive 3D walkthroughs with one click.' },
            ].map((f, i) => (
              <motion.div key={i} initial={{ opacity: 0, y: 15 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.08 }}
                className="bg-zinc-900/40 border border-white/[0.06] rounded-xl p-6 hover:border-white/[0.12] transition-all group">
                <div className="p-2.5 bg-white/[0.04] rounded-lg w-fit mb-4 group-hover:scale-110 transition-transform">{f.icon}</div>
                <h3 className="font-semibold mb-1.5">{f.title}</h3>
                <p className="text-sm text-zinc-400 leading-relaxed">{f.desc}</p>
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
              <Link href="/apply" className="inline-flex items-center gap-2 mt-8 text-indigo-400 font-medium text-sm hover:text-indigo-300 transition-colors group">
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
                <Link href="/apply" className={`w-full py-3 rounded-xl font-semibold text-sm text-center transition-all ${plan.highlighted ? 'bg-gradient-to-r from-indigo-500 to-violet-600 text-white hover:opacity-90 shadow-lg shadow-indigo-500/20' : 'bg-white/[0.05] border border-white/10 text-white hover:bg-white/[0.08]'}`}>
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
          <div className="relative bg-gradient-to-b from-white/[0.04] to-transparent border border-white/[0.08] rounded-[32px] p-16 md:p-24">
            <h2 className="text-4xl md:text-5xl font-bold mb-6 tracking-tight">Ready to build together?</h2>
            <p className="text-lg text-zinc-400 mb-10 max-w-xl mx-auto">Join hundreds of teams already designing the future with Archly. Free to start, no credit card required.</p>
            <Link href="/apply" className="inline-flex px-10 py-4 bg-gradient-to-r from-indigo-500 to-violet-600 text-white font-bold rounded-xl hover:opacity-90 transition-all text-base shadow-xl shadow-indigo-500/25">
              Get Started Free
            </Link>
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
              { title: 'Product', links: [{ label: 'Features', href: '#features' }, { label: 'Pricing', href: '#pricing' }, { label: 'Use Cases', href: '#use-cases' }, { label: 'Playground', href: '/editor' }] },
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
