import { AppSidebar } from '@/components/app-sidebar'
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
      </main>
    </SidebarProvider>
  )
}
