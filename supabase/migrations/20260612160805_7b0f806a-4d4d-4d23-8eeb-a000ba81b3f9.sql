-- Enable pgvector
create extension if not exists vector;

-- Event embeddings (1536 dims = text-embedding-3-small)
create table if not exists public.event_embeddings (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.political_events(id) on delete cascade,
  embedding vector(1536) not null,
  content_hash text not null,
  created_at timestamptz not null default now(),
  unique (event_id)
);

create index if not exists idx_event_embeddings_event on public.event_embeddings(event_id);
create index if not exists idx_event_embeddings_hnsw
  on public.event_embeddings using hnsw (embedding vector_cosine_ops);

grant select on public.event_embeddings to authenticated;
grant all on public.event_embeddings to service_role;

alter table public.event_embeddings enable row level security;

create policy "Users read embeddings of their events"
  on public.event_embeddings for select
  to authenticated
  using (exists (
    select 1 from public.political_events pe
    where pe.id = event_embeddings.event_id
      and pe.user_id = auth.uid()
  ));

create policy "Service role manages embeddings"
  on public.event_embeddings for all
  to service_role
  using (true) with check (true);

-- Embedding cache (hash -> vector) — TTL 30d via cron/cleanup
create table if not exists public.embedding_cache (
  content_hash text primary key,
  embedding vector(1536) not null,
  model text not null default 'openai/text-embedding-3-small',
  hits int not null default 0,
  created_at timestamptz not null default now(),
  last_used_at timestamptz not null default now()
);

grant select on public.embedding_cache to authenticated;
grant all on public.embedding_cache to service_role;

alter table public.embedding_cache enable row level security;
create policy "Service role manages embedding cache"
  on public.embedding_cache for all
  to service_role
  using (true) with check (true);
create policy "Authenticated reads embedding cache"
  on public.embedding_cache for select
  to authenticated using (true);

-- Top-K semantic search across events
create or replace function public.match_event_embeddings(
  query_embedding vector(1536),
  match_count int default 10,
  filter_candidate uuid default null
)
returns table (
  event_id uuid,
  similarity float
)
language sql stable
security definer
set search_path = public
as $$
  select ee.event_id,
         1 - (ee.embedding <=> query_embedding) as similarity
  from public.event_embeddings ee
  join public.political_events pe on pe.id = ee.event_id
  where filter_candidate is null or pe.candidate_id = filter_candidate
  order by ee.embedding <=> query_embedding
  limit match_count;
$$;

grant execute on function public.match_event_embeddings(vector, int, uuid) to authenticated, service_role;
