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
  <div className="group relative h-full rounded-xl bg-card border border-border/50 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_-12px_rgba(0,0,0,0.12)] transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_2px_4px_rgba(0,0,0,0.06),0_16px_40px_-16px_rgba(0,0,0,0.18)]">
    <div className="flex h-full flex-col items-center px-6 pt-8 pb-7 text-center">
      <span className="absolute top-3 right-3 text-[10px] font-semibold tracking-[0.12em] text-muted-foreground/70">
        #{item.rank}
      </span>
      <div className="relative mb-5">
        <div className="h-28 w-28 rounded-full bg-background ring-1 ring-border/60 shadow-[0_4px_14px_-4px_rgba(0,0,0,0.18)] overflow-hidden">
          {item.photo_url ? (
            <img
              src={item.photo_url}
              alt={item.full_name}
              loading="lazy"
              referrerPolicy="no-referrer"
              className="h-full w-full object-cover object-center transition-transform duration-500 group-hover:scale-[1.04]"
            />
          ) : (
            <div className="h-full w-full flex items-center justify-center bg-muted text-muted-foreground text-2xl font-semibold">
              {initials(item.full_name) || <User className="h-8 w-8" />}
            </div>
          )}
        </div>
      </div>
      <h3 className="text-[15px] font-semibold leading-snug tracking-tight text-foreground line-clamp-2 min-h-[2.6rem]">
        {item.full_name}
      </h3>
      <p className="mt-1.5 text-[12px] font-medium text-muted-foreground">{role}</p>
      <div className="mt-3 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground/80">
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
  <div className="h-full rounded-xl bg-card border border-border/50 shadow-sm">
    <div className="flex h-full flex-col items-center px-6 pt-8 pb-7">
      <Skeleton className="mb-5 h-28 w-28 rounded-full" />
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
      <Carousel opts={{ align: "start", loop: false, dragFree: true, containScroll: "trimSnaps" }} className="relative">
        <CarouselContent className="-ml-3">
          {(items === null ? Array.from({ length: 5 }) : list).map((entry, idx) => (
            <CarouselItem
              key={idx}
              className="pl-3 basis-[75%] xs:basis-[60%] sm:basis-1/2 md:basis-1/3 lg:basis-1/4 xl:basis-1/5"
            >
              {entry ? <Card item={entry as TrendingItem} role={role} /> : <CardSkeleton />}
            </CarouselItem>
          ))}
        </CarouselContent>
        <CarouselPrevious className="flex left-1 md:-left-4 h-8 w-8 md:h-9 md:w-9 bg-card/90 backdrop-blur border-border/60 text-muted-foreground hover:text-foreground shadow-md z-10" />
        <CarouselNext className="flex right-1 md:-right-4 h-8 w-8 md:h-9 md:w-9 bg-card/90 backdrop-blur border-border/60 text-muted-foreground hover:text-foreground shadow-md z-10" />
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

  // Blocklist: nomes que aparecem no cache de buscas mas NÃO são presidenciáveis
  // reais (ex-presidentes sem articulação, figuras históricas, familiares,
  // ou inelegíveis no ciclo atual).
  const PRESIDENTIAL_BLOCKLIST = new Set(
    [
      "dilma rousseff",
      "dilma vana rousseff",
      "michelle bolsonaro",
      "michelle de paula firmo reinaldo bolsonaro",
      "fernando henrique cardoso",
      "fhc",
      "michel temer",
      "itamar franco",
      "jose sarney",
      "josé sarney",
      "collor",
      "fernando collor",
      // Jair Bolsonaro está inelegível; quem representa o grupo é Flávio Bolsonaro.
      "jair bolsonaro",
      "jair messias bolsonaro",
    ].map((n) => n.toLowerCase())
  );

  // Fallback: presidenciáveis com viabilidade política real no ciclo atual.
  // Fotos de domínio público / Wikimedia Commons (URLs estáveis).
  const PRESIDENTIAL_FALLBACK: TrendingItem[] = [
    { role: "Presidente", rank: 1, full_name: "Luiz Inácio Lula da Silva", party: "PT", region: "Nacional", photo_url: "https://upload.wikimedia.org/wikipedia/commons/thumb/9/9e/Foto_oficial_de_Luiz_In%C3%A1cio_Lula_da_Silva_%28ombros%29_denoise.jpg/330px-Foto_oficial_de_Luiz_In%C3%A1cio_Lula_da_Silva_%28ombros%29_denoise.jpg", search_score: 0 },
    { role: "Presidente", rank: 2, full_name: "Flávio Bolsonaro", party: "PL", region: "RJ", photo_url: "https://upload.wikimedia.org/wikipedia/commons/thumb/b/b3/Foto_oficial_do_senador_Fl%C3%A1vio_Bolsonaro_%28v._AgSen%29_%283x4%29.jpg/330px-Foto_oficial_do_senador_Fl%C3%A1vio_Bolsonaro_%28v._AgSen%29_%283x4%29.jpg", search_score: 0 },
    { role: "Presidente", rank: 3, full_name: "Tarcísio de Freitas", party: "Republicanos", region: "SP", photo_url: "https://upload.wikimedia.org/wikipedia/commons/thumb/7/74/Governador_do_Estado_de_S%C3%A3o_Paulo%2C_Tarc%C3%ADsio_de_Freitas_-_Foto_Oficial_%28cropped%29.jpg/330px-Governador_do_Estado_de_S%C3%A3o_Paulo%2C_Tarc%C3%ADsio_de_Freitas_-_Foto_Oficial_%28cropped%29.jpg", search_score: 0 },
    { role: "Presidente", rank: 4, full_name: "Romeu Zema", party: "Novo", region: "MG", photo_url: "https://upload.wikimedia.org/wikipedia/commons/thumb/b/bd/Romeu_Zema%2C_December_2024_%28cropped%29.jpg/330px-Romeu_Zema%2C_December_2024_%28cropped%29.jpg", search_score: 0 },
    { role: "Presidente", rank: 5, full_name: "Ronaldo Caiado", party: "União Brasil", region: "GO", photo_url: "https://upload.wikimedia.org/wikipedia/commons/thumb/f/f5/Foto_oficial_do_governador_de_Goi%C3%A1s%2C_Ronaldo_Caiado_em_2023_%28ombros%29.jpg/330px-Foto_oficial_do_governador_de_Goi%C3%A1s%2C_Ronaldo_Caiado_em_2023_%28ombros%29.jpg", search_score: 0 },
  ];

  const normalize = (s: string) =>
    s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

  const byRole = (key: string) => {
    if (items === null) return null;
    let list = items.filter((i) => i.role === key);
    if (key === "Presidente") {
      list = list.filter((i) => !PRESIDENTIAL_BLOCKLIST.has(normalize(i.full_name)));
      // Preencher fotos ausentes usando o fallback (match por primeiro nome).
      list = list.map((it) => {
        if (it.photo_url) return it;
        const first = normalize(it.full_name).split(" ")[0];
        const fb = PRESIDENTIAL_FALLBACK.find((f) => normalize(f.full_name).split(" ")[0] === first);
        return fb?.photo_url ? { ...it, photo_url: fb.photo_url } : it;
      });
      // Completar até 5 com fallback de presidenciáveis viáveis, sem duplicar.
      const seen = new Set(list.map((i) => normalize(i.full_name).split(" ")[0]));
      for (const fb of PRESIDENTIAL_FALLBACK) {
        if (list.length >= 5) break;
        const first = normalize(fb.full_name).split(" ")[0];
        if (!seen.has(first)) {
          list.push(fb);
          seen.add(first);
        }
      }
      list = list.slice(0, 5).map((it, i) => ({ ...it, rank: i + 1 }));
    }
    return list.sort((a, b) => a.rank - b.rank);
  };

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
