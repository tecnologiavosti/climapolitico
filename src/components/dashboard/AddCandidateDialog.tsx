import { useMemo, useState } from "react";
import { z } from "zod";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  UserPlus, Loader2, Instagram, Facebook, Youtube, Twitter, Music2,
  User, Flag, Briefcase, MapPin, Upload, Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";

const PARTIES = [
  "PT", "PL", "União Brasil", "MDB", "PSD", "Republicanos", "PP", "PSB",
  "PDT", "PSDB", "Novo", "PSOL", "Podemos", "Avante", "Solidariedade",
] as const;

const POSITIONS = [
  "Presidente", "Governador", "Senador",
  "Deputado Federal", "Deputado Estadual", "Prefeito", "Vereador",
] as const;

const REGIONS: Record<string, string[]> = {
  "Norte": ["AC", "AP", "AM", "PA", "RO", "RR", "TO"],
  "Nordeste": ["AL", "BA", "CE", "MA", "PB", "PE", "PI", "RN", "SE"],
  "Centro-Oeste": ["DF", "GO", "MT", "MS"],
  "Sudeste": ["SP", "RJ", "MG", "ES"],
  "Sul": ["PR", "SC", "RS"],
};

const SOCIALS = [
  { key: "tiktok", label: "TikTok", Icon: Music2, placeholder: "https://tiktok.com/@usuario", color: "from-fuchsia-500/15 to-cyan-500/15" },
  { key: "instagram", label: "Instagram", Icon: Instagram, placeholder: "https://instagram.com/usuario", color: "from-pink-500/15 to-orange-500/15" },
  { key: "facebook", label: "Facebook", Icon: Facebook, placeholder: "https://facebook.com/pagina", color: "from-blue-500/15 to-indigo-500/15" },
  { key: "twitter", label: "Twitter / X", Icon: Twitter, placeholder: "https://x.com/usuario", color: "from-zinc-500/15 to-slate-500/15" },
  { key: "youtube", label: "YouTube", Icon: Youtube, placeholder: "https://youtube.com/@canal", color: "from-red-500/15 to-rose-500/15" },
] as const;

type SocialKey = typeof SOCIALS[number]["key"];

const urlOpt = z
  .string()
  .trim()
  .refine((v) => !v || v.startsWith("http://") || v.startsWith("https://"), {
    message: "Link deve começar com http:// ou https://",
  })
  .optional()
  .or(z.literal(""));

const schema = z.object({
  fullName: z.string().trim().min(3, "Nome deve ter no mínimo 3 caracteres").max(100),
  party: z.string().min(1, "Selecione um partido"),
  position: z.string().min(1, "Selecione um cargo"),
  region: z.string().min(1, "Selecione uma região"),
  state: z.string().min(1, "Selecione um estado"),
  socials: z.object({
    tiktok: urlOpt, instagram: urlOpt, facebook: urlOpt, twitter: urlOpt, youtube: urlOpt,
  }),
});

export type AddCandidatePayload = {
  fullName: string;
  party: string;
  position: string;
  region: string;
  state: string;
  socials: Record<SocialKey, string>;
  photoFile: File | null;
};

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  isPending: boolean;
  trigger?: React.ReactNode;
  onSubmit: (data: AddCandidatePayload) => void;
}

const emptySocials: Record<SocialKey, string> = {
  tiktok: "", instagram: "", facebook: "", twitter: "", youtube: "",
};

export function AddCandidateDialog({ open, onOpenChange, isPending, trigger, onSubmit }: Props) {
  const [fullName, setFullName] = useState("");
  const [party, setParty] = useState("");
  const [position, setPosition] = useState("");
  const [region, setRegion] = useState("");
  const [state, setState] = useState("");
  const [socials, setSocials] = useState<Record<SocialKey, string>>(emptySocials);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const states = useMemo(() => (region ? REGIONS[region] ?? [] : []), [region]);

  const scopeBadge = useMemo(() => {
    if (position === "Presidente") return { label: "Monitoramento nacional", cls: "bg-gradient-to-r from-emerald-500/15 to-cyan-500/15 text-emerald-600 dark:text-emerald-300 border-emerald-500/30" };
    if (position === "Governador") return { label: "Monitoramento estadual", cls: "bg-gradient-to-r from-blue-500/15 to-indigo-500/15 text-blue-600 dark:text-blue-300 border-blue-500/30" };
    if (position === "Senador") return { label: "Monitoramento regional", cls: "bg-gradient-to-r from-amber-500/15 to-orange-500/15 text-amber-600 dark:text-amber-300 border-amber-500/30" };
    return null;
  }, [position]);

  const reset = () => {
    setFullName(""); setParty(""); setPosition(""); setRegion(""); setState("");
    setSocials(emptySocials); setPhotoFile(null); setPhotoPreview(null); setErrors({});
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});
    const parsed = schema.safeParse({ fullName, party, position, region, state, socials });
    if (!parsed.success) {
      const e: Record<string, string> = {};
      parsed.error.issues.forEach((i) => {
        const k = i.path.join(".");
        e[k] = i.message;
      });
      setErrors(e);
      return;
    }
    onSubmit({ fullName, party, position, region, state, socials, photoFile });
  };

  const onOpen = (v: boolean) => {
    if (!v && !isPending) reset();
    onOpenChange(v);
  };

  const onPhoto = (file: File | null) => {
    setPhotoFile(file);
    if (photoPreview) URL.revokeObjectURL(photoPreview);
    setPhotoPreview(file ? URL.createObjectURL(file) : null);
  };

  return (
    <Dialog open={open} onOpenChange={onOpen}>
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent className="sm:max-w-[720px] max-h-[90vh] overflow-y-auto p-0 gap-0 rounded-2xl border-border/60">
        <div className="px-6 pt-6 pb-4 border-b border-border/60 bg-gradient-to-b from-muted/40 to-transparent">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center ring-1 ring-primary/20">
                <Sparkles className="h-5 w-5 text-primary" />
              </div>
              <div>
                <DialogTitle className="text-xl">Adicionar novo candidato</DialogTitle>
                <DialogDescription className="text-sm">
                  Cadastre quem você quer monitorar — preencha em segundos.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-6 space-y-6">
          {/* Section 1 — Dados básicos */}
          <Section index={1} title="Dados básicos" icon={<User className="h-4 w-4" />}>
            <div className="grid grid-cols-1 sm:grid-cols-[112px_1fr] gap-4">
              <label
                className={cn(
                  "relative aspect-square w-28 rounded-2xl border-2 border-dashed border-border/60 hover:border-primary/50 transition-colors cursor-pointer overflow-hidden bg-muted/30 flex items-center justify-center group",
                )}
              >
                {photoPreview ? (
                  <img src={photoPreview} alt="Prévia" className="absolute inset-0 h-full w-full object-cover" />
                ) : (
                  <div className="flex flex-col items-center text-muted-foreground text-xs gap-1">
                    <Upload className="h-5 w-5 group-hover:text-primary transition-colors" />
                    <span>Foto</span>
                  </div>
                )}
                <input
                  type="file"
                  accept="image/*"
                  className="absolute inset-0 opacity-0 cursor-pointer"
                  onChange={(e) => onPhoto(e.target.files?.[0] ?? null)}
                  disabled={isPending}
                />
              </label>
              <div className="space-y-2">
                <Label htmlFor="fullName">Nome completo *</Label>
                <Input
                  id="fullName"
                  placeholder="Ex: Maria Santos"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  disabled={isPending}
                  className="h-11"
                />
                {errors.fullName && <p className="text-xs text-destructive">{errors.fullName}</p>}
                {scopeBadge && (
                  <Badge variant="outline" className={cn("mt-1 font-medium", scopeBadge.cls)}>
                    {scopeBadge.label}
                  </Badge>
                )}
              </div>
            </div>
          </Section>

          {/* Section 2 — Partido */}
          <Section index={2} title="Partido" icon={<Flag className="h-4 w-4" />}>
            <Select value={party} onValueChange={setParty} disabled={isPending}>
              <SelectTrigger className="h-11"><SelectValue placeholder="Selecione o partido" /></SelectTrigger>
              <SelectContent>
                {PARTIES.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
              </SelectContent>
            </Select>
            {errors.party && <p className="text-xs text-destructive mt-1">{errors.party}</p>}
          </Section>

          {/* Section 3 — Cargo */}
          <Section index={3} title="Cargo" icon={<Briefcase className="h-4 w-4" />}>
            <Select value={position} onValueChange={setPosition} disabled={isPending}>
              <SelectTrigger className="h-11"><SelectValue placeholder="Selecione o cargo" /></SelectTrigger>
              <SelectContent>
                {POSITIONS.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
              </SelectContent>
            </Select>
            {errors.position && <p className="text-xs text-destructive mt-1">{errors.position}</p>}
          </Section>

          {/* Section 4 — Região / Estado */}
          <Section index={4} title="Região e estado" icon={<MapPin className="h-4 w-4" />}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Select
                  value={region}
                  onValueChange={(v) => { setRegion(v); setState(""); }}
                  disabled={isPending}
                >
                  <SelectTrigger className="h-11"><SelectValue placeholder="Região" /></SelectTrigger>
                  <SelectContent>
                    {Object.keys(REGIONS).map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                  </SelectContent>
                </Select>
                {errors.region && <p className="text-xs text-destructive mt-1">{errors.region}</p>}
              </div>
              <div>
                <Select value={state} onValueChange={setState} disabled={isPending || !region}>
                  <SelectTrigger className="h-11">
                    <SelectValue placeholder={region ? "Estado" : "Selecione uma região primeiro"} />
                  </SelectTrigger>
                  <SelectContent>
                    {states.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
                {errors.state && <p className="text-xs text-destructive mt-1">{errors.state}</p>}
              </div>
            </div>
          </Section>

          {/* Section 5 — Redes sociais */}
          <Section index={5} title="Redes sociais" icon={<Sparkles className="h-4 w-4" />} subtitle="Opcional. Adicione apenas as que você quer monitorar.">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {SOCIALS.map(({ key, label, Icon, placeholder, color }) => {
                const filled = !!socials[key];
                return (
                  <div
                    key={key}
                    className={cn(
                      "rounded-xl border border-border/60 p-3 transition-all hover:border-primary/40 hover:shadow-sm bg-gradient-to-br",
                      color,
                      filled && "border-primary/40 ring-1 ring-primary/20",
                    )}
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <div className="h-8 w-8 rounded-lg bg-background/80 backdrop-blur flex items-center justify-center">
                        <Icon className="h-4 w-4" />
                      </div>
                      <span className="text-sm font-medium">{label}</span>
                    </div>
                    <Input
                      placeholder={placeholder}
                      value={socials[key]}
                      onChange={(e) => setSocials({ ...socials, [key]: e.target.value })}
                      disabled={isPending}
                      className="h-9 bg-background/70"
                    />
                    {errors[`socials.${key}`] && (
                      <p className="text-xs text-destructive mt-1">{errors[`socials.${key}`]}</p>
                    )}
                  </div>
                );
              })}
            </div>
          </Section>

          <div className="flex justify-end gap-2 pt-2 border-t border-border/60 -mx-6 px-6 pt-4 sticky bottom-0 bg-background">
            <Button type="button" variant="outline" onClick={() => onOpen(false)} disabled={isPending}>
              Cancelar
            </Button>
            <Button type="submit" disabled={isPending} className="min-w-[180px]">
              {isPending ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Processando...</>
              ) : (
                <><UserPlus className="mr-2 h-4 w-4" /> Adicionar candidato</>
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Section({
  index, title, subtitle, icon, children,
}: { index: number; title: string; subtitle?: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <header className="flex items-center gap-2">
        <div className="h-6 w-6 rounded-md bg-primary/10 text-primary text-xs font-semibold flex items-center justify-center">
          {index}
        </div>
        <div className="flex items-center gap-2 text-sm font-semibold">
          <span className="text-muted-foreground">{icon}</span>
          {title}
        </div>
        {subtitle && <span className="text-xs text-muted-foreground ml-1">— {subtitle}</span>}
      </header>
      <div>{children}</div>
    </section>
  );
}
