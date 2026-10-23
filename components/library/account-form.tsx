"use client";
import { toast } from "sonner";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useLibrary } from "./library-provider";

export function AccountForm() {
  const { account, busy } = useLibrary();
  const [register, setRegister] = useState(false);
  return (
    <section
      className="max-w-md space-y-5 border bg-card p-6"
      aria-labelledby="account-title"
    >
      <h2 id="account-title" className="text-xl font-semibold">
        {register ? "Create your account" : "Sign in to your library"}
      </h2>
      <p className="text-sm text-muted-foreground">
        Save liked songs and playlists, then sign in on any device to find them
        again.
      </p>
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          const form = e.currentTarget;
          const data = new FormData(form);

          try {
            await account(
              register ? "register" : "login",
              String(data.get("username")),
              String(data.get("password"))
            );
            toast.success(register ? "Account created." : "Signed in.");
            form.reset();
          } catch (error) {
            toast.error(
              error instanceof Error
                ? error.message
                : "Sign-in failed. Please retry."
            );
          }
        }}
      >
        <label className="block space-y-2 text-sm">
          Username
          <Input
            name="username"
            required
            minLength={3}
            maxLength={32}
            pattern="[a-zA-Z0-9_]+"
            autoComplete="username"
          />
        </label>
        <label className="block space-y-2 text-sm">
          Password
          <Input
            name="password"
            type="password"
            required
            minLength={12}
            maxLength={128}
            autoComplete={register ? "new-password" : "current-password"}
          />
        </label>
        <p className="text-xs text-muted-foreground">
          Use 3–32 letters, numbers, or underscores for your username and at
          least 12 characters for your password.
        </p>
        <Button type="submit" disabled={busy}>
          {register ? "Create account" : "Sign in"}
        </Button>
      </form>
      <Button
        variant="link"
        disabled={busy}
        onClick={() => {
          setRegister(!register);
        }}
      >
        {register ? "Already have an account? Sign in" : "Create an account"}
      </Button>
    </section>
  );
}
