import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { TrendingUp, MapPin, User, Building2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

type TrendingItem = {
  role: string;
  full_name: string;
  party: string | null;
  region: string | null;
  photo_url: string | null;
  mentions_count: number;
};

const ROLE_ORDER = [
  "Presidente",
  "Senador",
  "Deputado Federal",
  "Deputado Estadual",
  "Prefeito",
];

function initials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((n) => n[0]?.toUpperCase() ?? "")
    .join("");
}

const CardShell = ({
  role,
  delay,
  children,
}: {
  role: string;
  delay: number;
  children: React.ReactNode;
}) => (
  <div
    className="relative rounded-2xl bg-gradient-primary p-[1.5px] shadow-lg hover-glow transition-all duration-500 hover:-translate-y-1 group animate-fade-in-up"
    style={{ animationDelay: `${delay}ms` }}
  >
    <div className="relative rounded-2xl bg-card/70 backdrop-blur-md border border-border/40 p-6 h-full flex flex-col items-center text-center overflow-hidden">
      {/* subtle radial glow */}
      <div className="pointer-events-none absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 bg-[radial-gradient(circle_at_50%_0%,hsl(var(--primary)/0.15),transparent_60%)]" />
      <span className="absolute top-3 left-3 z-10 inline-flex items-center gap-1 rounded-full bg-background/70 backdrop-blur px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground border border-border/60">
        {role}
      </span>
      {children}
    </div>
  </div>
);

const Avatar = ({ src, name }: { src: string | null; name: string }) => (
  <div className="relative mt-4 mb-5">
    <div className="absolute -inset-1 rounded-full bg-gradient-primary blur-md opacity-50 group-hover:opacity-80 transition-opacity duration-500" />
    <div className="relative h-28 w-28 rounded-full bg-gradient-primary p-[2.5px] transition-transform duration-500 group-hover:scale-105">
      <div className="h-full w-full rounded-full bg-card p-[3px] overflow-hidden">
        {src ? (
          <img
            src={src}
            alt={name}
            loading="lazy"
            className="h-full w-full rounded-full object-cover object-center transition-transform duration-500 group-hover:scale-110"
          />
        ) : (
          <div className="h-full w-full rounded-full bg-gradient-primary flex items-center justify-center text-primary-foreground text-2xl font-bold">
            {initials(name) || <User className="h-10 w-10" />}
          </div>
        )}
      </div>
    </div>
  </div>
);

export const TrendingCandidates = () => {
  const [items, setItems] = useState<TrendingItem[] | null>(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
      const { data } = await supabase
        .from("trending_candidates_cache")
        .select("role, full_name, party, region, photo_url, mentions_count");
      if (!active) return;
      const byRole = new Map<string, TrendingItem>(
        (data ?? []).map((d) => [d.role, d as TrendingItem]),
      );
      // Always render the 5 roles in fixed order; missing ones become skeletons.
      const ordered = ROLE_ORDER.map((r) => byRole.get(r)).filter(Boolean) as TrendingItem[];
      setItems(ordered);
    };
    load();
    const id = setInterval(load, 5 * 60 * 1000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, []);

  const displayItems: (TrendingItem | { role: string; placeholder: true })[] =
    items === null
      ? ROLE_ORDER.map((role) => ({ role, placeholder: true as const }))
      : ROLE_ORDER.map(
          (role) =>
            items.find((i) => i.role === role) ?? { role, placeholder: true as const },
        );

  return (
    <section className="container mx-auto px-4 py-16 md:py-24">
      <div className="text-center mb-10 md:mb-14 animate-fade-in-up">
        <Badge variant="secondary" className="mb-4">
          <TrendingUp className="mr-1 h-3 w-3" />
          Atualizado em tempo real
        </Badge>
        <h2 className="text-3xl md:text-5xl font-bold mb-3">
          Candidatos <span className="gradient-text">Mais Pesquisados</span>
        </h2>
        <p className="text-muted-foreground text-base md:text-lg max-w-2xl mx-auto">
          Os nomes com maior volume de interesse público nas redes sociais agora, por cargo.
        </p>
      </div>

      <div className="grid gap-5 sm:gap-6 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 max-w-7xl mx-auto">
        {displayItems.map((entry, idx) => {
          if ("placeholder" in entry) {
            return (
              <CardShell key={entry.role} role={entry.role} delay={idx * 80}>
                <Skeleton className="mt-4 mb-5 h-28 w-28 rounded-full" />
                <Skeleton className="h-5 w-32 mb-2" />
                <Skeleton className="h-3 w-20 mb-1" />
                <Skeleton className="h-3 w-16" />
              </CardShell>
            );
          }
          return (
            <CardShell key={entry.role} role={entry.role} delay={idx * 80}>
              <Avatar src={entry.photo_url} name={entry.full_name} />
              <h3 className="text-lg font-bold leading-tight text-foreground line-clamp-2">
                {entry.full_name}
              </h3>
              <p className="mt-1 text-sm font-medium text-primary">{entry.role}</p>
              <div className="mt-3 flex flex-col items-center gap-1.5 text-xs text-muted-foreground">
                {entry.party ? (
                  <span className="inline-flex items-center gap-1">
                    <Building2 className="h-3 w-3" />
                    {entry.party}
                  </span>
                ) : null}
                {entry.region ? (
                  <span className="inline-flex items-center gap-1">
                    <MapPin className="h-3 w-3" />
                    {entry.region}
                  </span>
                ) : null}
              </div>
            </CardShell>
          );
        })}
      </div>
    </section>
  );
};
