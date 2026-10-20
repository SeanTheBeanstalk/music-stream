import { Geist_Mono, Inter, Instrument_Sans } from "next/font/google";
import { PlaybackProvider } from "@/components/playback/playback-provider";
import { AppShell } from "@/components/app-shell";
import { LibraryProvider } from "@/components/library/library-provider";

import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { cn } from "@/lib/utils";
import { Toaster } from "@/components/ui/sonner";

const instrumentSansHeading = Instrument_Sans({
  subsets: ["latin"],
  variable: "--font-heading",
});

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });

const fontMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
});

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={cn(
        "antialiased",
        fontMono.variable,
        "font-sans",
        inter.variable,
        instrumentSansHeading.variable
      )}
    >
      <body>
        <ThemeProvider>
          <PlaybackProvider>
            <LibraryProvider>
              <AppShell>{children}</AppShell>
            </LibraryProvider>
          </PlaybackProvider>
          <Toaster position="top-center" />
        </ThemeProvider>
      </body>
    </html>
  );
}
