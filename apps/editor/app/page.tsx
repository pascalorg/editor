'use client'

import { motion } from 'framer-motion'
import { 
  ArrowRight, 
  Layers, 
  Zap, 
  Users2, 
  ShieldCheck, 
  Globe2, 
  Cpu,
  MonitorCheck,
  Building2,
  Box,
  MousePointer2,
  Share2
} from 'lucide-react'
import Link from 'next/link'

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-[#050505] text-white selection:bg-white selection:text-black">
      {/* Navbar */}
      <nav className="fixed top-0 left-0 right-0 z-50 border-b border-white/5 bg-black/50 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-white rounded-lg flex items-center justify-center">
              <Box className="w-5 h-5 text-black" />
            </div>
            <span className="font-bold text-xl tracking-tighter">PASCAL</span>
          </div>
          
          <div className="hidden md:flex items-center gap-8 text-sm font-medium text-gray-400">
            <a href="#features" className="hover:text-white transition-colors">Features</a>
            <a href="#teams" className="hover:text-white transition-colors">Teams</a>
            <a href="#enterprise" className="hover:text-white transition-colors">Enterprise</a>
            <a href="#pricing" className="hover:text-white transition-colors">Pricing</a>
          </div>

          <div className="flex items-center gap-4">
            <Link href="/admin" className="text-sm font-medium text-gray-400 hover:text-white transition-colors">
              Admin
            </Link>
            <Link 
              href="/apply" 
              className="px-4 py-2 bg-white text-black text-sm font-bold rounded-full hover:bg-gray-200 transition-all"
            >
              Apply for Beta
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="relative pt-32 pb-20 px-6 overflow-hidden">
        {/* Animated Background Gradients */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-4xl h-[500px] bg-blue-600/20 blur-[120px] rounded-full pointer-events-none opacity-50" />
        <div className="absolute top-40 left-1/4 w-64 h-64 bg-purple-600/10 blur-[100px] rounded-full pointer-events-none" />

        <div className="max-w-5xl mx-auto text-center relative z-10">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-white/10 bg-white/5 text-xs font-medium mb-8"
          >
            <span className="flex h-2 w-2 rounded-full bg-blue-500 animate-pulse" />
            Pascal Collaborative Beta is now open
            <ArrowRight className="w-3 h-3" />
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.1 }}
            className="text-6xl md:text-8xl font-extrabold tracking-tighter mb-8 bg-gradient-to-b from-white via-white to-gray-500 bg-clip-text text-transparent"
          >
            The spatial engine <br className="hidden md:block" /> for modern teams.
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="text-xl text-gray-400 max-w-2xl mx-auto mb-10 leading-relaxed"
          >
            Build, collaborate, and deploy high-performance 3D buildings in real-time. 
            Pascal combines WebGPU power with seamless team workflows.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.3 }}
            className="flex flex-col sm:flex-row items-center justify-center gap-4"
          >
            <Link 
              href="/apply" 
              className="w-full sm:w-auto px-8 py-4 bg-white text-black font-bold rounded-2xl hover:bg-gray-200 transition-all flex items-center justify-center gap-2 text-lg group"
            >
              Get Early Access <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
            </Link>
            <Link 
              href="/editor" 
              className="w-full sm:w-auto px-8 py-4 bg-white/5 border border-white/10 text-white font-bold rounded-2xl hover:bg-white/10 transition-all flex items-center justify-center gap-2 text-lg"
            >
              Try Playground
            </Link>
          </motion.div>
        </div>

        {/* Hero Mockup */}
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1, delay: 0.4 }}
          className="mt-24 max-w-6xl mx-auto"
        >
          <div className="relative p-2 rounded-3xl border border-white/10 bg-white/5 backdrop-blur-2xl shadow-2xl overflow-hidden group">
            <div className="absolute inset-0 bg-gradient-to-tr from-blue-500/10 via-transparent to-purple-500/10 pointer-events-none" />
            <img 
              src="https://framerusercontent.com/images/8rU9X7wE6L7yQ1y8rU9X7wE6L7y.png" // Placeholder high-res 3D UI
              alt="Pascal Editor Interface" 
              className="rounded-2xl w-full h-auto grayscale-[0.2] group-hover:grayscale-0 transition-all duration-700"
            />
            
            {/* Overlay Presence Indicators */}
            <div className="absolute top-1/2 left-1/3 flex flex-col items-center gap-1 pointer-events-none">
              <MousePointer2 className="w-5 h-5 text-blue-500 fill-blue-500 -rotate-90 drop-shadow-lg" />
              <div className="bg-blue-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-md shadow-xl">Sarah</div>
            </div>
            <div className="absolute bottom-1/4 right-1/4 flex flex-col items-center gap-1 pointer-events-none">
              <MousePointer2 className="w-5 h-5 text-purple-500 fill-purple-500 -rotate-90 drop-shadow-lg" />
              <div className="bg-purple-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-md shadow-xl">Marcus</div>
            </div>
          </div>
        </motion.div>
      </section>

      {/* Trust Logos */}
      <section className="py-20 border-y border-white/5 bg-[#080808]">
        <div className="max-w-7xl mx-auto px-6">
          <p className="text-center text-sm font-medium text-gray-500 mb-12 uppercase tracking-widest">
            Trusted by the next generation of builders
          </p>
          <div className="flex flex-wrap justify-center items-center gap-12 md:gap-24 opacity-30 grayscale invert">
            <Building2 className="w-32 h-12" />
            <Globe2 className="w-32 h-12" />
            <MonitorCheck className="w-32 h-12" />
            <ShieldCheck className="w-32 h-12" />
            <Layers className="w-32 h-12" />
          </div>
        </div>
      </section>

      {/* Features Grid */}
      <section id="features" className="py-32 px-6">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-24">
            <h2 className="text-4xl md:text-6xl font-bold tracking-tight mb-6">Built for speed. <br /> Designed for scale.</h2>
            <p className="text-xl text-gray-400 max-w-2xl mx-auto">
              The only spatial platform that doesn't compromise on performance or collaborative depth.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <FeatureCard 
              icon={<Zap className="w-6 h-6 text-yellow-400" />}
              title="WebGPU Powered"
              description="High-fidelity 3D rendering directly in the browser with native performance."
            />
            <FeatureCard 
              icon={<Users2 className="w-6 h-6 text-blue-400" />}
              title="Real-time Collaboration"
              description="Work together on the same scene. See cursors, selections, and updates instantly."
            />
            <FeatureCard 
              icon={<Layers className="w-6 h-6 text-purple-400" />}
              title="Smart State Sync"
              description="Delta-based synchronization ensures smooth editing even on complex builds."
            />
            <FeatureCard 
              icon={<Cpu className="w-6 h-6 text-green-400" />}
              title="Parametric Core"
              description="Nodes are logically grouped and parametric, allowing for non-destructive editing."
            />
            <FeatureCard 
              icon={<Share2 className="w-6 h-6 text-pink-400" />}
              title="Instant Sharing"
              description="One-click deployment to share your interactive 3D scenes with anyone."
            />
            <FeatureCard 
              icon={<ShieldCheck className="w-6 h-6 text-red-400" />}
              title="Enterprise Grade"
              description="Organization management, roles, and project permissions baked in from day one."
            />
          </div>
        </div>
      </section>

      {/* Team Collaboration Section */}
      <section id="teams" className="py-32 px-6 bg-white/[0.02]">
        <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-20 items-center">
          <div>
            <span className="text-blue-500 font-bold text-sm uppercase tracking-wider mb-4 block">Team Workspace</span>
            <h2 className="text-4xl md:text-5xl font-bold mb-8 leading-tight">
              Bring your entire organization <br /> into the scene.
            </h2>
            <p className="text-lg text-gray-400 mb-10 leading-relaxed">
              Pascal Teams provides a centralized workspace for your organization. Manage departments, teams, and projects with ease. Approval workflows and activity logs keep your designs synchronized.
            </p>
            
            <ul className="space-y-4">
              <li className="flex items-center gap-3 text-gray-300">
                <div className="w-5 h-5 rounded-full bg-blue-500/20 flex items-center justify-center">
                  <CheckCircle className="w-3 h-3 text-blue-500" />
                </div>
                Role-based access control (RBAC)
              </li>
              <li className="flex items-center gap-3 text-gray-300">
                <div className="w-5 h-5 rounded-full bg-blue-500/20 flex items-center justify-center">
                  <CheckCircle className="w-3 h-3 text-blue-500" />
                </div>
                Organization-wide asset library
              </li>
              <li className="flex items-center gap-3 text-gray-300">
                <div className="w-5 h-5 rounded-full bg-blue-500/20 flex items-center justify-center">
                  <CheckCircle className="w-3 h-3 text-blue-500" />
                </div>
                Shared project versioning and history
              </li>
            </ul>
          </div>
          <div className="relative">
            <div className="absolute inset-0 bg-blue-500/20 blur-[100px] pointer-events-none" />
            <div className="bg-[#111] border border-white/10 rounded-3xl p-8 relative z-10 shadow-3xl">
              {/* Mock Admin UI Snippet */}
              <div className="flex items-center justify-between mb-8 pb-4 border-b border-white/5">
                <span className="font-bold text-sm">Teams & Permissions</span>
                <Users2 className="w-5 h-5 text-gray-500" />
              </div>
              <div className="space-y-6">
                <TeamRow name="Engineering" members={12} role="Admin" />
                <TeamRow name="Design" members={8} role="Editor" />
                <TeamRow name="Marketing" members={5} role="Viewer" />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-40 px-6">
        <div className="max-w-4xl mx-auto text-center bg-gradient-to-b from-white/5 to-transparent border border-white/10 rounded-[40px] p-12 md:p-24 relative overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-full bg-blue-600/5 blur-[80px] pointer-events-none" />
          <h2 className="text-4xl md:text-6xl font-bold mb-8 leading-tight">Ready to build <br /> the future?</h2>
          <p className="text-xl text-gray-400 mb-12 max-w-xl mx-auto">
            Apply for our early access program today and be the first to experience collaborative 3D building.
          </p>
          <Link 
            href="/apply" 
            className="inline-flex px-10 py-5 bg-white text-black font-bold rounded-2xl hover:bg-gray-200 transition-all text-xl shadow-xl shadow-white/10"
          >
            Apply for Beta Access
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-20 px-6 border-t border-white/5">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-start gap-12">
          <div className="space-y-6">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-white rounded-lg flex items-center justify-center">
                <Box className="w-5 h-5 text-black" />
              </div>
              <span className="font-bold text-xl tracking-tighter">PASCAL</span>
            </div>
            <p className="text-gray-500 max-w-xs text-sm">
              The next-generation spatial engine for collaborative 3D building and design.
            </p>
          </div>
          
          <div className="grid grid-cols-2 md:grid-cols-3 gap-16">
            <FooterColumn title="Product" links={['Features', 'Teams', 'Pricing', 'API']} />
            <FooterColumn title="Resources" links={['Docs', 'Community', 'Support', 'Terms']} />
            <FooterColumn title="Company" links={['About', 'Blog', 'Careers', 'Contact']} />
          </div>
        </div>
        <div className="max-w-7xl mx-auto mt-20 pt-8 border-t border-white/5 flex justify-between items-center text-xs text-gray-600 font-medium">
          <span>&copy; 2024 Pascal Systems Inc.</span>
          <div className="flex gap-6">
            <span>Twitter</span>
            <span>Discord</span>
            <span>GitHub</span>
          </div>
        </div>
      </footer>
    </div>
  )
}

function FeatureCard({ icon, title, description }: { icon: React.ReactNode, title: string, description: string }) {
  return (
    <div className="bg-[#0a0a0a] border border-white/5 rounded-3xl p-8 hover:border-white/20 transition-all hover:bg-white/[0.02] group">
      <div className="p-3 bg-white/5 rounded-2xl w-fit mb-6 group-hover:scale-110 transition-transform">
        {icon}
      </div>
      <h3 className="text-xl font-bold mb-3">{title}</h3>
      <p className="text-gray-400 leading-relaxed">{description}</p>
    </div>
  )
}

function TeamRow({ name, members, role }: { name: string, members: number, role: string }) {
  return (
    <div className="flex items-center justify-between group">
      <div className="flex items-center gap-4">
        <div className="w-10 h-10 bg-white/5 rounded-xl flex items-center justify-center group-hover:bg-white/10 transition-colors">
          <Building2 size={18} className="text-gray-400" />
        </div>
        <div>
          <div className="text-sm font-bold">{name}</div>
          <div className="text-xs text-gray-500">{members} members</div>
        </div>
      </div>
      <div className="text-xs font-medium px-3 py-1 bg-white/5 border border-white/10 rounded-full group-hover:bg-white/10 transition-colors">
        {role}
      </div>
    </div>
  )
}

function FooterColumn({ title, links }: { title: string, links: string[] }) {
  return (
    <div className="space-y-4">
      <h4 className="text-xs font-bold uppercase tracking-widest text-white">{title}</h4>
      <ul className="space-y-3">
        {links.map((link) => (
          <li key={link}>
            <a href="#" className="text-sm text-gray-500 hover:text-white transition-colors">{link}</a>
          </li>
        ))}
      </ul>
    </div>
  )
}

function CheckCircle({ className }: { className?: string }) {
  return (
    <svg 
      className={className} 
      viewBox="0 0 24 24" 
      fill="none" 
      stroke="currentColor" 
      strokeWidth="3" 
      strokeLinecap="round" 
      strokeLinejoin="round"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  )
}
