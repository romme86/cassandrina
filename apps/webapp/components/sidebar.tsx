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
    <aside
      className="fixed left-0 top-0 z-40 flex h-screen w-64 flex-col border-r border-white/5 bg-card/95 backdrop-blur-sm"
      style={{ boxShadow: "6px 0 30px rgba(0,0,0,0.35)" }}
    >
      <div className="flex flex-col h-full justify-between p-4">
        <div className="flex flex-col gap-6">
          {/* Brand */}
          <div className="flex items-center gap-3 px-2 pt-2">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary ring-1 ring-primary/20">
              <Zap className="h-5 w-5" />
            </div>
            <div className="flex flex-col">
              <h1 className="font-bold text-base text-white tracking-tight leading-tight">
                Cassandrina
              </h1>
              <p className="text-xs text-muted-foreground">v2.1 Beta</p>
            </div>
          </div>

          {/* Navigation */}
          <nav className="flex flex-col gap-1.5">
            {NAV_LINKS.map(({ href, label, icon: Icon, exact }) => {
              const isActive = exact
                ? pathname === href
                : pathname === href || pathname.startsWith(href + "/");
              return (
                <Link
                  key={href}
                  href={href}
                  className={cn(
                    "group flex items-center gap-3 rounded-lg px-3 py-3 text-sm transition-all",
                    isActive
                      ? "bg-primary/10 text-primary ring-1 ring-primary/20"
                      : "text-muted-foreground hover:bg-secondary hover:text-white"
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0 transition-transform duration-200 group-hover:scale-105" />
                  <span className="font-medium">{label}</span>
                </Link>
              );
            })}
          </nav>
        </div>

        {/* Trading status */}
        <div className="rounded-xl border border-white/5 bg-secondary/30 px-2 py-2">
          <div
            className={cn(
              "flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium",
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
