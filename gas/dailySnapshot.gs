function recordDailyAssetHistory() {
  // --- 設定區域 Start ---
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sourceSheetName = "admin_dashboard";
  const historySheetName = "資產歷史紀錄";
  const MAX_RETRIES = 3;
  const RETRY_DELAY_MS = 30000; // 30 秒

  const keys = {
    totalAssets: "總資產",
    totalLiabilities: "總負債",
    totalCost: "總投入成本",
    protoAmount: "原型金額",
    levAmount: "槓桿金額",
    cashAmount: "類現金金額",
    protoPct: "原型佔比 %",
    levPct: "槓桿佔比 %",
    cashPct: "類現金佔比 %",
    beta: "Beta 值"
  };
  // --- 設定區域 End ---

  const sourceSheet = ss.getSheetByName(sourceSheetName);
  const historySheet = ss.getSheetByName(historySheetName);

  if (!sourceSheet || !historySheet) {
    Logger.log("錯誤：找不到指定的分頁。");
    return;
  }

  let dataMap = {};
  let totalAssets = 0;

  // 重試機制：確保資料已載入
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    SpreadsheetApp.flush(); // 強制重新計算

    const lastRow = sourceSheet.getLastRow();
    const data = sourceSheet.getRange(1, 1, lastRow, 2).getValues();

    dataMap = {};
    data.forEach(row => {
      let label = row[0].toString().trim();
      let value = row[1];
      dataMap[label] = value;
    });

    totalAssets = dataMap[keys.totalAssets] || 0;

    if (totalAssets > 0) {
      Logger.log(`第 ${attempt} 次讀取成功，總資產：${totalAssets}`);
      break;
    }

    Logger.log(`第 ${attempt} 次讀取失敗，總資產為 0，${attempt < MAX_RETRIES ? '等待重試...' : '放棄'}`);
    if (attempt < MAX_RETRIES) {
      Utilities.sleep(RETRY_DELAY_MS);
    }
  }

  // 資料無效則不寫入
  if (totalAssets <= 0) {
    Logger.log("錯誤：重試後總資產仍為 0，跳過本次紀錄");
    return;
  }

  const getVal = (label) => (dataMap[label] !== undefined) ? dataMap[label] : 0;

  const totalLiabilities = getVal(keys.totalLiabilities);
  const netWorth = totalAssets - totalLiabilities;

  const today = new Date();
  const recordDate = new Date(today);
  recordDate.setDate(today.getDate() - 1);

  const newRow = [
    recordDate,
    netWorth,
    totalAssets,
    totalLiabilities,
    getVal(keys.totalCost),
    getVal(keys.protoAmount),
    getVal(keys.levAmount),
    getVal(keys.cashAmount),
    getVal(keys.protoPct),
    getVal(keys.levPct),
    getVal(keys.cashPct),
    getVal(keys.beta)
  ];

  historySheet.appendRow(newRow);
  Logger.log("已成功紀錄資產數據，紀錄日期為：" + recordDate.toISOString().slice(0, 10));
}
