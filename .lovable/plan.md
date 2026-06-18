# Painel Administrativo Integrado — Clima Político

## Contexto atual já existente

- `useAdminCheck` já valida admin via tabela `user_roles` (role `admin`) — SSOT correta, **vou manter**, sem mover roles para `profiles` (mover roles para `profiles` é vulnerável a privilege escalation; é uma regra de segurança).
- Já existe `src/pages/dashboard/Admin.tsx` e `AdminApiSettings.tsx`.
- Sidebar (`AppSidebar.tsx`) já consome `useAdminCheck`.
- Plano `lifetime` já foi adicionado ao enum recentemente.

Vou **expandir** o que já existe em vez de duplicar.

---

## Decisão chave: roles

Em vez de `is_admin`/`admin_role` em `profiles`, vou **estender o enum `app_role`** com sub-roles:

```text
app_role = admin | super_admin | finance_admin | support_admin | seo_admin | moderator | user
```

`user_roles` continua sendo a única fonte de verdade. Funções `has_role(uid, role)` e nova `has_any_admin_role(uid)` controlam acesso.

Motivo: segue a regra de segurança do projeto (roles em tabela separada, security definer). Funciona com as RLS existentes.

---

## Escopo de entrega (faseado)

O pedido é gigante (15 seções, ~10 sub-painéis). Vou entregar em **3 fases**. Confirme antes se quer todas agora ou só a Fase 1.

### Fase 1 — Fundação + Dashboard + Usuários (entrego primeiro)

1. **Migração DB**
   - Adicionar valores ao enum `app_role`: `super_admin`, `finance_admin`, `support_admin`, `seo_admin`.
   - Adicionar em `profiles`: `is_banned boolean default false`, `ban_reason text`, `banned_at timestamptz`, `banned_by uuid`.
   - Nova tabela `admin_audit_logs` (admin_id, action, target_type, target_id, metadata jsonb, ip, created_at) + RLS (apenas admins leem; service_role insere).
   - Funções: `has_admin_access(uid)`, `has_role(uid, app_role)` (já existe).
   - Trigger em `auth.users` login? Não — bloqueio de banidos via RLS + checagem no `useAuth`.

2. **Hook + guard**
   - `useAdminCheck` retorna `{ isAdmin, roles: string[], isLoading }`.
   - Componente `<AdminRoute requiredRole="super_admin">` redireciona não-autorizados para `/dashboard` com toast "Acesso negado".
   - `useAuth` verifica `is_banned` no profile e força signOut + toast.

3. **Sidebar ADMIN**
   - Nova seção colapsável "ADMIN" no fim de `AppSidebar.tsx`, visível só se `isAdmin`.
   - Itens: Painel, Usuários, Financeiro, Planos, SEO, Analytics, Segurança, Logs, Configurações.
   - Cada item filtrado pelo role específico.

4. **Rotas** (em `App.tsx`, dentro do mesmo layout `/dashboard`)
   - `/dashboard/admin` (já existe — será o novo painel)
   - `/dashboard/admin/users`
   - `/dashboard/admin/finance`
   - `/dashboard/admin/plans`
   - `/dashboard/admin/seo`
   - `/dashboard/admin/analytics`
   - `/dashboard/admin/security`
   - `/dashboard/admin/logs`
   - `/dashboard/admin/settings`

5. **Painel ADM (Dashboard)** — KPIs reais via queries:
   - total usuários, novos hoje, ativos 7d (`profiles`)
   - assinantes ativos, MRR estimado, churn 30d (`subscriptions`)
   - jobs falhando (`analysis_jobs`, `event_detection_jobs` status=failed)
   - edge function errors (`edge_function_logs`)
   - Gráficos: crescimento usuários (line), receita/mês (bar), distribuição de planos (pie).

6. **Gestão de Usuários**
   - Tabela paginada com search (nome/email), filtros (plano, status, banido).
   - Modal "Ver perfil": dados, plano, candidatos monitorados, jobs recentes, último login.
   - Ações: editar (nome, limites), trocar plano (free/pro/enterprise/lifetime), banir/desbanir (motivo + duração), soft/hard delete.
   - **Hard delete** chama edge function `admin-delete-user` (service_role) que remove em cascata: candidatos, social_interactions, candidate_analyses, embeddings, jobs, caches, e `auth.users`.
   - Todas as ações gravam em `admin_audit_logs`.

### Fase 2 — Financeiro, Planos, SEO

7. **Financeiro**: receita hoje/mês/ano, MRR, ARR a partir de `subscriptions`. Tabela de assinaturas com ações (cancelar, reativar). Reembolso/chargeback ficam como placeholder até integração com gateway (Stripe/Chargebee) — vou perguntar qual usar.

8. **Planos**: CRUD em nova tabela `subscription_plans` (tier, price_monthly, price_yearly, max_candidates, max_updates, features jsonb, active). Hoje os limites estão hardcoded em `useSubscription` — vou ler dessa tabela.

9. **SEO Panel**: nova tabela `seo_settings` (route, title, description, og_image, keywords, schema_jsonld). Componente `<SEOHead route="..." />` lê e injeta via react-helmet-async (já no projeto?). Editor visual com preview.

### Fase 3 — Analytics, Segurança, Logs, Permissões finas

10. **Analytics**: pageviews/sessions exigem instrumentação. Vou usar `usage_events` existente + adicionar tracking de pageview no `App.tsx`. Funil de conversão (visit → signup → trial → paid).

11. **Segurança**: nova tabela `login_attempts` (email, ip, success, ua, created_at). Painel mostra falhas, top IPs, rate-limit hits (`rate_limits`). Ações: banir IP (tabela `banned_ips` + edge function middleware), invalidar sessões (admin API), reset senha (envia email).

12. **Logs ADM**: viewer de `admin_audit_logs` com filtros por admin, ação, alvo, range de data.

13. **Permissões finas por role** aplicadas em todas as rotas e na sidebar.

---

## Detalhes técnicos

```text
src/
├── components/admin/
│   ├── AdminRoute.tsx           (guard)
│   ├── AdminSidebarSection.tsx
│   ├── KpiGrid.tsx
│   ├── UsersTable.tsx
│   ├── UserDetailDrawer.tsx
│   └── AuditLogTable.tsx
├── hooks/
│   ├── useAdminCheck.tsx        (estender)
│   └── useAdminAudit.tsx        (helper p/ gravar log)
├── pages/dashboard/admin/
│   ├── Dashboard.tsx
│   ├── Users.tsx
│   ├── Finance.tsx
│   ├── Plans.tsx
│   ├── SEO.tsx
│   ├── Analytics.tsx
│   ├── Security.tsx
│   ├── Logs.tsx
│   └── Settings.tsx
supabase/functions/
├── admin-delete-user/
├── admin-ban-user/
└── admin-change-plan/
```

Edge functions usam `service_role` e verificam `has_admin_access(auth.uid())` antes de qualquer ação.

---

## Perguntas antes de começar

1. **Escopo**: entrego só **Fase 1** agora (fundação + dashboard + usuários — ~1 dia de trabalho) ou as 3 fases de uma vez (muito maior, mais risco de regressão)?
2. **Gateway de pagamento** para reembolso/cancelamento real (Fase 2): Stripe, Chargebee, ou só visualização sem integração?
3. **Qual email** vira `super_admin`? Sugiro `contatojasonti@gmail.com` (já é admin atual).

Responda 1–3 e eu começo pela Fase 1.
