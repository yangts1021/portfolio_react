// Supabase data access. Book-scoped tables are filtered by book_id; RLS additionally
// guarantees only the owner's rows come back. Shared tables (symbols, split_events,
// quotes) are the same for every book.
import { supabase } from './supabase';
import {
  BankAccount,
  Book,
  CurrencyType,
  ActionType,
  HistoryPoint,
  PledgeRecord,
  SplitEvent,
  Transaction,
} from '../types';
import { PriceQuoteMeta } from './marketData';

const PAGE = 1000; // Supabase caps a single response at 1000 rows by default

type Row = Record<string, unknown>;

const num = (v: unknown): number => Number(v) || 0;
const optDate = (v: unknown): string => (v ? String(v) : '');

const fail = (what: string, error: { message: string } | null) => {
  if (error) throw new Error(`${what}失敗：${error.message}`);
};

// Read every row of a query, paging past the 1000-row cap.
async function selectAll(
  what: string,
  build: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: Row[] | null; error: { message: string } | null }>,
): Promise<Row[]> {
  const rows: Row[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    fail(what, error);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) return rows;
  }
}

// --------------------------------------------------------------------------- //
// mapping
// --------------------------------------------------------------------------- //

const toTransaction = (r: Row): Transaction => ({
  id: num(r.id),
  date: String(r.trade_date),
  action: r.action as ActionType,
  symbol: String(r.symbol),
  broker: String(r.broker ?? ''),
  qty: num(r.qty),
  price: num(r.price),
  currency: r.currency as CurrencyType,
});

const toPledge = (r: Row): PledgeRecord => ({
  id: num(r.id),
  transferDate: optDate(r.transfer_date),
  symbol: String(r.symbol),
  qty: num(r.qty),
  broker: String(r.broker ?? ''),
  loanDate: optDate(r.loan_date),
  loanAmount: num(r.loan_amount),
  rate: num(r.rate),
  repaymentDate: optDate(r.repayment_date),
});

const toSplit = (r: Row): SplitEvent => ({
  id: num(r.id),
  symbol: String(r.symbol),
  date: String(r.effective_date),
  ratio: num(r.ratio),
});

// --------------------------------------------------------------------------- //
// reads
// --------------------------------------------------------------------------- //

export async function listBooks(): Promise<Book[]> {
  const { data, error } = await supabase.from('books').select('id, name').order('created_at');
  fail('讀取帳本', error);
  return (data ?? []).map((b) => ({ id: String(b.id), name: String(b.name) }));
}

export interface BookData {
  transactions: Transaction[];
  bankData: BankAccount[];
  pledgeData: PledgeRecord[];
  history: HistoryPoint[];
}

export async function loadBook(bookId: string): Promise<BookData> {
  const [tx, banks, pledges, nav] = await Promise.all([
    selectAll('讀取交易', (a, b) =>
      supabase.from('transactions').select('*').eq('book_id', bookId).order('id').range(a, b),
    ),
    selectAll('讀取銀行餘額', (a, b) =>
      supabase.from('bank_accounts').select('*').eq('book_id', bookId).order('id').range(a, b),
    ),
    selectAll('讀取質押', (a, b) =>
      supabase.from('pledges').select('*').eq('book_id', bookId).order('id').range(a, b),
    ),
    selectAll('讀取淨值歷史', (a, b) =>
      supabase.from('nav_history').select('*').eq('book_id', bookId).order('date').range(a, b),
    ),
  ]);

  return {
    transactions: tx.map(toTransaction),
    bankData: banks.map((r) => ({
      bank: String(r.bank),
      usd: num(r.usd),
      twd: num(r.twd),
      loan: num(r.loan),
    })),
    pledgeData: pledges.map(toPledge),
    history: nav.map((r) => ({
      date: String(r.date),
      marketValue: num(r.market_value),
      cost: num(r.cost),
      unrealized: num(r.unrealized),
      realized: num(r.realized),
      roi: num(r.roi),
    })),
  };
}

export interface SharedData {
  betas: Record<string, number>;
  splitEvents: SplitEvent[];
}

export async function loadShared(): Promise<SharedData> {
  const [symbols, splits] = await Promise.all([
    selectAll('讀取 beta', (a, b) =>
      supabase.from('symbols').select('symbol, beta').order('symbol').range(a, b),
    ),
    selectAll('讀取分割事件', (a, b) =>
      supabase.from('split_events').select('*').order('id').range(a, b),
    ),
  ]);
  const betas: Record<string, number> = {};
  symbols.forEach((r) => {
    if (r.beta !== null && r.beta !== undefined) betas[String(r.symbol)] = num(r.beta);
  });
  return { betas, splitEvents: splits.map(toSplit) };
}

export interface QuoteResult {
  prices: Record<string, number>;
  meta: Record<string, PriceQuoteMeta>;
}

export async function loadQuotes(symbols: string[]): Promise<QuoteResult> {
  const prices: Record<string, number> = {};
  const meta: Record<string, PriceQuoteMeta> = {};
  if (symbols.length === 0) return { prices, meta };
  const { data, error } = await supabase
    .from('quotes')
    .select('symbol, price, source, quote_ts')
    .in('symbol', symbols);
  fail('讀取報價', error);
  (data ?? []).forEach((q) => {
    const sym = String(q.symbol);
    prices[sym] = num(q.price);
    meta[sym] = { source: String(q.source), quoteTs: q.quote_ts ? String(q.quote_ts) : undefined };
  });
  return { prices, meta };
}

// --------------------------------------------------------------------------- //
// writes
// --------------------------------------------------------------------------- //

export async function addTransaction(
  bookId: string,
  tx: Omit<Transaction, 'id'>,
): Promise<Transaction> {
  const { data, error } = await supabase
    .from('transactions')
    .insert({
      book_id: bookId,
      trade_date: tx.date,
      broker: tx.broker,
      symbol: tx.symbol,
      action: tx.action,
      qty: tx.qty,
      price: tx.price,
      currency: tx.currency,
    })
    .select()
    .single();
  fail('新增交易', error);
  return toTransaction(data as Row);
}

// Deletes must report whether a row actually went away: RLS turns a forbidden delete into
// a silent no-op, so ask for the deleted rows back and treat zero as a failure.
async function deleteById(table: string, id: number, what: string): Promise<void> {
  const { data, error } = await supabase.from(table).delete().eq('id', id).select('id');
  fail(what, error);
  if (!data || data.length === 0) throw new Error(`${what}失敗：找不到這筆資料`);
}

export const deleteTransaction = (id: number) => deleteById('transactions', id, '刪除交易');

export async function addSplit(split: Omit<SplitEvent, 'id'>): Promise<SplitEvent> {
  const { data, error } = await supabase
    .from('split_events')
    .insert({ symbol: split.symbol, effective_date: split.date, ratio: split.ratio })
    .select()
    .single();
  fail('新增分割事件', error);
  return toSplit(data as Row);
}

export const deleteSplit = (id: number) => deleteById('split_events', id, '刪除分割事件');

export async function addPledge(
  bookId: string,
  p: Omit<PledgeRecord, 'id'>,
): Promise<PledgeRecord> {
  const { data, error } = await supabase
    .from('pledges')
    .insert({
      book_id: bookId,
      transfer_date: p.transferDate,
      symbol: p.symbol,
      qty: p.qty,
      broker: p.broker,
      loan_date: p.loanDate || null,
      loan_amount: p.loanAmount,
      rate: p.rate,
      repayment_date: p.repaymentDate || null,
    })
    .select()
    .single();
  fail('新增質押', error);
  return toPledge(data as Row);
}

export async function saveBank(bookId: string, b: BankAccount): Promise<void> {
  const { error } = await supabase
    .from('bank_accounts')
    .upsert(
      { book_id: bookId, bank: b.bank, usd: b.usd, twd: b.twd, loan: b.loan },
      { onConflict: 'book_id,bank' },
    );
  fail('儲存銀行餘額', error);
}

// Only the beta column is sent, so the pipeline-owned name/exchange columns stay untouched.
export async function saveBeta(symbol: string, beta: number): Promise<void> {
  const { error } = await supabase
    .from('symbols')
    .upsert({ symbol, beta }, { onConflict: 'symbol' });
  fail('儲存 beta', error);
}
