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
          var toNum = function(v) { return Number(String(v).replace(/,/g, '')) || 0; };
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

    return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(
      ContentService.MimeType.JSON,
    );
  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({ error: error.toString() })).setMimeType(
      ContentService.MimeType.JSON,
    );
  }
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
