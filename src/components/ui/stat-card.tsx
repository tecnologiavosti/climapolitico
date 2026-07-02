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
        <div
          className="absolute flex items-center justify-center rounded-full shrink-0"
          style={{
            top: 14,
            right: 14,
            width: 44,
            height: 44,
            minWidth: 44,
            minHeight: 44,
            maxWidth: 44,
            maxHeight: 44,
            aspectRatio: "1 / 1",
            flexShrink: 0,
            background: "linear-gradient(135deg, #0ea5e9, #2563eb)",
            boxShadow: "0 10px 30px rgba(37,99,235,0.25)",
          }}
        >
          <Icon className="text-white" style={{ width: 20, height: 20, flexShrink: 0 }} />
        </div>
      )}
      <div className="pr-16 space-y-2">
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
