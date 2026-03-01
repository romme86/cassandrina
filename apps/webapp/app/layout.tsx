import type { Metadata } from "next";
import "./globals.css";
import { Nav } from "@/components/nav";
import { TooltipProvider } from "@/components/ui/tooltip";
import { query } from "@/lib/db";

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
    <html lang="en" className="dark">
      <body className="min-h-screen bg-background text-foreground">
        <TooltipProvider>
          <Nav tradingEnabled={tradingEnabled} />
          <main className="p-6">{children}</main>
        </TooltipProvider>
      </body>
    </html>
  );
}
