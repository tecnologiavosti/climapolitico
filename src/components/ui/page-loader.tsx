import logoAsset from "@/assets/clima-politico-logo.jpg.asset.json";

export const PageLoader = () => {
  return (
    <div
      className="flex min-h-screen items-center justify-center"
      style={{ background: "var(--gradient-app, hsl(var(--background)))" }}
    >
      <div className="flex flex-col items-center gap-4">
        <img
          src={logoAsset.url}
          alt="Clima Político"
          className="brand-logo h-20 w-20 rounded-full object-contain ring-1 ring-border animate-pulse"
        />
        <p className="text-sm text-muted-foreground">Analisando clima político...</p>
      </div>
    </div>
  );
};
