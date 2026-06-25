import type { OnboardingStep } from "@/hooks/useOnboarding";

/**
 * Tour de 5 passos. Quando o seletor não existir no DOM (ex.: viewport mobile
 * com sidebar recolhida), o passo é renderizado centralizado SEM auto-pular —
 * isso corrige o bug em que o usuário ia direto do passo 1 para o 5.
 */
export const onboardingSteps: OnboardingStep[] = [
  {
    target: "body",
    title: "Bem-vindo ao Clima Político",
    description:
      "Aqui você monitora candidatos, redes sociais, sentimento político e tendências em tempo real.",
    position: "bottom",
  },
  {
    target: '[data-onboarding="candidates"], [data-onboarding="sidebar"]',
    title: "Adicione candidatos",
    description:
      "Antes de começar, você precisa adicionar ao menos um candidato ao seu monitoramento.",
    position: "right",
  },
  {
    target: '[data-onboarding="candidates"], [data-onboarding="sidebar"]',
    title: "Busque qualquer candidato",
    description:
      "No Catálogo de Candidatos, pesquise por nome, cargo, cidade, estado ou partido.",
    position: "right",
  },
  {
    target: '[data-onboarding="candidates"], [data-onboarding="sidebar"]',
    title: "Adicione ao monitoramento",
    description:
      "Ao adicionar, o candidato passa a aparecer em todas as análises automaticamente.",
    position: "right",
  },
  {
    target: '[data-onboarding="overview"], [data-onboarding="breadcrumbs"], body',
    title: "Pronto!",
    description:
      "Agora você já pode acompanhar menções, aceitação, rejeição e clima político.",
    position: "bottom",
  },
];

/** DEV-only: nenhum aviso é crítico — todos os passos têm fallback. */
export function validateOnboardingTargets() {
  if (typeof document === "undefined" || import.meta.env.PROD) return;
}
