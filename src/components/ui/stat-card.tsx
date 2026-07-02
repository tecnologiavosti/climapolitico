import { LucideIcon } from "lucide-react";
import { Card } from "./card";
import { TrendingUp, TrendingDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { useEffect, useState, useRef } from "react";

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
  const [hasAnimated, setHasAnimated] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Run animation only once when first visible
  useEffect(() => {
    if (hasAnimated) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setHasAnimated(true);
          observer.disconnect();
        }
      },
      { threshold: 0.3 }
    );

    if (ref.current) {
      observer.observe(ref.current);
    }

    return () => observer.disconnect();
  }, [hasAnimated]);

  return (
    <Card
      ref={ref}
      className={cn(
        "relative overflow-visible p-6 hover-lift hover-glow transition-all duration-300 border-border/50",
        hasAnimated ? "opacity-100" : "opacity-0",
        className
      )}
    >
      {Icon && (
        <div className="metric-icon-wrapper absolute top-3 right-3">
          <Icon />
        </div>
      )}
      <div className="pr-12 space-y-2">
        <p className="text-sm text-muted-foreground font-medium">{title}</p>
        <p className="text-3xl font-bold">{value}</p>
        {change && (
          <p
            className={cn(
              "text-sm flex items-center gap-1",
              trend === "up" ? "text-success" : "text-warning"
            )}
          >
            {trend === "up" ? (
              <TrendingUp className="h-4 w-4" />
            ) : (
              <TrendingDown className="h-4 w-4" />
            )}
            {change}
          </p>
        )}
      </div>
    </Card>
  );
};
