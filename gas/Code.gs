// 處理讀取 (GET)
function doGet(e) {
  var result = {};
  var type = e.parameter.type; // 判斷要讀取哪種資料
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  try {
    // 1. 讀取交易紀錄
    if (!type || type === 'transactions') {
      var sheet = ss.getSheetByName('股票交易紀錄');
      if (sheet) {
        var data = sheet.getDataRange().getValues();
        var list = [];
        // 假設第一列是標題，從第二列開始
        for (var i = 1; i < data.length; i++) {
          var row = data[i];
          if (row[0] === '' && row[2] === '') continue;
          list.push({
            date: row[0],
            broker: row[1],
            symbol: row[2],
            action: row[3],
            qty: row[4],
            price: row[5],
            currency: row[6],
          });
        }
        result.transactions = list;
      }
    }

    // 2. 讀取即時價格與Beta
    if (!type || type === 'marketData') {
      var sheet = ss.getSheetByName('即時價格與beta');
      if (sheet) {
        var data = sheet.getDataRange().getValues();
        var list = [];
        for (var i = 1; i < data.length; i++) {
          var row = data[i];
          if (row[0] === '') continue;
          list.push({ symbol: row[0], price: row[1], beta: row[2] });
        }
        result.marketData = list;
      }
    }

    // 3. 讀取銀行資料
    if (!type || type === 'bankData') {
      var sheet = ss.getSheetByName('銀行系統餘額');
      if (sheet) {
        var data = sheet.getDataRange().getValues();
        var list = [];
        for (var i = 1; i < data.length; i++) {
          var row = data[i];
          if (row[0] === '') continue;
          var toNum = function (v) {
            return Number(String(v).replace(/,/g, '')) || 0;
          };
          list.push({ bank: row[0], usd: toNum(row[1]), twd: toNum(row[2]), loan: toNum(row[3]) });
        }
        result.bankData = list;
      }
    }

    // 4. 讀取 Admin_Dashboard (匯率)
    if (!type || type === 'dashboard') {
      var sheet = ss.getSheetByName('Admin_Dashboard');
      if (sheet) {
        var data = sheet.getRange('A:B').getValues();
        var dash = {};
        for (var i = 0; i < data.length; i++) {
          if (data[i][0]) dash[String(data[i][0]).trim()] = data[i][1];
        }
        result.dashboard = dash;
      }
    }

    // 5. 讀取質押借貸資料
    if (!type || type === 'pledgeData') {
      var sheet = ss.getSheetByName('質押借貸資料');
      if (sheet) {
        var data = sheet.getDataRange().getValues();
        var list = [];
        // 欄位順序: 匯撥日期(0), 匯撥標的(1), 匯撥股數(2), 匯入券商(3), 擔保價值(4), 借款日期(5), 借款金額(6), 質借利率(7), 還款日期(8), 利息(9)
        for (var i = 1; i < data.length; i++) {
          var row = data[i];
          if (row[0] === '' && row[1] === '') continue;
          list.push({
            transferDate: row[0],
            symbol: row[1],
            qty: row[2],
            broker: row[3],
            collateralValue: row[4],
            loanDate: row[5],
            loanAmount: row[6],
            rate: row[7],
            repaymentDate: row[8],
            interest: row[9],
          });
        }
        result.pledgeData = list;
      } else {
        result.pledgeData = [];
      }
    }

    // 6. 讀取 Pionex 資料
    if (!type || type === 'pionexData') {
      result.pionexData = readPionexFromSheet();
    }

    // 7. 讀取 Bitfinex 資料
    if (!type || type === 'bitfinexData') {
      result.bitfinexData = readBitfinexFromSheet();
    }

    // 8. 讀取分割事件
    if (!type || type === 'splitEvents') {
      var sheet = ss.getSheetByName('分割事件');
      if (sheet) {
        var data = sheet.getDataRange().getValues();
        var list = [];
        for (var i = 1; i < data.length; i++) {
          var row = data[i];
          if (row[0] === '') continue;
          list.push({ symbol: row[0], date: row[1], ratio: row[2] });
        }
        result.splitEvents = list;
      } else {
        result.splitEvents = [];
      }
    }

    // 9. 淨值歷史（本機 pipeline/build_history.py 由每日收盤重算後寫入）
    //    資料量大，只在明確指定 type=history 時回傳，不進預設同步
    if (type === 'history') {
      var sheet = ss.getSheetByName('淨值歷史');
      var list = [];
      if (sheet) {
        var data = sheet.getDataRange().getValues();
        for (var i = 1; i < data.length; i++) {
          var row = data[i];
          if (!row[0]) continue;
          // 日期可能被 Sheets 解析成 Date，統一輸出台北時區的 YYYY-MM-DD
          var day =
            row[0] instanceof Date
              ? Utilities.formatDate(row[0], 'Asia/Taipei', 'yyyy-MM-dd')
              : String(row[0]).slice(0, 10);
          list.push({
            date: day,
            marketValue: Number(row[1]) || 0,
            cost: Number(row[2]) || 0,
            unrealized: Number(row[3]) || 0,
            realized: Number(row[4]) || 0,
            roi: Number(row[5]) || 0,
          });
        }
      }
      result.history = list;
    }

    // 10. 即時價格：優先讀本機 pipeline 寫入的「即時報價」，其次 MIS，最後 GOOGLEFINANCE
    if (type === 'twPrices') {
      var symbolsCsv = String(e.parameter.symbols || '');
      var live = readLivePricesFromSheet(ss, symbolsCsv);
      if (Object.keys(live.prices).length > 0) {
        result.twPrices = live.prices;
        result.twSource = 'live';
        result.twMeta = live.meta; // 每檔的來源與報價時間
        result.twUpdatedAt = live.updatedAt;
      } else {
        var misResult = fetchTwPricesFromMis(symbolsCsv);
        result.twPrices = misResult.prices;
        result.twSource = 'mis';
        // MIS 從 Google 機房打不通時，退回讀 Sheet 的 GOOGLEFINANCE 價格（約 15 分鐘延遲）
        if (Object.keys(misResult.prices).length === 0) {
          result.twPrices = readTwPricesFromSheet(ss, symbolsCsv);
          result.twSource = 'sheet';
        }
        if (e.parameter.debug) {
          result.twDebug = misResult.debug;
        }
      }
    }

    return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(
      ContentService.MimeType.JSON,
    );
  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({ error: error.toString() })).setMimeType(
      ContentService.MimeType.JSON,
    );
  }
}

// 呼叫 TWSE MIS 即時行情 API，回傳 { prices: { symbol: price }, debug: {...} }
// 上市/上櫃無法事先區分，同一代碼同時查 tse_ 與 otc_ 頻道，無效的會被 API 忽略
function fetchTwPricesFromMis(symbolsCsv) {
  var symbols = symbolsCsv
    .split(',')
    .map(function (s) {
      // MIS API 對代碼大小寫敏感（如 00631L 必須大寫）
      return s.trim().toUpperCase();
    })
    .filter(String);
  if (symbols.length === 0) return { prices: {}, debug: { reason: 'no symbols' } };

  var channels = [];
  symbols.forEach(function (s) {
    channels.push('tse_' + s + '.tw');
    channels.push('otc_' + s + '.tw');
  });

  var url =
    'https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=' +
    encodeURIComponent(channels.join('|')) +
    '&json=1&delay=0';

  var res;
  try {
    res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  } catch (err) {
    return { prices: {}, debug: { reason: 'fetch threw', error: String(err) } };
  }
  var code = res.getResponseCode();
  var body = res.getContentText();
  if (code !== 200) {
    return { prices: {}, debug: { reason: 'non-200', code: code, body: body.slice(0, 300) } };
  }

  var json;
  try {
    json = JSON.parse(body);
  } catch (err) {
    return { prices: {}, debug: { reason: 'bad json', body: body.slice(0, 300) } };
  }
  var prices = {};
  (json.msgArray || []).forEach(function (m) {
    var sym = String(m.c || '').toUpperCase();
    if (!sym) return;
    // z: 最近成交價；盤中無成交時退回 pz(前一筆成交)、y(昨收)
    var price = parseFloat(m.z);
    if (!price || isNaN(price)) price = parseFloat(m.pz);
    if (!price || isNaN(price)) price = parseFloat(m.y);
    if (price && !isNaN(price)) prices[sym] = price;
  });
  return {
    prices: prices,
    debug: { reason: 'ok', rtmessage: json.rtmessage, count: (json.msgArray || []).length },
  };
}

// 從 Sheet「即時報價」讀取價格。這張表由本機 pipeline/fetch_prices.py 定期寫入
// （台股走富邦、美股走 yfinance），欄位：代號 名稱 價格 昨收 幣別 來源 報價時間 更新時間
function readLivePricesFromSheet(ss, symbolsCsv) {
  var sheet = ss.getSheetByName('即時報價');
  if (!sheet) return { prices: {}, updatedAt: '' };

  var wanted = {};
  var hasFilter = false;
  String(symbolsCsv)
    .split(',')
    .forEach(function (s) {
      s = s.trim().toUpperCase();
      if (s) {
        wanted[s] = true;
        hasFilter = true;
      }
    });

  var rows = sheet.getDataRange().getValues();
  var prices = {};
  var meta = {};
  var updatedAt = '';
  for (var i = 1; i < rows.length; i++) {
    var sym = String(rows[i][0]).trim().toUpperCase();
    if (!sym) continue;
    if (hasFilter && !wanted[sym]) continue;
    var price = parseFloat(rows[i][2]);
    if (!price || isNaN(price)) continue;
    prices[sym] = price;
    meta[sym] = { source: String(rows[i][5] || ''), quoteTs: String(rows[i][6] || '') };
    var updated = String(rows[i][7] || '');
    if (updated > updatedAt) updatedAt = updated;
  }
  return { prices: prices, meta: meta, updatedAt: updatedAt };
}

// 從 Sheet「即時價格與beta」讀取指定代碼的價格（GOOGLEFINANCE，約 15 分鐘延遲）
function readTwPricesFromSheet(ss, symbolsCsv) {
  var sheet = ss.getSheetByName('即時價格與beta');
  if (!sheet) return {};
  var wanted = {};
  symbolsCsv.split(',').forEach(function (s) {
    s = s.trim().toUpperCase();
    if (s) wanted[s] = true;
  });
  var rows = sheet.getDataRange().getValues();
  var prices = {};
  for (var i = 1; i < rows.length; i++) {
    var sym = String(rows[i][0]).trim().toUpperCase();
    var price = parseFloat(rows[i][1]);
    if (wanted[sym] && price && !isNaN(price)) prices[sym] = price;
  }
  return prices;
}

// 處理寫入 (POST)
function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.tryLock(10000);

  try {
    var data = JSON.parse(e.postData.contents);
    var ss = SpreadsheetApp.getActiveSpreadsheet();

    // === 更新銀行餘額 ===
    if (data.type === 'updateBank') {
      var sheet = ss.getSheetByName('銀行系統餘額');
      if (!sheet) return ContentService.createTextOutput("Error: Sheet '銀行系統餘額' not found.");

      var rows = sheet.getDataRange().getValues();
      var rowIndex = -1;

      for (var i = 1; i < rows.length; i++) {
        if (rows[i][0] == data.bank) {
          rowIndex = i + 1;
          break;
        }
      }

      if (rowIndex === -1) {
        sheet.appendRow([data.bank, data.usd, data.twd, data.loan]);
      } else {
        sheet.getRange(rowIndex, 2, 1, 3).setValues([[data.usd, data.twd, data.loan]]);
      }
      return ContentService.createTextOutput('Success: Bank Updated');
    }

    // === 更新標的 beta ===
    else if (data.type === 'updateBeta') {
      var sheet = ss.getSheetByName('即時價格與beta');
      if (!sheet)
        return ContentService.createTextOutput("Error: Sheet '即時價格與beta' not found.");

      var rows = sheet.getDataRange().getValues();
      var target = String(data.symbol).trim().toUpperCase();
      var rowIndex = -1;
      for (var i = 1; i < rows.length; i++) {
        if (String(rows[i][0]).trim().toUpperCase() === target) {
          rowIndex = i + 1;
          break;
        }
      }

      if (rowIndex === -1) {
        // 新標的：補一列（B 欄價格留空）
        var lastRow = sheet.getRange('A1:A').getValues().filter(String).length;
        sheet.getRange(lastRow + 1, 1, 1, 3).setValues([["'" + data.symbol, '', data.beta]]);
      } else {
        sheet.getRange(rowIndex, 3).setValue(data.beta);
      }
      return ContentService.createTextOutput('Success: Beta Updated');
    }

    // === 新增分割事件 ===
    else if (data.type === 'addSplit') {
      var sheet = ss.getSheetByName('分割事件');
      if (!sheet) {
        // 工作表不存在就自動建立
        sheet = ss.insertSheet('分割事件');
        sheet.getRange(1, 1, 1, 3).setValues([['標的', '生效日', '比例']]);
      }

      var symbolStr = String(data.symbol);
      if (!symbolStr.startsWith("'")) {
        symbolStr = "'" + symbolStr;
      }

      var lastRow = sheet.getRange('A1:A').getValues().filter(String).length;
      sheet.getRange(lastRow + 1, 1, 1, 3).setValues([[symbolStr, data.date, data.ratio]]);
      return ContentService.createTextOutput('Success: Split Added');
    }

    // === 新增質押紀錄 ===
    else if (data.type === 'addPledge') {
      var sheet = ss.getSheetByName('質押借貸資料');
      if (!sheet) return ContentService.createTextOutput("Error: Sheet '質押借貸資料' not found.");

      // 處理代碼格式：強制加上單引號
      var symbolStr = String(data.symbol);
      if (!symbolStr.startsWith("'")) {
        symbolStr = "'" + symbolStr;
      }

      // 找出下一列：計算 A 欄 (匯撥日期) 有值的列數 + 1
      var lastRow = sheet.getRange('A1:A').getValues().filter(String).length;
      var nextRow = lastRow + 1;

      // 使用 setValues 精確寫入 A~I 欄（E 欄留空給公式計算）
      sheet.getRange(nextRow, 1, 1, 9).setValues([
        [
          data.transferDate, // A: 匯撥日期
          symbolStr, // B: 標的
          data.qty, // C: 股數
          data.broker, // D: 券商
          '', // E: 擔保價值 (留空)
          data.loanDate, // F: 借款日期
          data.loanAmount, // G: 借款金額
          data.rate, // H: 利率
          data.repaymentDate, // I: 還款日期
        ],
      ]);

      return ContentService.createTextOutput('Success: Pledge Added');
    }

    // === 新增交易紀錄 ===
    else {
      var sheet = ss.getSheetByName('股票交易紀錄');
      if (!sheet) return ContentService.createTextOutput("Error: Sheet '股票交易紀錄' not found.");

      // 處理代碼格式
      var symbolStr = String(data.symbol);
      if (!symbolStr.startsWith("'")) {
        symbolStr = "'" + symbolStr;
      }

      // 找出下一列：計算 A 欄 (日期) 有值的列數 + 1
      var lastRow = sheet.getRange('A1:A').getValues().filter(String).length;
      var nextRow = lastRow + 1;

      // 使用 setValues 精確寫入 A~G 欄
      sheet
        .getRange(nextRow, 1, 1, 7)
        .setValues([
          [data.date, data.broker, symbolStr, data.action, data.qty, data.price, data.currency],
        ]);

      return ContentService.createTextOutput('Success: Transaction Added');
    }
  } catch (error) {
    return ContentService.createTextOutput('Error: ' + error.toString());
  } finally {
    lock.releaseLock();
  }
}