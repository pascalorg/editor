import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { EditorProvider } from "@/hooks/use-editor-context";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Pascal Editor",
  description: "Pascal Editor",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <EditorProvider>
          <SidebarProvider>
            <main className="h-screen w-full">
              <AppSidebar />
              <SidebarTrigger className="absolute top-2 left-2 z-50 text-muted-foreground" />
              {children}
            </main>
          </SidebarProvider>
        </EditorProvider>
      </body>
    </html>
  );
}
