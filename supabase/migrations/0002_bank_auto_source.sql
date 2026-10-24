-- Mark bank rows whose TWD balance the pipeline updates from a broker API.
-- The pipeline finds its row by this column instead of matching bank names,
-- and the frontend uses it to highlight auto-updated rows.

alter table public.bank_accounts
  add column auto_source text check (auto_source in ('sinopac', 'fubon'));

-- At most one row per source in a book, so an update can never hit two rows.
create unique index bank_accounts_auto_source_idx
  on public.bank_accounts (book_id, auto_source)
  where auto_source is not null;

-- Broker API keys belong to the main book (rick).
update public.bank_accounts set auto_source = 'sinopac'
  where bank = '永豐大戶' and book_id = (select id from public.books where name = 'rick');

update public.bank_accounts set auto_source = 'fubon'
  where bank = '台北富邦' and book_id = (select id from public.books where name = 'rick');
