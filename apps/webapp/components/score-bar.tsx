import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

interface ScoreBarProps {
  value: number;
  max?: number;
  className?: string;
  showLabel?: boolean;
}

export function ScoreBar({ value, max = 100, className, showLabel = true }: ScoreBarProps) {
  const pct = Math.min((value / max) * 100, 100);
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <Progress value={pct} className="flex-1" />
      {showLabel && (
        <span className="text-xs font-mono w-10 text-right text-muted-foreground">
          {value.toFixed(1)}%
        </span>
      )}
    </div>
  );
}
