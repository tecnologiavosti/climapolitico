import { useState, useEffect, useCallback, useRef } from "react";
import { useLocation } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export interface OnboardingStep {
  target: string;
  title: string;
  description: string;
  position?: "top" | "bottom" | "left" | "right";
  action?: () => void;
}

const LEGACY_KEY = "onboarding_completed";
const FIND_TIMEOUT_MS = 1500;
const FIND_INTERVAL_MS = 100;

/**
 * Tour interativo. Persiste conclusão em `profiles.onboarding_completed_at` (sincroniza
 * entre dispositivos). Só ativa na rota raiz `/dashboard` para não bloquear telas internas.
 * Pula passos cujo target não aparece no DOM em até 1.5s (evita travar em layouts variantes).
 */
export const useOnboarding = (steps: OnboardingStep[], enabled: boolean = true) => {
  const { user } = useAuth();
  const location = useLocation();
  const [isActive, setIsActive] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [targetElement, setTargetElement] = useState<HTMLElement | null>(null);
  const skippedRef = useRef(false);

  // Bootstrap: só ativa em /dashboard exato e só se profile.onboarding_completed_at IS NULL
  useEffect(() => {
    if (!enabled || !user) return;
    if (location.pathname !== "/dashboard") return;

    let cancelled = false;
    (async () => {
      try {
        const { data } = await supabase
          .from("profiles")
          .select("onboarding_completed_at")
          .eq("id", user.id)
          .maybeSingle();
        if (cancelled) return;
        const completed = data?.onboarding_completed_at || localStorage.getItem(LEGACY_KEY);
        if (!completed) {
          setTimeout(() => !cancelled && setIsActive(true), 600);
        }
      } catch {
        // fail-open: não atrapalha o uso se DB indisponível
      }
    })();
    return () => { cancelled = true; };
  }, [enabled, user, location.pathname]);

  const complete = useCallback(async () => {
    setIsActive(false);
    localStorage.setItem(LEGACY_KEY, "true");
    if (user) {
      try {
        await supabase
          .from("profiles")
          .update({ onboarding_completed_at: new Date().toISOString() })
          .eq("id", user.id);
      } catch {/* noop */}
    }
  }, [user]);

  // Resolve target com timeout — evita loop infinito quando seletor não existe
  useEffect(() => {
    if (!isActive || !steps[currentStep]) return;

    let elapsed = 0;
    let timer: number | undefined;

    const tick = () => {
      const el = document.querySelector(steps[currentStep].target) as HTMLElement | null;
      if (el) {
        setTargetElement(el);
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        return;
      }
      elapsed += FIND_INTERVAL_MS;
      if (elapsed >= FIND_TIMEOUT_MS) {
        // Pula automaticamente este passo
        if (currentStep < steps.length - 1) {
          setCurrentStep((s) => s + 1);
        } else if (!skippedRef.current) {
          skippedRef.current = true;
          complete();
        }
        return;
      }
      timer = window.setTimeout(tick, FIND_INTERVAL_MS);
    };
    tick();
    return () => { if (timer) clearTimeout(timer); };
  }, [isActive, currentStep, steps, complete]);

  const next = useCallback(() => {
    if (currentStep < steps.length - 1) {
      const step = steps[currentStep];
      step.action?.();
      setCurrentStep((p) => p + 1);
    } else {
      complete();
    }
  }, [currentStep, steps, complete]);

  const previous = useCallback(() => {
    if (currentStep > 0) setCurrentStep((p) => p - 1);
  }, [currentStep]);

  const skip = useCallback(() => { complete(); }, [complete]);

  const reset = useCallback(async () => {
    localStorage.removeItem(LEGACY_KEY);
    setCurrentStep(0);
    setIsActive(true);
    if (user) {
      try {
        await supabase.from("profiles").update({ onboarding_completed_at: null }).eq("id", user.id);
      } catch {/* noop */}
    }
  }, [user]);

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
