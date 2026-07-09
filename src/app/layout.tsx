import type { Metadata, Viewport } from "next";
import { Instrument_Sans, Spline_Sans_Mono } from "next/font/google";
import "./globals.css";
import { cn } from "@/lib/utils";
import { ThemeProvider } from "@/components/theme-provider";
import { BottomNav } from "@/components/nav/bottom-nav";

// EQUIL - Economía Familiar design fonts.
const instrumentSans = Instrument_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-instrument",
});
const splineSansMono = Spline_Sans_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-spline-mono",
});

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#F3EFE6",
}

export const metadata: Metadata = {
  title: "EQUIL - Finanzas Compartidas",
  description: "Equilibrio y justicia en vuestra economía compartida.",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "EQUIL",
  },
  formatDetection: {
    telephone: false,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" className={cn(instrumentSans.variable, splineSansMono.variable)}>
      <body className="font-sans antialiased min-h-screen">
        <ThemeProvider>
          <main className="relative flex flex-col min-h-screen overflow-hidden sm:max-w-md sm:mx-auto sm:border-x sm:border-[color:var(--line)] bg-background">
            {/* Flat warm-paper background (EQUIL - Economía Familiar): no decorative glows */}
            {children}
          </main>
          {/* Global bottom navigation — self-hides on focused/full-screen flows */}
          <BottomNav />
        </ThemeProvider>
      </body>
    </html>
  );
}
