"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Library, Music2, Search } from "lucide-react";
import { SidebarAccount } from "@/components/library/sidebar-account";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";

function SidebarNavigation() {
  const pathname = usePathname();

  return (
    <>
      <SidebarHeader className="px-4 py-5">
        <div className="flex items-center gap-3 text-base font-semibold group-data-[collapsible=icon]:justify-center">
          <Music2 aria-hidden="true" className="size-5" />
          <span className="group-data-[collapsible=icon]:hidden">Streamify</span>
        </div>
      </SidebarHeader>
      <SidebarGroup className="px-2 py-2">
        <SidebarGroupContent>
          <nav aria-label="Main navigation">
            <SidebarMenu>
              {[
                { href: "/", label: "Home", icon: Home },
                { href: "/search", label: "Search", icon: Search },
                { href: "/library", label: "Library", icon: Library },
              ].map(({ href, label, icon: Icon }) => (
                <SidebarMenuItem key={href}>
                  <SidebarMenuButton
                    render={
                      <Link
                        href={href}
                        aria-current={pathname === href ? "page" : undefined}
                      />
                    }
                    isActive={pathname === href}
                    tooltip={label}
                  >
                    <Icon aria-hidden="true" />
                    <span className="group-data-[collapsible=icon]:hidden">
                      {label}
                    </span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </nav>
        </SidebarGroupContent>
      </SidebarGroup>
      <SidebarAccount />
    </>
  );
}

export function AppSidebar() {
  return (
    <>
      <aside className="flex flex-col border-b bg-sidebar md:hidden">
        <SidebarNavigation />
      </aside>
      <Sidebar
        id="desktop-sidebar"
        role="complementary"
        aria-label="Sidebar"
        collapsible="icon"
      >
        <SidebarContent className="gap-0">
          <SidebarNavigation />
        </SidebarContent>
      </Sidebar>
    </>
  );
}
