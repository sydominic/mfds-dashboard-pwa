#!/usr/bin/env bash
set -e

echo "Starting MFDS Regulatory Dashboard on Render..."
echo "PORT=${PORT:-8501}"

streamlit run app.py \
  --server.address=0.0.0.0 \
  --server.port=${PORT:-8501} \
  --server.headless=true \
  --browser.gatherUsageStats=false
