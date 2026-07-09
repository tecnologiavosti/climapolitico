const SOURCES: { name: string; slug: string; color: string }[] = [
  { name: "LinkedIn", slug: "linkedin", color: "0A66C2" },
  { name: "Wikipedia", slug: "wikipedia", color: "000000" },
  { name: "Telegram", slug: "telegram", color: "26A5E4" },
  { name: "Google News", slug: "googlenews", color: "4285F4" },
  { name: "TikTok", slug: "tiktok", color: "000000" },
  { name: "YouTube", slug: "youtube", color: "FF0000" },
  { name: "Bluesky", slug: "bluesky", color: "0285FF" },
  { name: "Reddit", slug: "reddit", color: "FF4500" },
  { name: "Facebook", slug: "facebook", color: "1877F2" },
  { name: "Instagram", slug: "instagram", color: "E4405F" },
  { name: "X / Twitter", slug: "x", color: "000000" },
];

export const MonitoredSources = () => {
  return (
    <section className="container mx-auto px-4 pt-8 pb-12 sm:pt-10 sm:pb-16">
      <div className="text-center mb-8 sm:mb-10 animate-fade-in-up">
        <h2 className="text-3xl md:text-4xl font-bold mb-3">
          Fontes Monitoradas em <span className="gradient-text">Tempo Real</span>
        </h2>
        <p className="text-muted-foreground text-base md:text-lg max-w-2xl mx-auto">
          Coletamos sinais públicos de múltiplas plataformas para análise política, reputacional e tendências eleitorais.
        </p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3 sm:gap-4 max-w-5xl mx-auto justify-items-center">
        {SOURCES.map((s) => (
          <div
            key={s.slug}
            className="group relative flex flex-col items-center justify-center gap-2 rounded-2xl border border-border p-5 w-full h-[110px]
              bg-card/80 backdrop-blur-sm shadow-sm
              transition-all duration-[250ms]
              hover:-translate-y-1 hover:border-primary/40 hover:shadow-[0_10px_30px_-10px_hsl(var(--primary)/0.45)]"
          >
            <img
              src={`https://cdn.simpleicons.org/${s.slug}/${s.color}`}
              alt=""
              aria-hidden="true"
              loading="lazy"
              onError={(e) => {
                const el = e.currentTarget;
                el.style.display = "none";
                const fb = el.nextElementSibling as HTMLElement | null;
                if (fb) fb.style.display = "flex";
              }}
              className="h-8 w-8 sm:h-9 sm:w-9 object-contain transition-transform duration-300 group-hover:scale-110 dark:brightness-110"
            />
            <span aria-hidden="true" className="hidden h-8 w-8 items-center justify-center text-xl">
              🌐
            </span>
            <span className="text-xs sm:text-sm font-semibold text-foreground/90 text-center">
              {s.name}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
};

export default MonitoredSources;
