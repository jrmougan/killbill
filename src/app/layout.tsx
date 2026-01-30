import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { cn } from "@/lib/utils";

const inter = Inter({ subsets: ["latin"] });

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#000000",
}

export const metadata: Metadata = {
  title: "EQUIL - Finanzas en Pareja",
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
    <html lang="es" className="dark">
      <body className={cn(inter.className, "antialiased min-h-screen")}>
        <main className="relative flex flex-col min-h-screen overflow-hidden sm:max-w-md sm:mx-auto sm:border-x sm:border-white/10 bg-background">
          {/* Decorative background gradients - optimized for performance */}
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,_var(--color-primary)_0%,_transparent_40%)] opacity-20 pointer-events-none" />
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_bottom_right,_#2563eb_0%,_transparent_40%)] opacity-10 pointer-events-none" />

          {children}
        </main>
      </body>
    </html>
  );
}
