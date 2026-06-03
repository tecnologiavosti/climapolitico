import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { TrendingUp, MapPin, User } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

type TrendingItem = {
  role: string;
  full_name: string;
  party: string | null;
  region: string | null;
  photo_url: string | null;
  mentions_count: number;
};

const ROLE_ORDER = ["Presidente", "Senador", "Deputado Federal", "Deputado Estadual", "Prefeito"];

function initials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((n) => n[0]?.toUpperCase() ?? "")
    .join("");
}

export const TrendingCandidates = () => {
  const [items, setItems] = useState<TrendingItem[] | null>(null);

  useEffect(() => {
    let active = true;

    const load = async () => {
      const { data } = await supabase
        .from("trending_candidates_cache")
        .select("role, full_name, party, region, photo_url, mentions_count");
      if (!active) return;
      const sorted = (data ?? []).slice().sort(
        (a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role),
      );
      setItems(sorted as TrendingItem[]);
    };

    load();
    // Pull updates every 5 min while the page is open
    const id = setInterval(load, 5 * 60 * 1000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, []);

  return (
    <section className="container mx-auto px-4 py-16 md:py-24">
      <div className="text-center mb-10 md:mb-12 animate-fade-in-up">
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

      <div className="max-w-md mx-auto flex flex-col gap-5">
        {items === null
          ? ROLE_ORDER.map((r) => (
              <Card key={r} className="p-5 flex items-center gap-4">
                <Skeleton className="h-20 w-20 rounded-full shrink-0" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-5 w-40" />
                  <Skeleton className="h-3 w-32" />
                </div>
              </Card>
            ))
          : items.length === 0
            ? (
              <Card className="p-8 text-center text-muted-foreground">
                Coletando dados públicos. Volte em alguns minutos.
              </Card>
            )
            : items.map((c, idx) => (
                <Card
                  key={c.role}
                  className="p-5 flex items-center gap-4 hover-lift hover-glow transition-all duration-300 border-2 animate-fade-in-up"
                  style={{ animationDelay: `${idx * 80}ms` }}
                >
                  <Avatar className="h-20 w-20 shrink-0 ring-2 ring-primary/30">
                    {c.photo_url ? <AvatarImage src={c.photo_url} alt={c.full_name} /> : null}
                    <AvatarFallback className="bg-gradient-primary text-primary-foreground text-lg font-semibold">
                      {initials(c.full_name) || <User className="h-8 w-8" />}
                    </AvatarFallback>
                  </Avatar>

                  <div className="flex-1 min-w-0">
                    <Badge className="mb-1.5 bg-gradient-primary text-primary-foreground">{c.role}</Badge>
                    <h3 className="text-lg font-bold leading-tight truncate">{c.full_name}</h3>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-sm text-muted-foreground">
                      {c.party ? <span className="font-medium">{c.party}</span> : null}
                      {c.region ? (
                        <span className="flex items-center gap-1">
                          <MapPin className="h-3 w-3" />
                          {c.region}
                        </span>
                      ) : null}
                    </div>
                  </div>
                </Card>
              ))}
      </div>
    </section>
  );
};
