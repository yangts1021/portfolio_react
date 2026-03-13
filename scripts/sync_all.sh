#!/bin/bash
# 每日自動同步永豐 + 富邦庫存與銀行餘額到 Google Sheet
LOG_DIR="$HOME/Documents/portfolio_react/log"
mkdir -p "$LOG_DIR"
LOG="$LOG_DIR/sync_$(date +%Y%m%d).log"

export PYTHONUNBUFFERED=1

echo "=== $(date) 開始同步 ===" >> "$LOG"

# 永豐同步
echo "[永豐] 開始..." >> "$LOG"
"$HOME/Documents/portfolio_react/sinopac/venv/bin/python" \
  "$HOME/Documents/portfolio_react/sinopac/sync_sinopac.py" >> "$LOG" 2>&1
echo "[永豐] 完成" >> "$LOG"

# 富邦同步
echo "[富邦] 開始..." >> "$LOG"
"$HOME/Documents/portfolio_react/fubon/venv/bin/python" \
  "$HOME/Documents/portfolio_react/fubon/sync_fubon.py" >> "$LOG" 2>&1
echo "[富邦] 完成" >> "$LOG"

echo "=== $(date) 同步結束 ===" >> "$LOG"
