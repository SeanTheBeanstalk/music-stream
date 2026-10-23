"use client";
import { toast } from "sonner";

import { LogOut, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLibrary } from "./library-provider";

export function SidebarAccount() {
  const { library, account, busy } = useLibrary();

  if (!library.user) return null;

  return (
    <div className="mt-auto shrink-0 space-y-1 border-t px-4 py-3 text-sm group-data-[collapsible=icon]:px-2">
      <div className="flex min-w-0 items-center gap-3 px-3 py-1 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
        <UserRound
          aria-hidden="true"
          className="size-4 shrink-0 text-muted-foreground"
        />
        <span className="min-w-0 wrap-anywhere group-data-[collapsible=icon]:hidden">
          {library.user.name}
        </span>
      </div>
      <Button
        variant="ghost"
        disabled={busy}
        aria-label="Sign out"
        title="Sign out"
        className="w-full justify-start gap-3 px-3 text-muted-foreground group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0"
        onClick={async () => {
          try {
            await account("logout");
            toast.success("Signed out.");
          } catch (e) {
            toast.error(e instanceof Error ? e.message : "Unable to sign out.");
          }
        }}
      >
        <LogOut aria-hidden="true" className="size-4" />
        <span className="group-data-[collapsible=icon]:hidden">Sign out</span>
      </Button>
    </div>
  );
}
