import * as React from "react";
import { type LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface StatCardProps {
  label: string;
  value: string | number;
  icon?: LucideIcon;
  delta?: number | null;
  deltaLabel?: string;
  className?: string;
}

export function StatCard({ label, value, icon: Icon, delta, deltaLabel, className }: StatCardProps) {
  return (
    <Card className={cn("", className)}>
      <CardContent className="pt-6">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground uppercase tracking-wider">{label}</p>
            <p className="text-2xl font-bold font-mono">{value}</p>
          </div>
          {Icon && (
            <div className="rounded-md bg-muted p-2">
              <Icon className="h-4 w-4 text-primary" />
            </div>
          )}
        </div>
        {delta != null && (
          <div className="mt-3">
            <Badge variant={delta >= 0 ? "success" : "destructive"} className="text-xs">
              {delta >= 0 ? "+" : ""}
              {deltaLabel ?? delta.toLocaleString()}
            </Badge>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
