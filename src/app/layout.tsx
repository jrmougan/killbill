import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { cn } from "@/lib/utils";
import { ThemeProvider } from "@/components/theme-provider";

const inter = Inter({ subsets: ["latin"] });

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
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
    <html lang="es">
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('theme');if(t==='light'){document.documentElement.classList.add('light');}}catch(e){}})();`,
          }}
        />
      </head>
      <body className={cn(inter.className, "antialiased min-h-screen")}>
        <ThemeProvider>
          <main className="relative flex flex-col min-h-screen overflow-hidden sm:max-w-md sm:mx-auto sm:border-x sm:border-white/10 bg-background">
            {/* Flat minimalist background (EQUIL - Flujo de Gastos redesign): no decorative glows */}
            {children}
          </main>
        </ThemeProvider>
      </body>
    </html>
  );
}
