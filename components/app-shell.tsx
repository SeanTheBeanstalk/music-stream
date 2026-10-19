"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Library, Music2, Search } from "lucide-react";
import { cn } from "@/lib/utils";
export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <div className="min-h-svh pb-64 sm:pb-56">
      <a
        href="#main"
        className="sr-only z-50 bg-background p-4 focus:not-sr-only focus:fixed"
      >
        Skip to content
      </a>
      <aside className="border-b bg-sidebar md:fixed md:inset-y-0 md:left-0 md:w-56 md:border-r md:pb-56">
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
                "flex items-center gap-2 px-3 py-3 text-sm transition-colors hover:bg-muted focus-visible:outline-2 sm:gap-3 sm:px-4",
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
      </aside>
      <main
        id="main"
        tabIndex={-1}
        className="px-5 py-10 outline-none sm:px-10 sm:py-16 md:ml-56"
      >
        {children}
      </main>
    </div>
  );
}
