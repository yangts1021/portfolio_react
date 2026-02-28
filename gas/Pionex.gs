/**
 * Pionex API 串接模組
 * API Key/Secret 需在 GAS 編輯器 > 專案設定 > 指令碼屬性中設定：
 *   PIONEX_API_KEY, PIONEX_API_SECRET
 */

/**
 * 產生 HMAC-SHA256 簽名
 */
function getPionexSignature(method, path, timestamp, secret) {
  var stringToSign = method + path + '?timestamp=' + timestamp;
  var signature = Utilities.computeHmacSha256Signature(stringToSign, secret);
  return signature
    .map(function (b) {
      return ('0' + ((b < 0 ? b + 256 : b).toString(16))).slice(-2);
    })
    .join('');
}

/**
 * 呼叫 GET /api/v1/account/balances，回傳餘額 > 0 的幣種
 */
function fetchPionexBalances() {
  var props = PropertiesService.getScriptProperties();
  var apiKey = props.getProperty('PIONEX_API_KEY');
  var secret = props.getProperty('PIONEX_API_SECRET');

  if (!apiKey || !secret) {
    throw new Error('PIONEX_API_KEY 或 PIONEX_API_SECRET 未設定');
  }

  var timestamp = Date.now().toString();
  var path = '/api/v1/account/balances';
  var signature = getPionexSignature('GET', path, timestamp, secret);

  var url = 'https://api.pionex.com' + path + '?timestamp=' + timestamp;
  var response = UrlFetchApp.fetch(url, {
    headers: {
      'PIONEX-KEY': apiKey,
      'PIONEX-SIGNATURE': signature,
    },
    muteHttpExceptions: true,
  });

  var json = JSON.parse(response.getContentText());
  if (!json.result || !json.data || !json.data.balances) {
    throw new Error('Pionex balances API 錯誤: ' + response.getContentText());
  }

  return json.data.balances.filter(function (b) {
    return parseFloat(b.free) + parseFloat(b.frozen) > 0;
  });
}

/**
 * 呼叫 GET /api/v1/market/tickers（公開 API），取 _USDT 交易對的 close 價
 * 回傳 { BTC: 45000, ETH: 2500, ... }
 */
function fetchPionexTickers() {
  var url = 'https://api.pionex.com/api/v1/market/tickers';
  var response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  var json = JSON.parse(response.getContentText());

  if (!json.data || !json.data.tickers) {
    throw new Error('Pionex tickers API 錯誤: ' + response.getContentText());
  }

  var priceMap = {};
  json.data.tickers.forEach(function (t) {
    if (t.symbol.endsWith('_USDT')) {
      var coin = t.symbol.replace('_USDT', '');
      priceMap[coin] = parseFloat(t.close);
    }
  });
  priceMap['USDT'] = 1;
  return priceMap;
}

/**
 * 整合 balances + tickers，寫入「Pionex」工作表
 */
function syncPionexData() {
  var balances = fetchPionexBalances();
  var prices = fetchPionexTickers();

  var result = balances.map(function (b) {
    var coin = b.coin;
    var qty = parseFloat(b.free) + parseFloat(b.frozen);
    return {
      coin: coin,
      qty: qty,
      avgCost: 0,
      currentPrice: prices[coin] || 0,
    };
  });

  // 寫入 Pionex 工作表
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Pionex');
  if (!sheet) {
    sheet = ss.insertSheet('Pionex');
    sheet.getRange(1, 1, 1, 4).setValues([['coin', 'qty', 'avgCost', 'currentPrice']]);
  }

  // 清除舊資料（保留標題列）
  if (sheet.getLastRow() > 1) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, 4).clearContent();
  }

  // 寫入新資料
  if (result.length > 0) {
    var rows = result.map(function (item) {
      return [item.coin, item.qty, item.avgCost, item.currentPrice];
    });
    sheet.getRange(2, 1, rows.length, 4).setValues(rows);
  }

  return result;
}

/**
 * 從「Pionex」工作表讀取資料
 */
function readPionexFromSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Pionex');
  if (!sheet || sheet.getLastRow() <= 1) {
    return [];
  }

  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 4).getValues();
  var list = [];
  for (var i = 0; i < data.length; i++) {
    var row = data[i];
    if (row[0] === '') continue;
    list.push({
      coin: row[0],
      qty: row[1],
      avgCost: row[2],
      currentPrice: row[3],
    });
  }
  return list;
}
