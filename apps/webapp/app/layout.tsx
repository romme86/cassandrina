import type { Metadata } from "next";
import { Space_Grotesk } from "next/font/google";
import "./globals.css";
import { Sidebar } from "@/components/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { query } from "@/lib/db";

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-space-grotesk",
});

export const metadata: Metadata = {
  title: "Cassandrina — Bitcoin Trading Bot",
  description: "Gamified Bitcoin trading bot dashboard",
};

async function getTradingEnabled(): Promise<boolean> {
  try {
    const rows = await query<{ value: string }>(
      "SELECT value FROM bot_config WHERE key = 'trading_enabled'"
    );
    return rows[0]?.value === "true";
  } catch {
    return false;
  }
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const tradingEnabled = await getTradingEnabled();

  return (
    <html lang="en" className={`dark ${spaceGrotesk.variable}`}>
      <body className="min-h-screen bg-background text-foreground font-[family-name:var(--font-space-grotesk)]">
        <TooltipProvider>
          <Sidebar tradingEnabled={tradingEnabled} />
          <main className="ml-60 min-h-screen p-6">{children}</main>
        </TooltipProvider>
      </body>
    </html>
  );
}
