import { useState, useEffect, useCallback } from "react";

export interface OnboardingStep {
  target: string; // CSS selector
  title: string;
  description: string;
  position?: "top" | "bottom" | "left" | "right";
  action?: () => void;
}

const ONBOARDING_KEY = "onboarding_completed";

export const useOnboarding = (steps: OnboardingStep[], enabled: boolean = true) => {
  const [isActive, setIsActive] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [targetElement, setTargetElement] = useState<HTMLElement | null>(null);

  useEffect(() => {
    if (!enabled) return;
    
    const hasCompleted = localStorage.getItem(ONBOARDING_KEY);
    if (!hasCompleted) {
      // Small delay to ensure DOM is ready
      setTimeout(() => setIsActive(true), 500);
    }
  }, [enabled]);

  useEffect(() => {
    if (!isActive || !steps[currentStep]) return;

    const findTarget = () => {
      const element = document.querySelector(steps[currentStep].target) as HTMLElement;
      if (element) {
        setTargetElement(element);
        // Scroll into view smoothly
        element.scrollIntoView({ behavior: "smooth", block: "center" });
      } else {
        // Retry after a short delay if element not found
        setTimeout(findTarget, 100);
      }
    };

    findTarget();
  }, [isActive, currentStep, steps]);

  const next = useCallback(() => {
    if (currentStep < steps.length - 1) {
      const step = steps[currentStep];
      if (step.action) step.action();
      setCurrentStep((prev) => prev + 1);
    } else {
      complete();
    }
  }, [currentStep, steps]);

  const previous = useCallback(() => {
    if (currentStep > 0) {
      setCurrentStep((prev) => prev - 1);
    }
  }, [currentStep]);

  const skip = useCallback(() => {
    complete();
  }, []);

  const complete = useCallback(() => {
    setIsActive(false);
    localStorage.setItem(ONBOARDING_KEY, "true");
  }, []);

  const reset = useCallback(() => {
    localStorage.removeItem(ONBOARDING_KEY);
    setCurrentStep(0);
    setIsActive(true);
  }, []);

  return {
    isActive,
    currentStep,
    totalSteps: steps.length,
    targetElement,
    step: steps[currentStep],
    next,
    previous,
    skip,
    complete,
    reset,
  };
};
