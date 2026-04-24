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
import LiquidBackground from '../components/LiquidBackground'
import { GlassCard, GlassButton, GlassNavbar } from '../components/GlassComponent'

const container = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1
    }
  }
}

const item = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0, transition: { duration: 0.8, ease: [0.16, 1, 0.3, 1] } }
}

export default function LandingPage() {
  const [activeUseCase, setActiveUseCase] = useState(0)
  const useCases = [
    { title: 'Architecture', icon: <Building2 className="w-5 h-5" />, desc: 'Create detailed building models with parametric walls, slabs, roofs, and intelligent room layouts.' },
    { title: 'Real Estate', icon: <LayoutGrid className="w-5 h-5" />, desc: 'Present interactive 3D walkthroughs to clients. Showcase properties with photorealistic materials.' },
    { title: 'Construction', icon: <Grid3X3 className="w-5 h-5" />, desc: 'Coordinate across teams with shared project workspaces. Track changes and manage versions.' },
  ]

  return (
    <div className="relative min-h-screen font-sans selection:bg-indigo-500/10 selection:text-indigo-900">
      <LiquidBackground />

      {/* Navbar */}
      <GlassNavbar>
        <Link href="/" className="flex items-center gap-2">
          <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center shadow-lg shadow-indigo-200/50">
            <Box className="w-4.5 h-4.5 text-white" />
          </div>
          <span className="font-bold text-lg tracking-tight text-slate-900">archly</span>
        </Link>
        <div className="hidden md:flex items-center gap-8 text-[13px] font-medium text-slate-600">
          <a href="#features" className="hover:text-indigo-600 transition-colors">Features</a>
          <a href="#use-cases" className="hover:text-indigo-600 transition-colors">Use Cases</a>
          <a href="#pricing" className="hover:text-indigo-600 transition-colors">Pricing</a>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/login" className="text-[13px] font-medium text-slate-600 hover:text-indigo-600 transition-colors px-3 py-1.5">Sign In</Link>
          <Link href="/apply">
            <GlassButton className="!px-4 !py-2 bg-indigo-600 !text-white border-indigo-500 shadow-indigo-200/50">
              Get Started
            </GlassButton>
          </Link>
        </div>
      </GlassNavbar>

      {/* Hero Section */}
      <section className="pt-48 pb-32 px-6">
        <div className="max-w-5xl mx-auto text-center">
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.5 }}
            className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/50 backdrop-blur-md border border-white/60 shadow-sm text-[11px] font-bold text-indigo-600 uppercase tracking-wider mb-8"
          >
            <Sparkles className="w-3.5 h-3.5" />
            Next-Gen Architectural Platform
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="text-6xl sm:text-7xl md:text-8xl font-bold tracking-tight text-slate-900 mb-8 leading-[0.95]"
          >
            Design the <br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-600 to-violet-600">future in glass.</span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.3, ease: [0.16, 1, 0.3, 1] }}
            className="text-lg md:text-xl text-slate-600 max-w-2xl mx-auto mb-12 leading-relaxed"
          >
            Archly.Cloud is the collaborative 3D spatial platform for teams. 
            Native-grade performance meets fluid collaboration in your browser.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.4, ease: [0.16, 1, 0.3, 1] }}
            className="flex flex-col sm:flex-row items-center justify-center gap-4"
          >
            <Link href="/apply">
              <GlassButton className="w-full sm:w-auto px-8 py-4 bg-indigo-600 !text-white shadow-xl shadow-indigo-100">
                Start Building Free
              </GlassButton>
            </Link>
            <Link href="/playground">
              <GlassButton className="w-full sm:w-auto px-8 py-4">
                <Play className="w-4 h-4 mr-2 inline" /> Try Playground
              </GlassButton>
            </Link>
          </motion.div>
        </div>

        {/* Hero Mockup */}
        <motion.div
          initial={{ opacity: 0, y: 100 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1.2, delay: 0.5, ease: [0.16, 1, 0.3, 1] }}
          className="mt-24 max-w-6xl mx-auto"
        >
          <GlassCard className="aspect-[16/10] p-1 shadow-2xl">
            <div className="w-full h-full bg-slate-50/50 rounded-xl flex items-center justify-center relative overflow-hidden group">
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(99,102,241,0.05)_0%,transparent_100%)]" />
              <div className="absolute inset-0 bg-[linear-gradient(rgba(0,0,0,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(0,0,0,0.02)_1px,transparent_1px)] bg-[size:40px_40px]" />
              
              <Box className="w-20 h-20 text-slate-200 group-hover:text-indigo-200 transition-colors duration-500" />
              
              {/* Floating Collaborative Cursors */}
              <motion.div 
                animate={{ x: [20, 100, 50, 20], y: [40, 0, 80, 40] }}
                transition={{ duration: 10, repeat: Infinity }}
                className="absolute top-1/4 left-1/4 flex flex-col items-start gap-1 pointer-events-none"
              >
                <MousePointer2 className="w-5 h-5 text-indigo-500 fill-indigo-500 drop-shadow-xl" />
                <span className="bg-indigo-600 text-white text-[10px] font-bold px-2 py-1 rounded-full shadow-lg">Sarah K.</span>
              </motion.div>

              <motion.div 
                animate={{ x: [-50, -150, -80, -50], y: [20, 100, 40, 20] }}
                transition={{ duration: 8, repeat: Infinity, delay: 1 }}
                className="absolute bottom-1/3 right-1/3 flex flex-col items-start gap-1 pointer-events-none"
              >
                <MousePointer2 className="w-5 h-5 text-rose-500 fill-rose-500 drop-shadow-xl" />
                <span className="bg-rose-600 text-white text-[10px] font-bold px-2 py-1 rounded-full shadow-lg">Marcus R.</span>
              </motion.div>
            </div>
          </GlassCard>
        </motion.div>
      </section>

      {/* Features Grid */}
      <section id="features" className="py-32 px-6">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-20">
            <h2 className="text-4xl md:text-5xl font-bold text-slate-900 mb-4 tracking-tight">Pure Performance.</h2>
            <p className="text-slate-600 text-lg">Everything you need to build collaborative spatial experiences.</p>
          </div>

          <motion.div
            variants={container}
            initial="hidden"
            whileInView="show"
            viewport={{ once: true }}
            className="grid grid-cols-1 md:grid-cols-3 gap-6"
          >
            {[
              { icon: <Zap className="text-indigo-500" />, title: 'WebGPU Engine', desc: 'Native 3D rendering performance directly in your browser with no plugins required.' },
              { icon: <Users2 className="text-violet-500" />, title: 'Live Sync', desc: 'Real-time collaboration powered by Yjs and Redis with sub-millisecond latency.' },
              { icon: <Layers className="text-blue-500" />, title: 'Procedural Tools', desc: 'Intelligent building systems that handle complex geometry calculations automatically.' },
              { icon: <ShieldCheck className="text-emerald-500" />, title: 'Enterprise Security', desc: 'Full RBAC and organization management built for professional design teams.' },
              { icon: <Palette className="text-rose-500" />, title: 'Material Library', desc: 'Extensive library of high-fidelity PBR materials for realistic visualizations.' },
              { icon: <Globe2 className="text-cyan-500" />, title: 'Instant Deploy', desc: 'Share your designs with a single link. Interactive 3D walkthroughs for any device.' },
            ].map((f, i) => (
              <motion.div key={i} variants={item}>
                <GlassCard className="p-8 h-full">
                  <div className="w-12 h-12 rounded-xl bg-white shadow-sm border border-slate-100 flex items-center justify-center mb-6">
                    {f.icon}
                  </div>
                  <h3 className="text-xl font-bold text-slate-900 mb-3">{f.title}</h3>
                  <p className="text-slate-600 leading-relaxed text-sm">{f.desc}</p>
                </GlassCard>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* Use Cases */}
      <section id="use-cases" className="py-32 px-6 relative">
        <div className="max-w-6xl mx-auto">
          <div className="flex flex-col lg:flex-row items-center gap-16">
            <div className="flex-1">
              <h2 className="text-4xl md:text-5xl font-bold text-slate-900 mb-8 tracking-tight leading-tight">
                Built for the <br /> modern workspace.
              </h2>
              <div className="space-y-4">
                {useCases.map((uc, i) => (
                  <button
                    key={i}
                    onClick={() => setActiveUseCase(i)}
                    className={`w-full text-left p-6 rounded-2xl border transition-all duration-300 ${
                      activeUseCase === i 
                      ? 'bg-white/80 border-indigo-200 shadow-xl shadow-indigo-100/50 translate-x-2' 
                      : 'bg-white/30 border-transparent hover:bg-white/50 text-slate-500'
                    }`}
                  >
                    <div className="flex items-center gap-4 mb-2">
                      <div className={`p-2 rounded-lg ${activeUseCase === i ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-400'}`}>
                        {uc.icon}
                      </div>
                      <span className={`font-bold ${activeUseCase === i ? 'text-slate-900' : 'text-slate-500'}`}>{uc.title}</span>
                    </div>
                    <p className={`text-sm leading-relaxed transition-opacity ${activeUseCase === i ? 'opacity-100' : 'opacity-60'}`}>
                      {uc.desc}
                    </p>
                  </button>
                ))}
              </div>
            </div>
            <div className="flex-1 w-full">
              <GlassCard className="aspect-square flex items-center justify-center relative overflow-hidden group">
                <motion.div
                  key={activeUseCase}
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ duration: 0.5 }}
                  className="text-center"
                >
                  <Eye className="w-16 h-16 text-indigo-100 mb-4 mx-auto group-hover:text-indigo-200 transition-colors" />
                  <span className="text-slate-400 font-medium">Interactive Preview</span>
                </motion.div>
              </GlassCard>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-32 px-6">
        <GlassCard className="max-w-4xl mx-auto p-16 md:p-24 text-center bg-indigo-600 !border-indigo-500 shadow-2xl shadow-indigo-200">
          <h2 className="text-4xl md:text-5xl font-bold text-white mb-6 tracking-tight">Ready to build?</h2>
          <p className="text-indigo-100 text-lg mb-12 max-w-xl mx-auto">
            Join the community of forward-thinking designers. 
            Free to start, upgrade as you grow.
          </p>
          <Link href="/apply">
            <GlassButton className="!px-12 !py-5 !bg-white !text-indigo-600 text-lg font-bold shadow-2xl">
              Get Started Now
            </GlassButton>
          </Link>
        </GlassCard>
      </section>

      {/* Footer */}
      <footer className="py-20 px-6 border-t border-slate-200/50 bg-white/30 backdrop-blur-sm">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row justify-between items-start gap-12">
          <div className="max-w-xs space-y-4">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 bg-indigo-600 rounded flex items-center justify-center">
                <Box className="w-3.5 h-3.5 text-white" />
              </div>
              <span className="font-bold text-slate-900 tracking-tight">archly</span>
            </div>
            <p className="text-slate-500 text-sm leading-relaxed">
              The collaborative 3D spatial platform for teams that build the physical world.
            </p>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-12">
            {[
              { title: 'Product', links: ['Features', 'Pricing', 'Playground'] },
              { title: 'Resources', links: ['Docs', 'Support', 'Changelog'] },
              { title: 'Legal', links: ['Terms', 'Privacy', 'Contact'] },
            ].map((col, i) => (
              <div key={i} className="space-y-4">
                <h4 className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{col.title}</h4>
                <ul className="space-y-2">
                  {col.links.map((link, j) => (
                    <li key={j}>
                      <a href="#" className="text-sm text-slate-600 hover:text-indigo-600 transition-colors">{link}</a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
        <div className="max-w-6xl mx-auto mt-20 pt-8 border-t border-slate-200/30 flex justify-between items-center text-[11px] font-medium text-slate-400">
          <span>&copy; 2026 ARCHLY INC. ALL RIGHTS RESERVED.</span>
          <div className="flex gap-6">
            <a href="#" className="hover:text-indigo-600 transition-colors uppercase tracking-widest">Twitter</a>
            <a href="#" className="hover:text-indigo-600 transition-colors uppercase tracking-widest">Discord</a>
            <a href="#" className="hover:text-indigo-600 transition-colors uppercase tracking-widest">GitHub</a>
          </div>
        </div>
      </footer>
    </div>
  )
}
