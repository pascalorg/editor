'use client'

import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { 
  LayoutDashboard, 
  Users, 
  CheckCircle, 
  XCircle, 
  Clock, 
  Search, 
  Filter,
  MoreVertical,
  ArrowUpRight,
  TrendingUp,
  BarChart3,
  ShieldCheck,
  TrendingDown,
  Activity
} from 'lucide-react'
import { 
  getApplications, 
  updateApplicationStatus 
} from './actions'

export default function AdminDashboard() {
  const [applications, setApplications] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [activeTab, setActiveTab] = useState<'ALL' | 'PENDING' | 'APPROVED' | 'ANALYTICS'>('ALL')

  useEffect(() => {
    async function load() {
      const data = await getApplications()
      setApplications(data)
      setLoading(false)
    }
    load()
  }, [])

  const handleStatusUpdate = async (id: string, status: 'APPROVED' | 'REJECTED') => {
    const result = await updateApplicationStatus(id, status)
    if (result.success) {
      setApplications(apps => apps.map(app => app.id === id ? { ...app, status } : app))
    }
  }

  const filteredApps = applications.filter(app => {
    const matchesSearch = app.orgName.toLowerCase().includes(search.toLowerCase()) || 
                          app.contactEmail.toLowerCase().includes(search.toLowerCase())
    const matchesTab = activeTab === 'ALL' || app.status === activeTab
    return matchesSearch && matchesTab
  })

  return (
    <div className="min-h-screen bg-[#050505] text-white flex">
      {/* Sidebar */}
      <aside className="w-64 border-r border-white/5 bg-[#0a0a0a] p-6 flex flex-col gap-8">
        <div className="flex items-center gap-3 px-2">
          <div className="w-8 h-8 bg-gradient-to-br from-indigo-500 to-violet-600 rounded-lg flex items-center justify-center">
            <ShieldCheck className="w-5 h-5 text-white" />
          </div>
          <span className="font-bold text-xl tracking-tight">Archly Admin</span>
        </div>

        <nav className="space-y-2">
          <NavItem 
            icon={<LayoutDashboard size={20} />} 
            label="Overview" 
            active={activeTab === 'ALL'} 
            onClick={() => setActiveTab('ALL')} 
          />
          <NavItem 
            icon={<Users size={20} />} 
            label="Applications" 
            count={applications.filter(a => a.status === 'PENDING').length} 
            active={activeTab === 'PENDING'} 
            onClick={() => setActiveTab('PENDING')} 
          />
          <NavItem 
            icon={<BarChart3 size={20} />} 
            label="Analytics" 
            active={activeTab === 'ANALYTICS'} 
            onClick={() => setActiveTab('ANALYTICS')} 
          />
        </nav>

        <div className="mt-auto pt-6 border-t border-white/5">
          <div className="flex items-center gap-3 px-2 py-3 hover:bg-white/5 rounded-xl cursor-pointer transition-colors">
            <div className="w-8 h-8 bg-gray-800 rounded-full" />
            <div className="flex flex-col">
              <span className="text-sm font-medium">Admin User</span>
              <span className="text-xs text-gray-500">Super Admin</span>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto p-10">
        <header className="flex items-center justify-between mb-12">
          <div>
            <h1 className="text-3xl font-bold">Organization Applications</h1>
            <p className="text-gray-400 mt-1">Manage and approve organizations for early access.</p>
          </div>
          <div className="flex items-center gap-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 w-4 h-4" />
              <input 
                type="text" 
                placeholder="Search organizations..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="bg-[#111] border border-white/10 rounded-xl pl-10 pr-4 py-2 w-64 focus:outline-none focus:ring-2 focus:ring-white/10 transition-all"
              />
            </div>
            <button className="bg-white text-black px-4 py-2 rounded-xl font-medium hover:bg-gray-200 transition-colors flex items-center gap-2">
              <Filter size={18} /> Filters
            </button>
          </div>
        </header>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10">
          <StatsCard label="Total Applications" value={applications.length} trend="+12%" icon={<TrendingUp className="text-blue-400" />} />
          <StatsCard label="Pending Approval" value={applications.filter(a => a.status === 'PENDING').length} trend="+5%" icon={<Clock className="text-yellow-400" />} />
          <StatsCard label="Approved Orgs" value={applications.filter(a => a.status === 'APPROVED').length} trend="+8%" icon={<CheckCircle className="text-green-400" />} />
        </div>

        {/* Tabs */}
        <div className="flex gap-4 mb-6 border-b border-white/5">
          <TabButton label="All" active={activeTab === 'ALL'} onClick={() => setActiveTab('ALL')} />
          <TabButton label="Pending" active={activeTab === 'PENDING'} onClick={() => setActiveTab('PENDING')} />
          <TabButton label="Approved" active={activeTab === 'APPROVED'} onClick={() => setActiveTab('APPROVED')} />
          <TabButton label="Analytics" active={activeTab === 'ANALYTICS'} onClick={() => setActiveTab('ANALYTICS')} />
        </div>

        {activeTab === 'ANALYTICS' ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <ChartCard title="Daily Applications" icon={<Activity size={18} className="text-blue-400" />}>
              <div className="h-64 flex items-end gap-2 px-4 pb-4">
                {[40, 70, 45, 90, 65, 80, 100].map((h, i) => (
                  <div key={i} className="flex-1 bg-blue-500/20 hover:bg-blue-500/40 transition-colors rounded-t-sm" style={{ height: `${h}%` }} />
                ))}
              </div>
              <div className="flex justify-between px-4 py-2 border-t border-white/5 text-[10px] text-gray-500">
                <span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span><span>Sat</span><span>Sun</span>
              </div>
            </ChartCard>
            <ChartCard title="Active Teams" icon={<Users size={18} className="text-purple-400" />}>
               <div className="h-64 flex items-end gap-2 px-4 pb-4">
                {[60, 50, 80, 70, 90, 110, 120].map((h, i) => (
                  <div key={i} className="flex-1 bg-purple-500/20 hover:bg-purple-500/40 transition-colors rounded-t-sm" style={{ height: `${h / 1.2}%` }} />
                ))}
              </div>
              <div className="flex justify-between px-4 py-2 border-t border-white/5 text-[10px] text-gray-500">
                <span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span><span>Sat</span><span>Sun</span>
              </div>
            </ChartCard>
          </div>
        ) : (
          /* Table */
          <div className="bg-[#0a0a0a] border border-white/5 rounded-2xl overflow-hidden">
            <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-white/5 text-gray-400 text-sm">
                <th className="px-6 py-4 font-medium">Organization</th>
                <th className="px-6 py-4 font-medium">Contact</th>
                <th className="px-6 py-4 font-medium">Team Size</th>
                <th className="px-6 py-4 font-medium">Status</th>
                <th className="px-6 py-4 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              <AnimatePresence mode="popLayout">
                {filteredApps.map((app) => (
                  <motion.tr 
                    key={app.id}
                    layout
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="border-b border-white/5 hover:bg-white/[0.02] transition-colors group"
                  >
                    <td className="px-6 py-5">
                      <div className="flex flex-col">
                        <span className="font-semibold text-white">{app.orgName}</span>
                        <span className="text-xs text-gray-500 mt-0.5 truncate max-w-[200px]">{app.useCase}</span>
                      </div>
                    </td>
                    <td className="px-6 py-5">
                      <div className="flex flex-col">
                        <span className="text-sm">{app.contactName}</span>
                        <span className="text-xs text-gray-500">{app.contactEmail}</span>
                      </div>
                    </td>
                    <td className="px-6 py-5">
                      <span className="text-sm bg-white/5 px-2 py-1 rounded-md border border-white/5">
                        {app.teamSize}
                      </span>
                    </td>
                    <td className="px-6 py-5">
                      <StatusBadge status={app.status as any} />
                    </td>
                    <td className="px-6 py-5 text-right">
                      <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        {app.status === 'PENDING' && (
                          <>
                            <button 
                              onClick={() => handleStatusUpdate(app.id, 'APPROVED')}
                              className="p-2 hover:bg-green-500/20 text-green-500 rounded-lg transition-colors" title="Approve"
                            >
                              <CheckCircle size={18} />
                            </button>
                            <button 
                              onClick={() => handleStatusUpdate(app.id, 'REJECTED')}
                              className="p-2 hover:bg-red-500/20 text-red-500 rounded-lg transition-colors" title="Reject"
                            >
                              <XCircle size={18} />
                            </button>
                          </>
                        )}
                        <button className="p-2 hover:bg-white/10 text-gray-400 rounded-lg transition-colors">
                          <MoreVertical size={18} />
                        </button>
                      </div>
                    </td>
                  </motion.tr>
                ))}
              </AnimatePresence>
            </tbody>
          </table>
          {filteredApps.length === 0 && (
            <div className="py-20 text-center text-gray-500">
              No applications found matching your criteria.
            </div>
          )}
        </div>
        )}
      </main>
    </div>
  )
}

function ChartCard({ title, icon, children }: { title: string, icon: React.ReactNode, children: React.ReactNode }) {
  return (
    <div className="bg-[#0a0a0a] border border-white/5 rounded-2xl p-6 flex flex-col">
      <div className="flex items-center gap-3 mb-8">
        <div className="p-2 bg-white/5 rounded-lg">{icon}</div>
        <h3 className="font-semibold">{title}</h3>
      </div>
      {children}
    </div>
  )
}

function NavItem({ icon, label, count, active = false, onClick }: { icon: React.ReactNode, label: string, count?: number, active?: boolean, onClick?: () => void }) {
  return (
    <div 
      onClick={onClick}
      className={`flex items-center justify-between px-3 py-2.5 rounded-xl cursor-pointer transition-all ${active ? 'bg-white text-black' : 'text-gray-400 hover:bg-white/5 hover:text-white'}`}
    >
      <div className="flex items-center gap-3">
        {icon}
        <span className="font-medium text-sm">{label}</span>
      </div>
      {count !== undefined && (
        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${active ? 'bg-black text-white' : 'bg-white/10 text-gray-400'}`}>
          {count}
        </span>
      )}
    </div>
  )
}

function StatsCard({ label, value, trend, icon }: { label: string, value: number | string, trend: string, icon: React.ReactNode }) {
  return (
    <div className="bg-[#0a0a0a] border border-white/5 rounded-2xl p-6 hover:border-white/10 transition-colors">
      <div className="flex items-center justify-between mb-4">
        <div className="p-2 bg-white/5 rounded-lg">
          {icon}
        </div>
        <div className="flex items-center gap-1 text-green-400 text-xs font-bold bg-green-400/10 px-2 py-0.5 rounded-full">
          {trend} <ArrowUpRight size={12} />
        </div>
      </div>
      <div className="flex flex-col">
        <span className="text-gray-400 text-sm font-medium">{label}</span>
        <span className="text-3xl font-bold mt-1">{value}</span>
      </div>
    </div>
  )
}

function TabButton({ label, active, onClick }: { label: string, active: boolean, onClick: () => void }) {
  return (
    <button 
      onClick={onClick}
      className={`px-4 py-3 text-sm font-medium transition-all relative ${active ? 'text-white' : 'text-gray-500 hover:text-gray-300'}`}
    >
      {label}
      {active && (
        <motion.div 
          layoutId="activeTab"
          className="absolute bottom-0 left-0 right-0 h-0.5 bg-white"
        />
      )}
    </button>
  )
}

function StatusBadge({ status }: { status: 'PENDING' | 'APPROVED' | 'REJECTED' }) {
  const styles = {
    PENDING: 'bg-yellow-400/10 text-yellow-400 border-yellow-400/20',
    APPROVED: 'bg-green-400/10 text-green-400 border-green-400/20',
    REJECTED: 'bg-red-400/10 text-red-400 border-red-400/20'
  }

  return (
    <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-full border ${styles[status]}`}>
      {status}
    </span>
  )
}
