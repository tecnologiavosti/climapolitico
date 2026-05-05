import type { OnboardingStep } from "@/hooks/useOnboarding";

export const onboardingSteps: OnboardingStep[] = [
  {
    target: '[data-onboarding="sidebar"]',
    title: "Navegação Principal",
    description: "Use este menu para navegar entre as diferentes seções da plataforma.",
    position: "right",
  },
  {
    target: '[data-onboarding="overview"]',
    title: "Visão Geral",
    description: "Resumo dos seus candidatos, análises recentes e insights principais.",
    position: "right",
  },
  {
    target: '[data-onboarding="candidates"]',
    title: "Candidatos",
    description: "Gerencie seus candidatos e acompanhe métricas de engajamento e sentimento.",
    position: "right",
  },
  {
    target: '[data-onboarding="ai-insights"]',
    title: "Insights da IA",
    description: "Recomendações inteligentes baseadas em IA para otimizar suas estratégias.",
    position: "right",
  },
  {
    target: '[data-onboarding="breadcrumbs"]',
    title: "Navegação Contextual",
    description: "Use o breadcrumb para entender onde você está e navegar rapidamente.",
    position: "bottom",
  },
  {
    target: '[data-onboarding="user-menu"]',
    title: "Menu de Usuário",
    description: "Acesse suas configurações, preferências e faça logout por aqui.",
    position: "bottom",
  },
];

/** DEV-only sanity check: warns if any onboarding selector is missing in the DOM. */
export function validateOnboardingTargets() {
  if (typeof document === "undefined" || import.meta.env.PROD) return;
  setTimeout(() => {
    onboardingSteps.forEach((s) => {
      if (!document.querySelector(s.target)) {
        console.warn(`[onboarding] selector not found in DOM: ${s.target}`);
      }
    });
  }, 2000);
}
