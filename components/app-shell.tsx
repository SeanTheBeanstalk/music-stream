"use client";
import { useState, type CSSProperties } from "react";
import { AppSidebar } from "@/components/app-sidebar";
import { MusicPlayer } from "@/components/ui/music-player";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
export function AppShell({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  return (
    <SidebarProvider
      open={sidebarOpen}
      onOpenChange={setSidebarOpen}
      className="flex-col md:flex-row"
      style={
        {
          "--sidebar-width": "14rem",
          "--app-sidebar-width": sidebarOpen ? "14rem" : "3rem",
        } as CSSProperties
      }
    >
      <a
        href="#main"
        className="sr-only z-50 bg-background p-4 focus:not-sr-only focus:fixed"
      >
        Skip to content
      </a>
      <AppSidebar />
      <div className="min-w-0 flex-1 pb-[var(--music-player-height,16rem)]">
        <header className="hidden items-center border-b px-5 py-3 md:flex">
          <SidebarTrigger
            aria-label={sidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
            aria-expanded={sidebarOpen}
            aria-controls="desktop-sidebar"
          />
        </header>
        <main
          id="main"
          tabIndex={-1}
          className="px-5 py-10 outline-none sm:px-10 sm:py-16"
        >
          {children}
        </main>
        <MusicPlayer />
      </div>
    </SidebarProvider>
  );
}
