import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "@/components/ui/carousel";
import { Search, MapPin, Building2, User } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

type TrendingItem = {
  role: string;
  rank: number;
  full_name: string;
  party: string | null;
  region: string | null;
  photo_url: string | null;
  search_score: number;
};

const ROLES_PLURAL: Array<{ key: string; label: string }> = [
  { key: "Presidente", label: "Presidentes" },
  { key: "Senador", label: "Senadores" },
  { key: "Deputado Federal", label: "Deputados Federais" },
  { key: "Deputado Estadual", label: "Deputados Estaduais" },
  { key: "Prefeito", label: "Prefeitos" },
];

function initials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((n) => n[0]?.toUpperCase() ?? "")
    .join("");
}

const Card = ({ item, role }: { item: TrendingItem; role: string }) => (
  <div className="relative rounded-2xl bg-gradient-primary p-[1.5px] shadow-lg hover-glow transition-all duration-500 hover:-translate-y-1 group h-full">
    <div className="relative rounded-2xl bg-card/70 backdrop-blur-md border border-border/40 p-5 h-full flex flex-col items-center text-center overflow-hidden">
      <div className="pointer-events-none absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 bg-[radial-gradient(circle_at_50%_0%,hsl(var(--primary)/0.18),transparent_60%)]" />
      <span className="absolute top-3 left-3 z-10 rounded-full bg-background/70 backdrop-blur px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground border border-border/60">
        #{item.rank}
      </span>
      <div className="relative mt-4 mb-4">
        <div className="absolute -inset-1 rounded-full bg-gradient-primary blur-md opacity-50 group-hover:opacity-80 transition-opacity duration-500" />
        <div className="relative h-24 w-24 rounded-full bg-gradient-primary p-[2.5px] transition-transform duration-500 group-hover:scale-105">
          <div className="h-full w-full rounded-full bg-card p-[3px] overflow-hidden">
            {item.photo_url ? (
              <img
                src={item.photo_url}
                alt={item.full_name}
                loading="lazy"
                referrerPolicy="no-referrer"
                className="h-full w-full rounded-full object-cover object-center transition-transform duration-500 group-hover:scale-110"
              />
            ) : (
              <div className="h-full w-full rounded-full bg-gradient-primary flex items-center justify-center text-primary-foreground text-xl font-bold">
                {initials(item.full_name) || <User className="h-8 w-8" />}
              </div>
            )}
          </div>
        </div>
      </div>
      <h3 className="text-base font-bold leading-tight text-foreground line-clamp-2 min-h-[2.5rem]">
        {item.full_name}
      </h3>
      <p className="mt-1 text-xs font-medium text-primary">{role}</p>
      <div className="mt-2 flex flex-col items-center gap-1 text-[11px] text-muted-foreground">
        {item.party ? (
          <span className="inline-flex items-center gap-1">
            <Building2 className="h-3 w-3" />
            {item.party}
          </span>
        ) : null}
        {item.region ? (
          <span className="inline-flex items-center gap-1">
            <MapPin className="h-3 w-3" />
            {item.region}
          </span>
        ) : null}
      </div>
    </div>
  </div>
);

const CardSkeleton = () => (
  <div className="rounded-2xl bg-gradient-primary p-[1.5px] h-full">
    <div className="rounded-2xl bg-card/70 backdrop-blur-md border border-border/40 p-5 h-full flex flex-col items-center">
      <Skeleton className="mt-4 mb-4 h-24 w-24 rounded-full" />
      <Skeleton className="h-4 w-32 mb-2" />
      <Skeleton className="h-3 w-20 mb-2" />
      <Skeleton className="h-3 w-16" />
    </div>
  </div>
);

const RoleCarousel = ({
  label,
  role,
  items,
}: {
  label: string;
  role: string;
  items: TrendingItem[] | null;
}) => {
  const list = items ?? [];
  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between gap-4 px-1">
        <h3 className="text-xl md:text-2xl font-bold">
          <span className="gradient-text">{label}</span>
        </h3>
        <span className="text-xs text-muted-foreground hidden sm:block">
          Top 5 mais pesquisados
        </span>
      </div>
      <Carousel opts={{ align: "start", loop: false }} className="relative">
        <CarouselContent className="-ml-3">
          {(items === null ? Array.from({ length: 5 }) : list).map((entry, idx) => (
            <CarouselItem
              key={idx}
              className="pl-3 basis-[80%] sm:basis-1/2 md:basis-1/3 lg:basis-1/4 xl:basis-1/5"
            >
              {entry ? <Card item={entry as TrendingItem} role={role} /> : <CardSkeleton />}
            </CarouselItem>
          ))}
        </CarouselContent>
        <CarouselPrevious className="hidden md:flex -left-3 bg-card/80 backdrop-blur border-border/60" />
        <CarouselNext className="hidden md:flex -right-3 bg-card/80 backdrop-blur border-border/60" />
      </Carousel>
    </div>
  );
};

export const TrendingCandidates = () => {
  const [items, setItems] = useState<TrendingItem[] | null>(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
      const { data } = await supabase
        .from("trending_candidates_cache")
        .select("role, rank, full_name, party, region, photo_url, search_score")
        .order("role", { ascending: true })
        .order("rank", { ascending: true });
      if (!active) return;
      setItems((data ?? []) as TrendingItem[]);
    };
    load();
    const id = setInterval(load, 10 * 60 * 1000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, []);

  const byRole = (key: string) =>
    items === null ? null : items.filter((i) => i.role === key).sort((a, b) => a.rank - b.rank);

  return (
    <section className="container mx-auto px-4 py-16 md:py-24">
      <div className="text-center mb-10 md:mb-14 animate-fade-in-up">
        <Badge variant="secondary" className="mb-4">
          <Search className="mr-1 h-3 w-3" />
          Interesse de busca nacional
        </Badge>
        <h2 className="text-3xl md:text-5xl font-bold mb-3">
          Candidatos <span className="gradient-text">Mais Pesquisados</span> no Brasil
        </h2>
        <p className="text-muted-foreground text-base md:text-lg max-w-2xl mx-auto">
          Ranking nacional baseado no volume real de buscas públicas dos últimos 7 dias, por cargo.
        </p>
      </div>

      <div className="max-w-7xl mx-auto space-y-12">
        {ROLES_PLURAL.map((r) => (
          <RoleCarousel key={r.key} label={r.label} role={r.key} items={byRole(r.key)} />
        ))}
      </div>
    </section>
  );
};
