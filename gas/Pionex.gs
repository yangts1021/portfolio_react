/**
 * Pionex API 串接模組
 * Script Properties 需設定：
 *   PIONEX_API_KEY_RICK, PIONEX_API_SECRET_RICK
 *   PIONEX_API_KEY_JENNIFER, PIONEX_API_SECRET_JENNIFER
 */

/**
 * 產生 HMAC-SHA256 簽名
 */
function getPionexSignature(method, path, timestamp, secret) {
  var stringToSign = method + path + '?timestamp=' + timestamp;
  var signature = Utilities.computeHmacSha256Signature(stringToSign, secret);
  return signature
    .map(function (b) {
      return ('0' + (b < 0 ? b + 256 : b).toString(16)).slice(-2);
    })
    .join('');
}

/**
 * 呼叫 GET /api/v1/account/balances，回傳餘額 > 0 的幣種
 * @param {string} apiKey - Pionex API Key
 * @param {string} secret - Pionex API Secret
 */
function fetchPionexBalances(apiKey, secret) {
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
 * 整合兩個帳戶的 balances + tickers，寫入「Pionex」工作表
 */
function syncPionexData() {
  var props = PropertiesService.getScriptProperties();
  var prices = fetchPionexTickers();

  var accounts = [
    {
      name: 'Rick',
      apiKey: props.getProperty('PIONEX_API_KEY_RICK'),
      secret: props.getProperty('PIONEX_API_SECRET_RICK'),
    },
    {
      name: 'Jennifer',
      apiKey: props.getProperty('PIONEX_API_KEY_JENNIFER'),
      secret: props.getProperty('PIONEX_API_SECRET_JENNIFER'),
    },
  ];

  var allResults = [];

  accounts.forEach(function (acc) {
    if (!acc.apiKey || !acc.secret) {
      Logger.log('跳過帳戶 ' + acc.name + '：API Key 未設定');
      return;
    }

    var balances = fetchPionexBalances(acc.apiKey, acc.secret);
    balances.forEach(function (b) {
      var coin = b.coin;
      var qty = parseFloat(b.free) + parseFloat(b.frozen);
      allResults.push({
        account: acc.name,
        coin: coin,
        qty: qty,
        avgCost: 0,
        currentPrice: prices[coin] || 0,
      });
    });
  });

  // 寫入 Pionex 工作表
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Pionex');
  if (!sheet) {
    sheet = ss.insertSheet('Pionex');
    sheet.getRange(1, 1, 1, 5).setValues([['account', 'coin', 'qty', 'avgCost', 'currentPrice']]);
  }

  // 清除舊資料（保留標題列）
  if (sheet.getLastRow() > 1) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, 5).clearContent();
  }

  // 寫入新資料
  if (allResults.length > 0) {
    var rows = allResults.map(function (item) {
      return [item.account, item.coin, item.qty, item.avgCost, item.currentPrice];
    });
    sheet.getRange(2, 1, rows.length, 5).setValues(rows);
  }

  return allResults;
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

  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 5).getValues();
  var list = [];
  for (var i = 0; i < data.length; i++) {
    var row = data[i];
    if (row[1] === '') continue;
    list.push({
      account: row[0],
      coin: row[1],
      qty: row[2],
      avgCost: row[3],
      currentPrice: row[4],
    });
  }
  return list;
}
