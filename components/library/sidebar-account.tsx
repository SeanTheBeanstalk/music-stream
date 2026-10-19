"use client";

import { useState } from "react";
import { LogOut, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLibrary } from "./library-provider";

export function SidebarAccount() {
  const { library, account, busy } = useLibrary();
  const [error, setError] = useState("");

  if (!library.user) return null;

  return (
    <div className="mt-auto shrink-0 space-y-1 border-t px-4 py-3 text-sm">
      <div className="flex min-w-0 items-center gap-3 px-3 py-1">
        <UserRound
          aria-hidden="true"
          className="size-4 shrink-0 text-muted-foreground"
        />
        <span className="min-w-0 wrap-anywhere">{library.user.name}</span>
      </div>
      <Button
        variant="ghost"
        disabled={busy}
        className="w-full justify-start gap-3 px-3 text-muted-foreground"
        onClick={async () => {
          setError("");
          try {
            await account("logout");
          } catch (e) {
            setError(e instanceof Error ? e.message : "Unable to sign out.");
          }
        }}
      >
        <LogOut aria-hidden="true" className="size-4" />
        Sign out
      </Button>
      {error && (
        <p role="alert" className="px-3 text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
