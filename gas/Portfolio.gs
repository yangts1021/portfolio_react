/**
 * 持倉計算（支援股票分割）
 *
 * 取代舊的 CALCULATE_PORTFOLIO_FULL：舊版把分割前後的股數直接相加，
 * 例如 00685L 在 2026-07-07 一拆 24，分割前買的 18,000 股實際上已變成
 * 432,000 股，舊版卻仍當成 18,000 股，導致庫存與市值嚴重低估。
 *
 * 這裡的邏輯與網頁 utils/calculations.ts 的 calculatePortfolio() 一致：
 * 交易與分割事件依時間排序處理，同一天分割先套用（生效日當天的交易
 * 視為分割後單位）；分割時庫存乘上比例、均價除以比例，成本總額不變，
 * 原始交易紀錄完全不動。
 *
 * 用法（放在「持倉現況」A2）：
 *   =CALCULATE_PORTFOLIO_V2('股票交易紀錄'!$A$2:$G, '即時價格與beta'!$A$2:$C,
 *                           '即時報價'!$A$2:$C, '分割事件'!$A$2:$C,
 *                           XLOOKUP("匯率_USDTWD", admin_Dashboard!A:A, admin_Dashboard!B:B))
 *
 * @param {range} txRange       股票交易紀錄 A:G（日期,券商,代碼,動作,股數,單價,幣別）
 * @param {range} priceBetaRange 即時價格與beta A:C（代碼,價格,beta）
 * @param {range} quoteRange    即時報價 A:C（代號,名稱,價格）；沒有這張表就傳空字串
 * @param {range} splitRange    分割事件 A:C（標的,生效日,比例）；沒有就傳空字串
 * @param {number} usdtwd       美元兌台幣匯率
 * @return 持倉表（含標題列）
 * @customfunction
 */
function CALCULATE_PORTFOLIO_V2(txRange, priceBetaRange, quoteRange, splitRange, usdtwd) {
  var rate = Number(usdtwd) || 1;

  // --- 價格與 beta ---
  var betas = {};
  var prices = {};
  toRows(priceBetaRange).forEach(function (row) {
    var symbol = normSymbol(row[0]);
    if (!symbol) return;
    var price = toNumber(row[1]);
    if (price > 0) prices[symbol] = price;
    var beta = toNumber(row[2]);
    if (row[2] !== '' && row[2] !== null && !isNaN(beta)) betas[symbol] = beta;
  });

  // 「即時報價」由本機 pipeline 寫入，比 GOOGLEFINANCE 新，優先採用
  toRows(quoteRange).forEach(function (row) {
    var symbol = normSymbol(row[0]);
    var price = toNumber(row[2]);
    if (symbol && price > 0) prices[symbol] = price;
  });

  // --- 事件：交易 + 分割，依時間排序，同日分割先行 ---
  var events = [];
  toRows(txRange).forEach(function (row) {
    var symbol = normSymbol(row[2]);
    var time = toTime(row[0]);
    if (!symbol || time === null) return;
    var action = String(row[3]).trim().toUpperCase();
    events.push({
      time: time,
      kind: 1, // 分割排在交易之前
      symbol: symbol,
      isSell: action === '賣' || action === 'SELL' || action === 'S',
      qty: toNumber(row[4]),
      price: toNumber(row[5]),
      currency: String(row[6] || 'TWD').trim().toUpperCase() || 'TWD',
    });
  });
  toRows(splitRange).forEach(function (row) {
    var symbol = normSymbol(row[0]);
    var time = toTime(row[1]);
    var ratio = toNumber(row[2]);
    if (!symbol || time === null || !(ratio > 0)) return;
    events.push({ time: time, kind: 0, symbol: symbol, ratio: ratio });
  });
  events.sort(function (a, b) {
    return a.time - b.time || a.kind - b.kind;
  });

  // --- 依序結算 ---
  var book = {};
  var order = [];
  events.forEach(function (ev) {
    if (ev.kind === 0) {
      var target = book[ev.symbol];
      if (target && target.qty > 0.000001) {
        target.qty *= ev.ratio;
        target.avg = target.cost / target.qty;
      }
      return;
    }

    if (!book[ev.symbol]) {
      book[ev.symbol] = { qty: 0, cost: 0, avg: 0, currency: ev.currency };
      order.push(ev.symbol);
    }
    var pos = book[ev.symbol];
    pos.currency = ev.currency || pos.currency;
    var amount = ev.qty * ev.price;
    if (ev.isSell) {
      var basis = pos.avg * ev.qty;
      pos.qty -= ev.qty;
      pos.cost -= basis;
      if (pos.qty <= 0.000001) {
        pos.qty = 0;
        pos.cost = 0;
        pos.avg = 0;
      }
    } else {
      pos.qty += ev.qty;
      pos.cost += amount;
      pos.avg = pos.qty > 0 ? pos.cost / pos.qty : 0;
    }
  });

  // --- 輸出 ---
  var held = order.filter(function (symbol) {
    return book[symbol].qty > 0.000001;
  });

  var totalTwd = 0;
  held.forEach(function (symbol) {
    var pos = book[symbol];
    var price = prices[symbol] || pos.avg;
    var fx = pos.currency === 'USD' ? rate : 1;
    totalTwd += pos.qty * price * fx;
  });

  var out = [[
    '代碼', '庫存', '即時價格', '幣別', '倉位市值 (原幣)', '平均成本 (原幣)',
    '未實現損益 (TWD)', '報酬率 %', '占比 (TWD)', '投入成本 (TWD)', '倉位市值 (TWD)', 'beta',
  ]];

  held.forEach(function (symbol) {
    var pos = book[symbol];
    var price = prices[symbol] || pos.avg;
    var fx = pos.currency === 'USD' ? rate : 1;
    var marketValue = pos.qty * price;
    var unrealizedTwd = (marketValue - pos.cost) * fx;
    out.push([
      symbol,
      pos.qty,
      price,
      pos.currency,
      marketValue,
      pos.avg,
      unrealizedTwd,
      pos.cost > 0 ? (marketValue - pos.cost) / pos.cost : 0,
      totalTwd > 0 ? (marketValue * fx) / totalTwd : 0,
      pos.cost * fx,
      marketValue * fx,
      betas[symbol] === undefined ? 1 : betas[symbol],
    ]);
  });

  return out;
}

// --- 小工具 ---

function toRows(range) {
  if (!range || !range.length) return [];
  return range.map(function (row) {
    return Array.isArray(row) ? row : [row];
  });
}

function normSymbol(value) {
  return String(value === null || value === undefined ? '' : value).trim().toUpperCase();
}

function toNumber(value) {
  if (value === '' || value === null || value === undefined) return 0;
  var num = Number(String(value).replace(/,/g, '').replace(/%/g, ''));
  return isNaN(num) ? 0 : num;
}

// 日期欄可能是 Date 物件或 2025/03/11、2025-03-11 字串
function toTime(value) {
  if (value instanceof Date) return value.getTime();
  var text = String(value === null || value === undefined ? '' : value).trim();
  if (!text) return null;
  var parsed = new Date(text.replace(/\//g, '-'));
  return isNaN(parsed.getTime()) ? null : parsed.getTime();
}
