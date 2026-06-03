import { ReactNode, useLayoutEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

interface ChartDebugFrameProps {
  label: string;
  className?: string;
  children: ReactNode;
}

export function ChartDebugFrame({ label, className, children }: ChartDebugFrameProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;

    const report = () => {
      const rect = node.getBoundingClientRect();
      const styles = window.getComputedStyle(node);
      const next = { width: Math.round(rect.width), height: Math.round(rect.height) };
      setSize(next);
      console.info(`[ChartDebug] ${label}`, {
        width: next.width,
        height: next.height,
        display: styles.display,
        maxWidth: styles.maxWidth,
        justifyContent: styles.justifyContent,
        alignItems: styles.alignItems,
        transform: styles.transform,
        zoom: (styles as CSSStyleDeclaration & { zoom?: string }).zoom || "normal",
      });
    };

    report();
    const observer = new ResizeObserver(report);
    observer.observe(node);
    return () => observer.disconnect();
  }, [label]);

  return (
    <div
      ref={ref}
      data-chart-debug={label}
      className={cn(
        "relative w-full min-w-0 overflow-hidden border border-destructive min-h-[250px] h-[300px] md:h-[400px] lg:h-[400px]",
        className,
      )}
    >
      <div className="absolute right-2 top-2 z-10 rounded bg-destructive px-2 py-0.5 text-[10px] font-medium text-destructive-foreground shadow-sm">
        {size.width}×{size.height}px
      </div>
      {children}
    </div>
  );
}
