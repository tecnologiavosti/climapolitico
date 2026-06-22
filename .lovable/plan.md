# Painel Administrativo Unificado + SEO Completo

## 1. Painel Administrativo Unificado

Hoje as funções administrativas estão dispersas em várias rotas (`AdminDashboard`, `AdminUsers`, `AdminFinance`, `AdminPlans`, `AdminSubscriptions`, `AdminCandidates`, `AdminAnalytics`, `AdminSecurity`, `AdminLogs`, `AdminSystem`, `AdminSettings`, `AdminApiSettings`, `AdminSeo`).

**Plano:**

- Criar `src/pages/dashboard/admin/AdminCenter.tsx` — uma única página com abas (`Tabs` do shadcn):
  - **Visão Geral** — KPIs atuais do `AdminDashboard` (usuários, MRR, planos, crescimento)
  - **Usuários** — conteúdo do `AdminUsers` (lista, filtros, banir, editar, criar)
  - **Assinaturas & Planos** — `AdminSubscriptions` + `AdminPlans`
  - **Financeiro** — `AdminFinance`
  - **Candidatos** — `AdminCandidates`
  - **Analytics** — `AdminAnalytics`
  - **Segurança & Logs** — `AdminSecurity` + `AdminLogs`
  - **Sistema** — `AdminSystem` + `AdminApiSettings`
  - **SEO** — novo `AdminSeoComplete` (ver seção 2)
  - **Configurações** — `AdminSettings`
- Refatorar as páginas existentes para exportar um **componente interno** (ex.: `AdminUsersInner`) sem o wrapper de layout, e o `AdminCenter` importa cada um dentro de um `TabsContent`.
- Em `Dashboard.tsx`:
  - Adicionar rota `/dashboard/admin` → `AdminCenter`
  - Aceitar query `?tab=usuarios` para abrir aba específica (deep-link)
  - Manter rotas antigas redirecionando para `/dashboard/admin?tab=...` (compatibilidade com sidebar atual)
- Atualizar `AppSidebar.tsx` para mostrar apenas **uma entrada** "Painel ADM" (no grupo administrativo), removendo as várias entradas atuais. Sub-itens viram abas dentro da página.

## 2. SEO Completo

Substituir `AdminSeo.tsx` por um módulo completo `AdminSeoComplete` com seções:

### a) Meta Tags por Rota
Mantém o que já existe em `seo_settings` (title, description, keywords, OG, canonical, noindex) com editor melhorado, validação de tamanho e preview Google/Facebook/Twitter.

### b) Códigos de Verificação
Nova tabela `seo_verifications`:
- `google_site_verification`
- `bing_site_verification`
- `yandex_verification`
- `pinterest_verification`
- `facebook_domain_verification`

Campos viram `<meta>` aplicados via `react-helmet-async` em `App.tsx`.

### c) IDs de Rastreamento (Tracking)
Nova tabela `seo_tracking`:
- `google_analytics_id` (GA4 G-XXXX)
- `google_tag_manager_id` (GTM-XXXX)
- `facebook_pixel_id`
- `tiktok_pixel_id`
- `linkedin_insight_id`
- `hotjar_id`
- `clarity_id` (Microsoft Clarity)
- `enabled` (boolean por integração)

Component `TrackingScripts.tsx` injeta scripts no `<head>` via Helmet quando habilitado e o usuário deu consentimento de cookies (integra com `CookieConsent`).

### d) Sitemap & robots.txt
- Painel mostra conteúdo atual de `/sitemap.xml` e `/robots.txt` (fetch client-side)
- Botão "Regenerar sitemap" chama edge function `generate-sitemap` que escreve em `seo_artifacts` (tabela cache) com todas as rotas + candidatos públicos
- Editor de `robots.txt` salvo em `seo_artifacts` e servido pela edge function `serve-robots`
- Mostra última atualização, número de URLs, tamanho

### e) Status & Saúde SEO
Card de status agregado:
- ✅/❌ Title e description configurados em todas as rotas principais
- ✅/❌ OG image global definido
- ✅/❌ Pelo menos um código de verificação ativo
- ✅/❌ GA/GTM configurado
- ✅/❌ Sitemap gerado nos últimos 7 dias
- ✅/❌ robots.txt presente
- ✅/❌ Canonical apontando para domínio oficial
- Score 0-100 + lista de pendências acionáveis

### Migrações SQL
```sql
CREATE TABLE public.seo_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text UNIQUE NOT NULL,
  code text NOT NULL,
  updated_at timestamptz DEFAULT now()
);
GRANT SELECT ON public.seo_verifications TO anon, authenticated;
GRANT ALL ON public.seo_verifications TO service_role;
ALTER TABLE public.seo_verifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read" ON public.seo_verifications FOR SELECT USING (true);
CREATE POLICY "admin write" ON public.seo_verifications FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TABLE public.seo_tracking (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text UNIQUE NOT NULL,
  tracking_id text NOT NULL,
  enabled boolean DEFAULT true,
  updated_at timestamptz DEFAULT now()
);
-- mesmos GRANT/RLS

CREATE TABLE public.seo_artifacts (
  id text PRIMARY KEY,   -- 'sitemap' | 'robots'
  content text NOT NULL,
  url_count int,
  generated_at timestamptz DEFAULT now()
);
-- public read, admin write
```

### Helmet integração
- Instalar `react-helmet-async`
- Provider em `src/main.tsx`
- Novo componente `SeoHead.tsx` lê `seo_verifications` + `seo_tracking` (React Query, cache 5min) e injeta no `<head>` em toda navegação

## Arquivos a criar/editar
- **Novos**: `AdminCenter.tsx`, `AdminSeoComplete.tsx`, `TrackingScripts.tsx`, `SeoHead.tsx`, 3 migrações SQL, edge function `generate-sitemap`, edge function `serve-robots`
- **Editar**: `Dashboard.tsx` (rotas/redirects), `AppSidebar.tsx` (entrada única), `main.tsx` (HelmetProvider), todas as páginas Admin atuais (extrair `*Inner` exportado)
- **Manter** as rotas antigas como redirect para preservar links/sidebar até estabilizar

## Detalhes técnicos
- Tudo em pt-BR
- `AdminCenter` protegido por `<AdminRoute>`
- Tabs com URL state (`useSearchParams`) para deep-link
- Preview SERP usa cores e tipografia padrão do shadcn, nada hardcoded
- Não tocar em `RealTimeMonitor`, `RadarPolitico`, `NetworkView`, `RegionalAnalysis` (mudanças recentes)
