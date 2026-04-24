'use client'

import { motion } from 'framer-motion'
import { ReactNode } from 'react'

interface GlassProps {
  children: ReactNode
  className?: string
  delay?: number
}

export function GlassCard({ children, className = "", delay = 0 }: GlassProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.8, delay, ease: [0.16, 1, 0.3, 1] }}
      whileHover={{ y: -5, transition: { duration: 0.2 } }}
      className={`
        relative overflow-hidden
        bg-white/40 backdrop-blur-2xl 
        border border-white/50 
        shadow-[0_8px_32px_0_rgba(31,38,135,0.07)]
        rounded-2xl
        ${className}
      `}
    >
      {/* Specular Highlight */}
      <div className="absolute inset-0 bg-gradient-to-br from-white/20 to-transparent pointer-events-none" />
      <div className="relative z-10">{children}</div>
    </motion.div>
  )
}

export function GlassButton({ children, className = "", onClick }: GlassProps & { onClick?: () => void }) {
  return (
    <motion.button
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
      onClick={onClick}
      className={`
        relative px-6 py-3 rounded-xl font-semibold text-sm
        bg-white/60 backdrop-blur-xl
        border border-white/60
        shadow-[0_4px_16px_rgba(0,0,0,0.04)]
        hover:shadow-[0_8px_24px_rgba(0,0,0,0.08)]
        hover:bg-white/80
        transition-all duration-200
        text-slate-900
        ${className}
      `}
    >
      {/* Liquid Reflection Effect */}
      <div className="absolute inset-0 overflow-hidden rounded-xl">
        <motion.div 
          animate={{ 
            x: ['-100%', '100%'],
          }}
          transition={{ 
            duration: 3, 
            repeat: Infinity, 
            ease: "linear" 
          }}
          className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent skew-x-12"
        />
      </div>
      <span className="relative z-10">{children}</span>
    </motion.button>
  )
}

export function GlassNavbar({ children, className = "" }: GlassProps) {
  return (
    <nav className={`
      fixed top-6 left-1/2 -translate-x-1/2 z-50
      w-[calc(100%-3rem)] max-w-5xl
      px-6 py-3 rounded-2xl
      bg-white/40 backdrop-blur-2xl
      border border-white/50
      shadow-[0_8px_32px_0_rgba(0,0,0,0.05)]
      flex items-center justify-between
      ${className}
    `}>
      {children}
    </nav>
  )
}
