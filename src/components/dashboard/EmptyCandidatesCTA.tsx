import { Link } from "react-router-dom";
import { Sparkles, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * CTA chamativo exibido quando o usuário ainda não monitora nenhum candidato.
 * Destaque visual no topo da Visão Geral (especialmente útil em mobile).
 */
export const EmptyCandidatesCTA = () => (
  <div
    className="relative overflow-hidden rounded-2xl border border-white/10 p-5 sm:p-7 shadow-xl animate-fade-in"
    style={{ background: "var(--gradient-primary, linear-gradient(135deg, hsl(var(--primary)/0.95), hsl(var(--primary)/0.6)))" }}
  >
    <div className="absolute -top-10 -right-10 h-40 w-40 rounded-full bg-white/10 blur-3xl" aria-hidden />
    <div className="absolute -bottom-12 -left-8 h-44 w-44 rounded-full bg-white/10 blur-3xl" aria-hidden />

    <div className="relative flex flex-col gap-4 text-primary-foreground sm:flex-row sm:items-center sm:justify-between">
      <div className="space-y-2 max-w-xl">
        <div className="inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1 text-xs font-medium backdrop-blur-sm text-primary-foreground">
          <Sparkles className="h-3.5 w-3.5" aria-hidden />
          Comece por aqui
        </div>
        <h2 className="text-xl sm:text-2xl font-bold leading-tight">
          Comece adicionando um candidato
        </h2>
        <p className="text-sm sm:text-base text-primary-foreground/85">
          Você precisa adicionar candidatos para liberar análises, gráficos e monitoramento em tempo real.
        </p>
      </div>

      <Button
        asChild
        size="lg"
        className="shrink-0 shadow-lg hover-lift font-semibold bg-white text-primary hover:bg-white/90 dark:bg-white dark:text-primary"
      >
        <Link to="/dashboard/candidates-catalog">
          Adicionar candidato
          <ArrowRight className="ml-2 h-4 w-4 text-primary" aria-hidden />
        </Link>
      </Button>
    </div>
  </div>
);
