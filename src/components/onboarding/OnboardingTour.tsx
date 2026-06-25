import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { X, ArrowLeft, ArrowRight, Sparkles } from "lucide-react";
import { OnboardingSpotlight } from "./OnboardingSpotlight";
import { OnboardingStep } from "@/hooks/useOnboarding";
import { cn } from "@/lib/utils";

interface OnboardingTourProps {
  isActive: boolean;
  currentStep: number;
  totalSteps: number;
  step: OnboardingStep;
  targetElement: HTMLElement | null;
  onNext: () => void;
  onPrevious: () => void;
  onSkip: () => void;
}

export const OnboardingTour = ({
  isActive,
  currentStep,
  totalSteps,
  step,
  targetElement,
  onNext,
  onPrevious,
  onSkip,
}: OnboardingTourProps) => {
  const [tooltipPosition, setTooltipPosition] = useState({ top: 0, left: 0 });
  const [tooltipAlignment, setTooltipAlignment] = useState<"top" | "bottom" | "left" | "right">("bottom");

  useEffect(() => {
    if (!targetElement || !isActive) return;

    const calculatePosition = () => {
      const rect = targetElement.getBoundingClientRect();
      const tooltipWidth = 400;
      const tooltipHeight = 250;
      const spacing = 20;

      let top = 0;
      let left = 0;
      let alignment = step.position || "bottom";

      // Calculate position based on preferred alignment
      switch (alignment) {
        case "top":
          top = rect.top - tooltipHeight - spacing;
          left = rect.left + rect.width / 2 - tooltipWidth / 2;
          // If not enough space on top, try bottom
          if (top < 0) {
            alignment = "bottom";
            top = rect.bottom + spacing;
          }
          break;
        case "bottom":
          top = rect.bottom + spacing;
          left = rect.left + rect.width / 2 - tooltipWidth / 2;
          // If not enough space on bottom, try top
          if (top + tooltipHeight > window.innerHeight) {
            alignment = "top";
            top = rect.top - tooltipHeight - spacing;
          }
          break;
        case "left":
          top = rect.top + rect.height / 2 - tooltipHeight / 2;
          left = rect.left - tooltipWidth - spacing;
          // If not enough space on left, try right
          if (left < 0) {
            alignment = "right";
            left = rect.right + spacing;
          }
          break;
        case "right":
          top = rect.top + rect.height / 2 - tooltipHeight / 2;
          left = rect.right + spacing;
          // If not enough space on right, try left
          if (left + tooltipWidth > window.innerWidth) {
            alignment = "left";
            left = rect.left - tooltipWidth - spacing;
          }
          break;
      }

      // Ensure tooltip stays within viewport
      left = Math.max(20, Math.min(left, window.innerWidth - tooltipWidth - 20));
      top = Math.max(20, Math.min(top, window.innerHeight - tooltipHeight - 20));

      setTooltipPosition({ top, left });
      setTooltipAlignment(alignment);
    };

    calculatePosition();

    window.addEventListener("scroll", calculatePosition, true);
    window.addEventListener("resize", calculatePosition);

    return () => {
      window.removeEventListener("scroll", calculatePosition, true);
      window.removeEventListener("resize", calculatePosition);
    };
  }, [targetElement, isActive, step.position]);

  if (!isActive) return null;

  // Sem target → renderiza centralizado com overlay escurecido (não pula o passo).
  const centered = !targetElement;

  const progress = ((currentStep + 1) / totalSteps) * 100;
  const isFirstStep = currentStep === 0;
  const isLastStep = currentStep === totalSteps - 1;

  return (
    <>
      <OnboardingSpotlight targetElement={targetElement} />

      {/* Tooltip Card */}
      <Card
        className={cn(
          "fixed z-[10000] w-[400px] shadow-2xl border-2 border-primary/20 animate-scale-in",
          "bg-background/95 backdrop-blur-sm"
        )}
        style={{
          top: `${tooltipPosition.top}px`,
          left: `${tooltipPosition.left}px`,
          transition: "all 0.3s ease-out",
        }}
      >
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              <CardTitle className="text-lg">{step.title}</CardTitle>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 -mt-1 -mr-1"
              onClick={onSkip}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
          <CardDescription className="text-sm mt-2">
            {step.description}
          </CardDescription>
        </CardHeader>

        <CardContent className="pb-3">
          <div className="space-y-2">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Progresso</span>
              <span>{currentStep + 1} de {totalSteps}</span>
            </div>
            <Progress value={progress} className="h-2" />
          </div>
        </CardContent>

        <CardFooter className="flex justify-between pt-3">
          <Button
            variant="outline"
            size="sm"
            onClick={onPrevious}
            disabled={isFirstStep}
          >
            <ArrowLeft className="h-4 w-4 mr-1" />
            Anterior
          </Button>

          <div className="flex gap-2">
            {!isLastStep && (
              <Button variant="ghost" size="sm" onClick={onSkip}>
                Pular
              </Button>
            )}
            <Button size="sm" onClick={onNext} className="hover-lift">
              {isLastStep ? "Concluir" : "Próximo"}
              {!isLastStep && <ArrowRight className="h-4 w-4 ml-1" />}
            </Button>
          </div>
        </CardFooter>
      </Card>
    </>
  );
};
