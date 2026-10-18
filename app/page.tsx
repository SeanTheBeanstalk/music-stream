import Link from "next/link";
import { Search } from "lucide-react";
export default function Page() {
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <p className="text-xs tracking-[0.25em] text-muted-foreground uppercase">
        Made for listening
      </p>
      <h1 className="font-heading text-4xl font-semibold tracking-tight sm:text-6xl">
        Find a track.
        <br />
        Make it your moment.
      </h1>
      <p className="max-w-lg text-muted-foreground">
        Search YouTube, listen to your selection, and line up what comes next.
        Your music stays with you as you explore.
      </p>
      <Link
        href="/search"
        className="inline-flex items-center gap-3 bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground hover:opacity-80 focus-visible:outline-2"
      >
        <Search aria-hidden="true" className="size-4" />
        Find music
      </Link>
    </div>
  );
}
