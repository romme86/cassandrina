"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Zap,
  LayoutDashboard,
  Trophy,
  LineChart,
  History,
  Settings,
  Wallet,
} from "lucide-react";
import { cn } from "@/lib/utils";

const NAV_LINKS = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard, exact: true },
  { href: "/users", label: "Leaderboard", icon: Trophy, exact: false },
  { href: "/predictions", label: "Predictions", icon: LineChart, exact: false },
  { href: "/history", label: "History", icon: History, exact: false },
  { href: "/config", label: "Settings", icon: Settings, exact: false },
  { href: "/wallet", label: "Wallet", icon: Wallet, exact: false },
];

interface SidebarProps {
  tradingEnabled?: boolean;
}

export function Sidebar({ tradingEnabled = false }: SidebarProps) {
  const pathname = usePathname();

  return (
    <aside className="fixed left-0 top-0 h-screen w-60 flex flex-col border-r border-primary/10 bg-card z-40" style={{ boxShadow: "2px 0 20px rgba(0,0,0,0.4)" }}>
      <div className="flex flex-col h-full justify-between p-4">
        <div className="flex flex-col gap-6">
          {/* Brand */}
          <div className="flex items-center gap-3 px-2 pt-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary ring-1 ring-primary/20 shrink-0">
              <Zap className="h-5 w-5" />
            </div>
            <div className="flex flex-col">
              <h1 className="font-bold text-base text-white tracking-tight leading-tight">
                Cassandrina
              </h1>
              <p className="text-xs text-muted-foreground">BTC Trading Bot</p>
            </div>
          </div>

          {/* Navigation */}
          <nav className="flex flex-col gap-1">
            {NAV_LINKS.map(({ href, label, icon: Icon, exact }) => {
              const isActive = exact
                ? pathname === href
                : pathname === href || pathname.startsWith(href + "/");
              return (
                <Link
                  key={href}
                  href={href}
                  className={cn(
                    "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-all",
                    isActive
                      ? "bg-primary/10 text-primary ring-1 ring-primary/20"
                      : "text-muted-foreground hover:bg-secondary hover:text-white"
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="font-medium">{label}</span>
                </Link>
              );
            })}
          </nav>
        </div>

        {/* Trading status */}
        <div className="px-2 pb-2">
          <div
            className={cn(
              "flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium border",
              tradingEnabled
                ? "bg-primary/10 text-primary border-primary/20"
                : "bg-red-950/40 text-red-400 border-red-800/30"
            )}
          >
            <span
              className={cn(
                "h-2 w-2 rounded-full shrink-0",
                tradingEnabled ? "bg-primary animate-pulse" : "bg-red-400"
              )}
            />
            <span>{tradingEnabled ? "Live" : "Paused"}</span>
          </div>
        </div>
      </div>
    </aside>
  );
}
