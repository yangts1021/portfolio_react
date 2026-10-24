#!/bin/bash
# 每日自動同步：永豐 + 富邦券商資料（Sheet）、銀行餘額與報價、淨值曲線（Supabase）
# 由 launchd com.portfolio.sync 觸發（每日 14:00）
PROJECT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PIPELINE="$PROJECT/pipeline"
PY="$PIPELINE/venv/bin/python"

LOG_DIR="$PROJECT/log"
mkdir -p "$LOG_DIR"
LOG="$LOG_DIR/sync_$(date +%Y%m%d).log"

export PYTHONUNBUFFERED=1
cd "$PIPELINE" || exit 1

echo "=== $(date) 開始同步 ===" >> "$LOG"

# 永豐同步（庫存 / 交易紀錄 / 銀行餘額）
echo "[永豐] 開始..." >> "$LOG"
"$PY" sync_sinopac.py >> "$LOG" 2>&1
echo "[永豐] 完成" >> "$LOG"

# 富邦同步（庫存 / 交易紀錄 / 持倉快照）
echo "[富邦] 開始..." >> "$LOG"
"$PY" sync_fubon.py >> "$LOG" 2>&1
echo "[富邦] 完成" >> "$LOG"

# 收盤後補一次報價，讓 Supabase quotes 停在當日收盤
echo "[報價] 開始..." >> "$LOG"
"$PY" fetch_prices.py >> "$LOG" 2>&1
echo "[報價] 完成" >> "$LOG"

# 補近一個月的日線（Mac 關機那幾天會缺），再重算淨值曲線
echo "[歷史] 開始..." >> "$LOG"
"$PY" backfill_history.py --start "$(date -v-30d +%Y-%m-%d)" >> "$LOG" 2>&1
"$PY" build_history.py >> "$LOG" 2>&1
echo "[歷史] 完成" >> "$LOG"

echo "=== $(date) 同步結束 ===" >> "$LOG"
