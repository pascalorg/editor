import type { ReactNode } from "react";
import Link from "next/link";
import { LayoutDashboard, Users, FolderKanban, LogOut, Settings, Box } from "lucide-react";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const session = await getServerSession(authOptions);

  if (!session) {
    redirect("/login");
  }

  return (
    <div className="min-h-screen bg-[#050505] text-white flex">
      {/* Sidebar */}
      <aside className="w-64 border-r border-white/5 bg-[#0a0a0a] p-6 flex flex-col gap-8">
        <div className="flex items-center gap-3 px-2">
          <div className="w-8 h-8 bg-gradient-to-br from-indigo-500 to-violet-600 rounded-lg flex items-center justify-center">
            <Box className="w-5 h-5 text-white" />
          </div>
          <span className="font-bold text-xl tracking-tight">Archly</span>
        </div>

        <nav className="space-y-2">
          <NavItem href="/dashboard" icon={<LayoutDashboard size={20} />} label="Overview" />
          <NavItem href="/dashboard/teams" icon={<Users size={20} />} label="Teams" />
          <NavItem href="/dashboard/projects" icon={<FolderKanban size={20} />} label="Projects" />
          <NavItem href="/dashboard/members" icon={<Users size={20} />} label="Members" />
        </nav>

        <div className="mt-auto space-y-2">
          <NavItem href="/dashboard/settings" icon={<Settings size={20} />} label="Settings" />
          <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-pointer transition-all text-red-400 hover:bg-red-500/10">
            <LogOut size={20} />
            <span className="font-medium text-sm">Sign Out</span>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto">
        {children}
      </main>
    </div>
  );
}

function NavItem({ href, icon, label }: { href: string; icon: React.ReactNode; label: string }) {
  // Client-side active state would go here, but for simplicity we'll just style it as inactive
  return (
    <Link href={href}>
      <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-pointer transition-all text-gray-400 hover:bg-white/5 hover:text-white">
        {icon}
        <span className="font-medium text-sm">{label}</span>
      </div>
    </Link>
  );
}
