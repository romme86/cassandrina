import type { Metadata } from "next";
import "./globals.css";
import { Sidebar } from "@/components/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { query } from "@/lib/db";

const metadataBase = process.env.WEBAPP_EXTERNAL_URL
  ? new URL(process.env.WEBAPP_EXTERNAL_URL)
  : undefined;

export const metadata: Metadata = {
  title: "Cassandrina — Bitcoin Trading Bot",
  description: "Gamified Bitcoin trading bot dashboard",
  metadataBase,
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
      <body className="min-h-screen bg-background text-foreground font-[family-name:var(--font-noto-sans)] antialiased overflow-hidden">
        <TooltipProvider>
          <Sidebar tradingEnabled={tradingEnabled} />
          <main className="lg:ml-64 h-screen overflow-y-auto p-6 pt-16 lg:pt-10 lg:p-10">
            <div className="mx-auto w-full max-w-[1320px]">{children}</div>
          </main>
        </TooltipProvider>
      </body>
    </html>
  );
}
