import { LucideIcon } from "lucide-react";
import { Card } from "./card";
import { TrendingUp, TrendingDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCountUp } from "@/hooks/useCountUp";
import { useInView } from "@/hooks/useInView";

interface StatCardProps {
  title: string;
  value: string | number;
  change?: string;
  trend?: "up" | "down";
  icon?: LucideIcon;
  animated?: boolean;
  className?: string;
}

export const StatCard = ({
  title,
  value,
  change,
  trend = "up",
  icon: Icon,
  animated = true,
  className,
}: StatCardProps) => {
  const { ref, isInView } = useInView({ threshold: 0.3 });
  
  const numericValue = typeof value === "string" ? parseInt(value.replace(/\D/g, "")) : value;
  const animatedValue = useCountUp(numericValue, 2000, 0);
  
  const displayValue = animated && isInView && typeof value === "number" 
    ? animatedValue.toLocaleString()
    : value;

  return (
    <Card
      ref={ref}
      className={cn(
        "p-6 hover-lift hover-glow transition-all duration-300 border-border/50",
        isInView && "animate-fade-in-up",
        className
      )}
    >
      <div className="flex items-start justify-between">
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground font-medium">
            {title}
          </p>
          <p className="text-3xl font-bold">{displayValue}</p>
          {change && (
            <p className={cn(
              "text-sm flex items-center gap-1",
              trend === "up" ? "text-success" : "text-warning"
            )}>
              {trend === "up" ? (
                <TrendingUp className="h-4 w-4" />
              ) : (
                <TrendingDown className="h-4 w-4" />
              )}
              {change}
            </p>
          )}
        </div>
        {Icon && (
          <div className="p-3 bg-gradient-primary rounded-lg">
            <Icon className="h-6 w-6 text-white" />
          </div>
        )}
      </div>
    </Card>
  );
};
