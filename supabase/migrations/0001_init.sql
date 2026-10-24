-- Initial schema: replaces the Google Sheet as the data store.
--
-- Two kinds of tables:
--   * Book-scoped (transactions, pledges, bank_accounts, crypto_positions, nav_history):
--     one book per former Sheet / config.json profile, guarded by RLS on books.owner_id.
--   * Shared market data (symbols, split_events, quotes, daily_close, daily_fx):
--     one copy for all books. The pipeline writes with the service_role key, which bypasses RLS.
--
-- Auth assumption: sign-ups are disabled in the Supabase dashboard, so every authenticated
-- user is the owner. Shared tables rely on that for their write policies.

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Books
-- ---------------------------------------------------------------------------

create table public.books (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references auth.users (id) on delete cascade,
  name        text not null,
  created_at  timestamptz not null default now(),
  unique (owner_id, name)
);

-- security definer so policies on other tables can check ownership without
-- recursing through the books policy.
create or replace function public.owns_book(target uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.books where id = target and owner_id = auth.uid()
  );
$$;

-- ---------------------------------------------------------------------------
-- Book-scoped data
-- ---------------------------------------------------------------------------

create table public.transactions (
  id          bigint generated always as identity primary key,
  book_id     uuid not null references public.books (id) on delete cascade,
  trade_date  date not null,
  broker      text not null,
  symbol      text not null,
  action      text not null check (action in ('BUY', 'SELL')),
  qty         numeric not null check (qty > 0),
  price       numeric not null check (price >= 0),
  currency    text not null check (currency in ('TWD', 'USD', 'HKD', 'JPY')),
  created_at  timestamptz not null default now()
);

create index transactions_book_date_idx on public.transactions (book_id, trade_date);
create index transactions_book_symbol_idx on public.transactions (book_id, symbol);

-- Collateral value and interest are derived from live prices and dates,
-- so the frontend computes them instead of storing a value that goes stale.
create table public.pledges (
  id              bigint generated always as identity primary key,
  book_id         uuid not null references public.books (id) on delete cascade,
  transfer_date   date not null,
  symbol          text not null,
  qty             numeric not null check (qty > 0),
  broker          text not null,
  loan_date       date,
  loan_amount     numeric check (loan_amount >= 0),
  rate            numeric check (rate >= 0),
  repayment_date  date,
  created_at      timestamptz not null default now()
);

create index pledges_book_idx on public.pledges (book_id);

create table public.bank_accounts (
  id          bigint generated always as identity primary key,
  book_id     uuid not null references public.books (id) on delete cascade,
  bank        text not null,
  usd         numeric not null default 0,
  twd         numeric not null default 0,
  loan        numeric not null default 0,
  updated_at  timestamptz not null default now(),
  unique (book_id, bank)
);

create trigger bank_accounts_updated_at
  before update on public.bank_accounts
  for each row execute function public.set_updated_at();

-- Pionex and Bitfinex in one table; columns one exchange doesn't report stay null.
create table public.crypto_positions (
  id             bigint generated always as identity primary key,
  book_id        uuid not null references public.books (id) on delete cascade,
  exchange       text not null check (exchange in ('pionex', 'bitfinex')),
  account        text,
  wallet_type    text not null,
  coin           text not null,
  qty            numeric not null,
  available      numeric,
  avg_cost       numeric,
  current_price  numeric,
  updated_at     timestamptz not null default now()
);

create index crypto_positions_book_idx on public.crypto_positions (book_id, exchange);

create trigger crypto_positions_updated_at
  before update on public.crypto_positions
  for each row execute function public.set_updated_at();

-- Recomputed in full by pipeline/build_history.py; never edited by hand.
create table public.nav_history (
  book_id       uuid not null references public.books (id) on delete cascade,
  date          date not null,
  market_value  numeric not null,
  cost          numeric not null,
  unrealized    numeric not null,
  realized      numeric not null,
  roi           numeric not null,
  primary key (book_id, date)
);

-- ---------------------------------------------------------------------------
-- Shared market data
-- ---------------------------------------------------------------------------

create table public.symbols (
  symbol      text primary key,
  name        text,
  currency    text check (currency in ('TWD', 'USD', 'HKD', 'JPY')),
  exchange    text check (exchange in ('tse', 'otc', 'us', 'hk', 'jp')),
  beta        numeric,
  updated_at  timestamptz not null default now()
);

create trigger symbols_updated_at
  before update on public.symbols
  for each row execute function public.set_updated_at();

-- ratio: shares per old share; reverse splits use a fraction (4-into-1 = 0.25).
create table public.split_events (
  id              bigint generated always as identity primary key,
  symbol          text not null,
  effective_date  date not null,
  ratio           numeric not null check (ratio > 0),
  created_at      timestamptz not null default now(),
  unique (symbol, effective_date)
);

create table public.quotes (
  symbol      text primary key,
  price       numeric not null,
  prev_close  numeric,
  source      text not null,
  quote_ts    timestamptz not null,
  fetched_at  timestamptz not null default now()
);

create table public.daily_close (
  symbol  text not null,
  date    date not null,
  close   numeric not null,
  source  text not null,
  primary key (symbol, date)
);

create index daily_close_date_idx on public.daily_close (date);

create table public.daily_fx (
  date    date primary key,
  usdtwd  numeric not null,
  source  text not null
);

-- ---------------------------------------------------------------------------
-- Row level security
-- anon gets nothing (no policies). service_role bypasses RLS.
-- ---------------------------------------------------------------------------

alter table public.books            enable row level security;
alter table public.transactions     enable row level security;
alter table public.pledges          enable row level security;
alter table public.bank_accounts    enable row level security;
alter table public.crypto_positions enable row level security;
alter table public.nav_history      enable row level security;
alter table public.symbols          enable row level security;
alter table public.split_events     enable row level security;
alter table public.quotes           enable row level security;
alter table public.daily_close      enable row level security;
alter table public.daily_fx         enable row level security;

create policy books_owner on public.books
  for all to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

-- Edited from the frontend.
create policy transactions_owner on public.transactions
  for all to authenticated
  using (public.owns_book(book_id))
  with check (public.owns_book(book_id));

create policy pledges_owner on public.pledges
  for all to authenticated
  using (public.owns_book(book_id))
  with check (public.owns_book(book_id));

create policy bank_accounts_owner on public.bank_accounts
  for all to authenticated
  using (public.owns_book(book_id))
  with check (public.owns_book(book_id));

-- Written only by the pipeline; read-only for the frontend.
create policy crypto_positions_read on public.crypto_positions
  for select to authenticated
  using (public.owns_book(book_id));

create policy nav_history_read on public.nav_history
  for select to authenticated
  using (public.owns_book(book_id));

-- Shared tables the frontend edits (beta, split events).
create policy symbols_read on public.symbols
  for select to authenticated using (true);
create policy symbols_insert on public.symbols
  for insert to authenticated with check (true);
create policy symbols_update on public.symbols
  for update to authenticated using (true) with check (true);

create policy split_events_read on public.split_events
  for select to authenticated using (true);
create policy split_events_insert on public.split_events
  for insert to authenticated with check (true);
create policy split_events_delete on public.split_events
  for delete to authenticated using (true);

-- Shared tables written only by the pipeline.
create policy quotes_read on public.quotes
  for select to authenticated using (true);
create policy daily_close_read on public.daily_close
  for select to authenticated using (true);
create policy daily_fx_read on public.daily_fx
  for select to authenticated using (true);
