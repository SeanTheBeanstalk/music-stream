"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Library, Music2, Search } from "lucide-react";
import { SidebarAccount } from "@/components/library/sidebar-account";
import { Sidebar, SidebarContent, useSidebar } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";

function SidebarNavigation() {
  const pathname = usePathname();

  return (
    <>
      <div className="flex items-center gap-3 p-6 text-lg font-semibold">
        <Music2 aria-hidden="true" />
        Streamify
      </div>
      <nav
        aria-label="Main navigation"
        className="flex gap-2 px-4 pb-4 md:flex-col"
      >
        {[
          { href: "/", label: "Home", icon: Home },
          { href: "/search", label: "Search", icon: Search },
          { href: "/library", label: "Library", icon: Library },
        ].map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            aria-current={pathname === href ? "page" : undefined}
            className={cn(
              "flex items-center gap-2 px-2 py-3 text-sm transition-colors hover:bg-muted focus-visible:outline-2 sm:gap-3 sm:px-4",
              pathname === href
                ? "bg-muted font-semibold"
                : "text-muted-foreground"
            )}
          >
            <Icon aria-hidden="true" className="size-4" />
            {label}
          </Link>
        ))}
      </nav>
      <SidebarAccount />
    </>
  );
}

export function AppSidebar() {
  const { open } = useSidebar();

  return (
    <>
      <aside className="flex flex-col border-b bg-sidebar md:hidden">
        <SidebarNavigation />
      </aside>
      <Sidebar
        id="desktop-sidebar"
        role="complementary"
        aria-label="Sidebar"
        collapsible="offcanvas"
        inert={!open}
      >
        <SidebarContent className="gap-0">
          <SidebarNavigation />
        </SidebarContent>
      </Sidebar>
    </>
  );
}
