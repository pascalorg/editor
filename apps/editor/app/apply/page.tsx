'use client'

import { useState } from 'react'
import { motion } from 'framer-motion'
import { CheckCircle2, Send, Building2, Users, Mail, MessageSquare, AlertCircle } from 'lucide-react'
import { submitApplication } from './actions'

export default function ApplyPage() {
  const [submitted, setSubmitted] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    
    const formData = new FormData(e.currentTarget)
    const data = {
      orgName: formData.get('orgName') as string,
      contactName: formData.get('contactName') as string,
      contactEmail: formData.get('contactEmail') as string,
      useCase: formData.get('useCase') as string,
      teamSize: formData.get('teamSize') as string,
    }

    const result = await submitApplication(data)
    
    if (result.success) {
      setSubmitted(true)
    } else {
      setError(result.error || 'Something went wrong')
    }
    setLoading(false)
  }

  if (submitted) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center p-4">
        <motion.div 
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="max-w-md w-full bg-[#111] border border-white/10 rounded-2xl p-8 text-center space-y-6"
        >
          <div className="flex justify-center">
            <div className="w-20 h-20 bg-green-500/20 rounded-full flex items-center justify-center">
              <CheckCircle2 className="w-10 h-10 text-green-500" />
            </div>
          </div>
          <h1 className="text-3xl font-bold text-white">Application Received!</h1>
          <p className="text-gray-400">
            Thank you for applying for early access to Pascal Teams. Our team will review your application and get back to you shortly.
          </p>
          <button 
            onClick={() => window.location.href = '/'}
            className="w-full py-3 bg-white text-black font-semibold rounded-xl hover:bg-gray-200 transition-colors"
          >
            Return Home
          </button>
        </motion.div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white flex flex-col items-center py-20 px-4">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="max-w-2xl w-full space-y-12"
      >
        <div className="text-center space-y-4">
          <h1 className="text-5xl font-extrabold tracking-tight bg-gradient-to-r from-white to-gray-500 bg-clip-text text-transparent">
            Join the Future of Collaborative 3D Design
          </h1>
          <p className="text-xl text-gray-400">
            Apply for early access to Pascal Teams and start building together in real-time.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="bg-[#111] border border-white/10 rounded-3xl p-8 space-y-8 shadow-2xl">
          {error && (
            <div className="bg-red-500/10 border border-red-500/20 text-red-500 px-4 py-3 rounded-xl flex items-center gap-3">
              <AlertCircle size={20} />
              <p className="text-sm font-medium">{error}</p>
            </div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-400 flex items-center gap-2">
                <Building2 className="w-4 h-4" /> Organization Name
              </label>
              <input 
                required
                name="orgName"
                type="text" 
                placeholder="Acme Corp"
                className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-white/20 transition-all"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-400 flex items-center gap-2">
                <Users className="w-4 h-4" /> Team Size
              </label>
              <select 
                name="teamSize"
                className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-white/20 transition-all"
              >
                <option>1-5 members</option>
                <option>6-20 members</option>
                <option>21-100 members</option>
                <option>100+ members</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-400 flex items-center gap-2">
                <Mail className="w-4 h-4" /> Contact Email
              </label>
              <input 
                required
                name="contactEmail"
                type="email" 
                placeholder="john@example.com"
                className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-white/20 transition-all"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-400 flex items-center gap-2">
                <Users className="w-4 h-4" /> Your Name
              </label>
              <input 
                required
                name="contactName"
                type="text" 
                placeholder="John Doe"
                className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-white/20 transition-all"
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-400 flex items-center gap-2">
              <MessageSquare className="w-4 h-4" /> Use Case
            </label>
            <textarea 
              required
              name="useCase"
              rows={4}
              placeholder="Tell us how your team plans to use Pascal..."
              className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-white/20 transition-all resize-none"
            />
          </div>

          <button 
            type="submit"
            disabled={loading}
            className="w-full py-4 bg-white text-black font-bold rounded-2xl hover:bg-gray-200 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {loading ? (
              <div className="w-6 h-6 border-2 border-black/20 border-t-black rounded-full animate-spin" />
            ) : (
              <>
                Submit Application <Send className="w-4 h-4" />
              </>
            )}
          </button>
        </form>

        <p className="text-center text-gray-500 text-sm">
          By applying, you agree to our terms of service and privacy policy.
        </p>
      </motion.div>
    </div>
  )
}
