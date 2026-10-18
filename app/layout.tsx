import { Geist_Mono, Inter, Instrument_Sans } from "next/font/google";
import { PlaybackProvider } from "@/components/playback/playback-provider";
import { MusicPlayer } from "@/components/ui/music-player";
import { AppShell } from "@/components/app-shell";

import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { cn } from "@/lib/utils";

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
            <AppShell>{children}</AppShell>
            <MusicPlayer />
          </PlaybackProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
