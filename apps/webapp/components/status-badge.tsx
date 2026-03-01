import { Badge, type BadgeProps } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const STATUS_VARIANTS: Record<string, BadgeProps["variant"]> = {
  open: "success",
  closed: "secondary",
  settled: "outline",
  liquidated: "destructive",
};

interface StatusBadgeProps {
  status: string;
  className?: string;
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  return (
    <Badge variant={STATUS_VARIANTS[status] ?? "secondary"} className={cn(className)}>
      {status}
    </Badge>
  );
}
