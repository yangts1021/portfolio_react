/**
 * Bitfinex API v2 串接模組
 * Script Properties 需設定：
 *   BITFINEX_API_KEY, BITFINEX_API_SECRET
 */

/**
 * HMAC-SHA384 實作（GAS 原生只支援到 SHA256）
 * 利用 Utilities.computeDigest(SHA_384) 手動建構 HMAC
 * HMAC(K, m) = H((K' XOR opad) || H((K' XOR ipad) || m))
 * SHA-384 block size = 128 bytes
 */
function hmacSha384(message, secret) {
  var BLOCK_SIZE = 128;

  // 將 Java Byte[] 轉成一般 JS Array（避免 push/concat 問題）
  function toJsArray(javaBytes) {
    var arr = [];
    for (var i = 0; i < javaBytes.length; i++) arr.push(javaBytes[i]);
    return arr;
  }

  function sha384(byteArray) {
    return toJsArray(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_384, byteArray));
  }

  var keyBytes = toJsArray(Utilities.newBlob(secret).getBytes());

  if (keyBytes.length > BLOCK_SIZE) {
    keyBytes = sha384(keyBytes);
  }

  while (keyBytes.length < BLOCK_SIZE) keyBytes.push(0);

  var ipad = [];
  var opad = [];
  for (var i = 0; i < BLOCK_SIZE; i++) {
    ipad.push(keyBytes[i] ^ 0x36);
    opad.push(keyBytes[i] ^ 0x5c);
  }

  var msgBytes = toJsArray(Utilities.newBlob(message).getBytes());
  var innerHash = sha384(ipad.concat(msgBytes));
  var hmac = sha384(opad.concat(innerHash));

  return hmac
    .map(function (b) {
      return ('0' + (b < 0 ? b + 256 : b).toString(16)).slice(-2);
    })
    .join('');
}

/**
 * 呼叫 Bitfinex v2 authenticated POST endpoint
 * @param {string} apiPath - e.g. "/v2/auth/r/wallets"
 * @param {string} apiKey
 * @param {string} secret
 * @param {object} [bodyObj={}] - POST body
 * @returns {object} parsed JSON response
 */
function callBitfinexAuth(apiPath, apiKey, secret, bodyObj) {
  var nonce = (Date.now() * 1000).toString();
  var body = JSON.stringify(bodyObj || {});

  var payload = '/api' + apiPath + nonce + body;
  var signature = hmacSha384(payload, secret);

  var url = 'https://api.bitfinex.com' + apiPath;
  var response = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'bfx-nonce': nonce,
      'bfx-apikey': apiKey,
      'bfx-signature': signature,
    },
    payload: body,
    muteHttpExceptions: true,
  });

  var responseText = response.getContentText();
  Logger.log('Bitfinex ' + apiPath + ' 回應: ' + responseText.substring(0, 500));
  return JSON.parse(responseText);
}

/**
 * 取得帳戶錢包餘額（現貨 exchange + margin + funding）
 * 回傳餘額 > 0 的錢包
 * API 回傳格式: [[WALLET_TYPE, CURRENCY, BALANCE, UNSETTLED_INTEREST, AVAILABLE_BALANCE, ...], ...]
 */
function fetchBitfinexWallets(apiKey, secret) {
  if (!apiKey || !secret) {
    throw new Error('BITFINEX_API_KEY 或 BITFINEX_API_SECRET 未設定');
  }

  var data = callBitfinexAuth('/v2/auth/r/wallets', apiKey, secret);

  if (!Array.isArray(data)) {
    throw new Error('Bitfinex wallets API 錯誤: ' + JSON.stringify(data));
  }

  return data
    .filter(function (w) {
      return w[2] && Math.abs(parseFloat(w[2])) > 0;
    })
    .map(function (w) {
      return {
        walletType: w[0], // "exchange", "margin", "funding"
        currency: w[1].toUpperCase(),
        balance: parseFloat(w[2]),
        available: parseFloat(w[4] || w[2]),
      };
    });
}

/**
 * 取得 USDT 計價的即時價格（公開 API）
 * 回傳 { BTC: 45000, ETH: 2500, ... }
 */
function fetchBitfinexTickers(symbols) {
  if (!symbols || symbols.length === 0) {
    symbols = ['BTC', 'ETH', 'SOL', 'XRP', 'ADA', 'DOT', 'AVAX', 'LINK', 'UNI', 'MATIC'];
  }

  var tSymbols = symbols.map(function (s) {
    // Bitfinex 用 tXXXUST 表示 XXX/USDT（USDT 在 Bitfinex 代號是 UST）
    return 't' + s + 'UST';
  });

  var url = 'https://api-pub.bitfinex.com/v2/tickers?symbols=' + tSymbols.join(',');
  var response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  var data = JSON.parse(response.getContentText());

  if (!Array.isArray(data)) {
    throw new Error('Bitfinex tickers API 錯誤: ' + response.getContentText());
  }

  // 回傳格式: [[SYMBOL, BID, BID_SIZE, ASK, ASK_SIZE, DAILY_CHANGE, DAILY_CHANGE_RELATIVE, LAST_PRICE, VOLUME, HIGH, LOW], ...]
  var priceMap = {};
  data.forEach(function (t) {
    if (Array.isArray(t) && t[0]) {
      var symbol = t[0];
      // tBTCUST -> BTC
      var coin = symbol.replace(/^t/, '').replace(/UST$/, '');
      priceMap[coin] = parseFloat(t[7]); // LAST_PRICE
    }
  });
  priceMap['USDT'] = 1;
  priceMap['UST'] = 1;
  return priceMap;
}

/**
 * 整合帳戶的 wallets + tickers，寫入「Bitfinex」工作表
 */
function syncBitfinexData() {
  var props = PropertiesService.getScriptProperties();

  var apiKey = props.getProperty('BITFINEX_API_KEY');
  var secret = props.getProperty('BITFINEX_API_SECRET');
  if (!apiKey || !secret) {
    Logger.log('BITFINEX_API_KEY 或 BITFINEX_API_SECRET 未設定');
    return [];
  }

  var allResults = [];
  var allCoins = {};

  try {
    var wallets = fetchBitfinexWallets(apiKey, secret);
    wallets.forEach(function (w) {
      var coin = w.currency;
      if (coin !== 'UST' && coin !== 'USDT' && coin !== 'USD') {
        allCoins[coin] = true;
      }
      allResults.push({
        type: w.walletType,
        coin: coin,
        qty: w.balance,
        available: w.available,
      });
    });
  } catch (e) {
    Logger.log('Bitfinex 錢包取得失敗: ' + e.message);
  }

  // 查詢即時價格
  var coinList = Object.keys(allCoins);
  var prices = {};
  if (coinList.length > 0) {
    try {
      prices = fetchBitfinexTickers(coinList);
    } catch (e) {
      Logger.log('Bitfinex tickers 取得失敗: ' + e.message);
    }
  }
  prices['USDT'] = 1;
  prices['UST'] = 1;
  prices['USD'] = 1;

  allResults.forEach(function (item) {
    item.currentPrice = prices[item.coin] || 0;
  });

  // 寫入 Bitfinex 工作表
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Bitfinex');
  if (!sheet) {
    sheet = ss.insertSheet('Bitfinex');
  }

  sheet.getRange(1, 1, 1, 5).setValues([['type', 'coin', 'qty', 'available', 'currentPrice']]);

  if (sheet.getLastRow() > 1) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, 5).clearContent();
  }

  if (allResults.length > 0) {
    var rows = allResults.map(function (item) {
      return [item.type, item.coin, item.qty, item.available, item.currentPrice];
    });
    sheet.getRange(2, 1, rows.length, 5).setValues(rows);
  }

  return allResults;
}

/**
 * 從「Bitfinex」工作表讀取資料
 */
function readBitfinexFromSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Bitfinex');
  if (!sheet || sheet.getLastRow() <= 1) {
    return [];
  }

  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 5).getValues();
  var list = [];
  for (var i = 0; i < data.length; i++) {
    var row = data[i];
    if (row[1] === '') continue;
    list.push({
      type: row[0] || 'exchange',
      coin: row[1],
      qty: row[2],
      available: row[3],
      currentPrice: row[4],
    });
  }
  return list;
}
