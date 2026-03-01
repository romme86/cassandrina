import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const STRATEGY_COLORS: Record<string, string> = {
  A: "bg-red-700 text-red-100 border-transparent",
  B: "bg-orange-700 text-orange-100 border-transparent",
  C: "bg-yellow-700 text-yellow-100 border-transparent",
  D: "bg-blue-700 text-blue-100 border-transparent",
  E: "bg-green-800 text-green-100 border-transparent",
};

interface StrategyBadgeProps {
  strategy: string | null | undefined;
  className?: string;
}

export function StrategyBadge({ strategy, className }: StrategyBadgeProps) {
  if (!strategy) return null;
  return (
    <Badge
      className={cn(STRATEGY_COLORS[strategy] ?? "bg-muted border-transparent", "font-bold", className)}
    >
      Strategy {strategy}
    </Badge>
  );
}
