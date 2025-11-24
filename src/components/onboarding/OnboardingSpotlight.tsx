import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

interface OnboardingSpotlightProps {
  targetElement: HTMLElement | null;
  padding?: number;
}

export const OnboardingSpotlight = ({ 
  targetElement, 
  padding = 8 
}: OnboardingSpotlightProps) => {
  const [position, setPosition] = useState({ 
    top: 0, 
    left: 0, 
    width: 0, 
    height: 0 
  });

  useEffect(() => {
    if (!targetElement) return;

    const updatePosition = () => {
      const rect = targetElement.getBoundingClientRect();
      setPosition({
        top: rect.top - padding,
        left: rect.left - padding,
        width: rect.width + padding * 2,
        height: rect.height + padding * 2,
      });
    };

    updatePosition();

    // Update on scroll and resize
    window.addEventListener("scroll", updatePosition, true);
    window.addEventListener("resize", updatePosition);

    return () => {
      window.removeEventListener("scroll", updatePosition, true);
      window.removeEventListener("resize", updatePosition);
    };
  }, [targetElement, padding]);

  if (!targetElement) return null;

  return (
    <>
      {/* Overlay with cutout */}
      <div
        className="fixed inset-0 z-[9998] pointer-events-none animate-fade-in"
        style={{
          background: `radial-gradient(circle at ${position.left + position.width / 2}px ${
            position.top + position.height / 2
          }px, transparent ${Math.max(position.width, position.height) / 2 + 20}px, rgba(0, 0, 0, 0.7) ${
            Math.max(position.width, position.height) / 2 + 100
          }px)`,
        }}
      />
      
      {/* Highlighted element border */}
      <div
        className={cn(
          "fixed z-[9999] pointer-events-none rounded-lg animate-glow-pulse",
          "ring-2 ring-primary shadow-[0_0_0_9999px_rgba(0,0,0,0.5)]"
        )}
        style={{
          top: `${position.top}px`,
          left: `${position.left}px`,
          width: `${position.width}px`,
          height: `${position.height}px`,
          transition: "all 0.3s ease-out",
        }}
      />
    </>
  );
};
