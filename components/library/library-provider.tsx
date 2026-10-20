"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import type { Library, LibraryCommand } from "@/lib/music/library";

const empty: Library = { user: null, likes: [], playlists: [] };
const Context = createContext<{
  library: Library;
  loading: boolean;
  busy: boolean;
  error: string;
  refresh: () => Promise<void>;
  mutate: (command: LibraryCommand, image?: File | null) => Promise<void>;
  account: (
    action: "login" | "register" | "logout",
    username?: string,
    password?: string
  ) => Promise<void>;
} | null>(null);
async function request(url: string, options?: RequestInit) {
  const response = await fetch(url, { cache: "no-store", ...options });
  const body = await response.json();
  if (!response.ok)
    throw new Error(
      body.error ?? "Unable to update your library. Please retry."
    );
  return body;
}
export function LibraryProvider({ children }: { children: React.ReactNode }) {
  const [library, setLibrary] = useState<Library>(empty);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const lock = useRef(false);
  const sequence = useRef(0);
  const refresh = useCallback(async () => {
    const id = ++sequence.current;
    try {
      const data = await request("/api/library");
      if (id === sequence.current) {
        setLibrary(data);
        setError("");
      }
    } catch (e) {
      if (id === sequence.current)
        setError(e instanceof Error ? e.message : "Unable to load library.");
    } finally {
      if (id === sequence.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    const id = ++sequence.current;
    request("/api/library", { signal: controller.signal })
      .then((data) => {
        if (active && id === sequence.current) {
          setLibrary(data);
          setError("");
        }
      })
      .catch((e) => {
        if (active && id === sequence.current)
          setError(e instanceof Error ? e.message : "Unable to load library.");
      })
      .finally(() => {
        if (active && id === sequence.current) setLoading(false);
      });
    const focus = () => {
      if (!lock.current) void refresh();
    };
    window.addEventListener("focus", focus);
    return () => {
      active = false;
      controller.abort();
      window.removeEventListener("focus", focus);
    };
  }, [refresh]);
  async function work(action: () => Promise<void>) {
    if (lock.current)
      throw new Error("Wait for the current library change to finish.");
    lock.current = true;
    ++sequence.current;
    setBusy(true);
    try {
      await action();
      setError("");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function mutate(command: LibraryCommand, image?: File | null) {
    await work(async () => {
      try {
        const form = new FormData();
        form.set("command", JSON.stringify(command));
        if (image) form.set("image", image);
        const data = await request("/api/library", {
          method: "POST",
          headers: image ? undefined : { "Content-Type": "application/json" },
          body: image ? form : JSON.stringify(command),
        });
        setLibrary(data);
      } catch (e) {
        await refresh();
        throw e;
      }
    });
  }
  async function account(
    action: "login" | "register" | "logout",
    username?: string,
    password?: string
  ) {
    await work(async () => {
      await request("/api/account", {
        method: action === "logout" ? "DELETE" : "POST",
        headers: { "Content-Type": "application/json" },
        body:
          action === "logout"
            ? undefined
            : JSON.stringify({ action, username, password }),
      });
      if (action === "logout") setLibrary(empty);
      await refresh();
    });
  }
  return (
    <Context.Provider
      value={{ library, loading, busy, error, refresh, mutate, account }}
    >
      {children}
    </Context.Provider>
  );
}
export function useLibrary() {
  const context = useContext(Context);
  if (!context) throw new Error("LibraryProvider is missing.");
  return context;
}
