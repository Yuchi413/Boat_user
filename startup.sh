#!/bin/bash


# 激活虛擬環境
echo "激活虛擬環境..."
source env/bin/activate

# 運行 app.py
echo "運行 app.py..."
python app_key.py

# 停止腳本
echo "腳本運行完畢。"
