import type { Metadata, Viewport } from "next";
import { Schibsted_Grotesk, DM_Mono } from "next/font/google";
import "./globals.css";
import { cn } from "@/lib/utils";
import { ThemeProvider } from "@/components/theme-provider";
import { Suspense } from "react";
import { ScopeMemory } from "@/components/nav/bottom-nav";

// EQUIL design fonts.
const schibstedGrotesk = Schibsted_Grotesk({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-schibsted",
});
const dmMono = DM_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-dm-mono",
});

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#F6F6F3",
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

// The bottom nav is rendered by the tab segments' layouts (dashboard,
// expenses/list, month, lists) through SessionBottomNav: reading the session
// here would make every route — login, register, setup… — dynamic.
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" className={cn(schibstedGrotesk.variable, dmMono.variable)}>
      <body className="font-sans antialiased min-h-screen">
        <ThemeProvider>
          <main className="relative flex flex-col min-h-screen overflow-hidden sm:max-w-md sm:mx-auto sm:border-x sm:border-[color:var(--line)] bg-background">
            {children}
          </main>
          {/* Remembers Común/Personal on every scoped route (no session needed). */}
          <Suspense fallback={null}>
            <ScopeMemory />
          </Suspense>
        </ThemeProvider>
      </body>
    </html>
  );
}
