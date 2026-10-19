#!/data/data/com.termux/files/usr/bin/bash
# 1) Edit the two lines below.  2) Run:  bash start.sh
export SERVER_URL="https://pay.yourdomain.com"
export WATCHER_SECRET="PASTE_THE_WATCHER_SECRET_FROM_YOUR_SERVER_ENV"
export SENDER_MATCH="SBI"                       # words in the SMS sender name, comma separated (e.g. SBI,HDFC)
export NOTIFY_APPS="phonepe,paisa,paytm,npci,sbi"   # leave empty ("") to disable notification reading
cd "$(dirname "$0")"
termux-wake-lock
nohup node watcher.js >> watcher.log 2>&1 &
echo "Watcher started. See logs with:  tail -f watcher.log"
