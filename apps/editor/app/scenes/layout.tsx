export default function ScenesLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return <div className="dark min-h-screen bg-background">{children}</div>
}
