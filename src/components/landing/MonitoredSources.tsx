import { useEffect, useRef, useState } from "react";

const SOURCES: { name: string; slug: string; color: string; invertOnDark?: boolean }[] = [
  { name: "LinkedIn", slug: "linkedin", color: "0A66C2" },
  { name: "Wikipedia", slug: "wikipedia", color: "000000", invertOnDark: true },
  { name: "Telegram", slug: "telegram", color: "26A5E4" },
  { name: "Google News", slug: "googlenews", color: "4285F4" },
  { name: "TikTok", slug: "tiktok", color: "000000", invertOnDark: true },
  { name: "YouTube", slug: "youtube", color: "FF0000" },
  { name: "Bluesky", slug: "bluesky", color: "0285FF" },
  { name: "Reddit", slug: "reddit", color: "FF4500" },
  { name: "Facebook", slug: "facebook", color: "1877F2" },
  { name: "Instagram", slug: "instagram", color: "E4405F" },
  { name: "X / Twitter", slug: "x", color: "000000", invertOnDark: true },
];

export const MonitoredSources = () => {
  const trackRef = useRef<HTMLDivElement>(null);
  const pausedRef = useRef(false);

  // Duplicate list for seamless infinite loop
  const loop = [...SOURCES, ...SOURCES];

  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    let raf = 0;
    let x = 0;
    const isMobile = typeof window !== "undefined" && window.matchMedia("(max-width: 640px)").matches;
    const speed = isMobile ? 1.6 : 1.1;
    const step = () => {
      const pausedNow = pausedRef.current && !isMobile;
      if (!pausedNow) {
        x -= speed;
        const half = el.scrollWidth / 2;
        if (Math.abs(x) >= half) x = 0;
        el.style.transform = `translate3d(${x}px, 0, 0)`;
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <section className="container mx-auto px-4 py-16 sm:py-20">
      <div className="text-center mb-10 animate-fade-in-up">
        <h2 className="text-3xl md:text-4xl font-bold mb-3">
          Fontes Monitoradas em <span className="gradient-text">Tempo Real</span>
        </h2>
        <p className="text-muted-foreground text-base md:text-lg max-w-2xl mx-auto">
          Coletamos sinais públicos de múltiplas plataformas para análise política e reputacional.
        </p>
      </div>

      <div
        className="relative overflow-hidden"
        onMouseEnter={() => { pausedRef.current = true; }}
        onMouseLeave={() => { pausedRef.current = false; }}
      >
        {/* Edge fade */}
        <div className="pointer-events-none absolute inset-y-0 left-0 w-16 sm:w-28 bg-gradient-to-r from-background to-transparent z-10" />
        <div className="pointer-events-none absolute inset-y-0 right-0 w-16 sm:w-28 bg-gradient-to-l from-background to-transparent z-10" />

        <div
          ref={trackRef}
          className="flex gap-4 sm:gap-5 will-change-transform"
          style={{ width: "max-content" }}
        >
          {loop.map((s, i) => (
            <div
              key={`${s.slug}-${i}`}
              className="group relative flex flex-col items-center justify-center gap-2.5 rounded-[20px] border transition-all duration-[250ms] cursor-pointer shrink-0
                w-[130px] h-[90px] sm:w-[180px] sm:h-[110px]
                bg-white/95 border-black/[0.06] shadow-sm backdrop-blur-xl
                dark:bg-slate-800/70 dark:border-white/[0.06]
                hover:-translate-y-1 hover:scale-[1.02] hover:shadow-[0_12px_30px_rgba(0,0,0,0.18)]"
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
                className="h-7 w-7 sm:h-9 sm:w-9 object-contain block transition-transform duration-300 group-hover:scale-110 dark:brightness-110"
              />
              <span
                aria-hidden="true"
                className="hidden h-7 w-7 sm:h-9 sm:w-9 items-center justify-center text-lg sm:text-xl"
              >
                🌐
              </span>
              <span className="text-xs sm:text-sm font-semibold text-foreground/90">
                {s.name}
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default MonitoredSources;
