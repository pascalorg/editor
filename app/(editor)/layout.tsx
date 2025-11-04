import { AppSidebar } from '@/components/app-sidebar'
import { NodesDebugger } from '@/components/debug/nodes-debugger'
import { SidebarProvider } from '@/components/ui/sidebar'

export default function EditorLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <SidebarProvider>
      <main className="h-screen w-full">
        <AppSidebar />
        {children}
        {process.env.NODE_ENV !== 'production' ? <NodesDebugger /> : null}
      </main>
    </SidebarProvider>
  )
}
