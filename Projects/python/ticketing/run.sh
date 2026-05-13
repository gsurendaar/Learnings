#!/bin/bash
# Start both Flask API and Streamlit UI for the Ticketing app
# Usage: ./run.sh
# Stop:  Press Ctrl+C

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

if [ -f ".venv/bin/activate" ]; then
    source .venv/bin/activate
else
    echo "ERROR: Virtual environment not found. Run: python3 -m venv .venv && pip install -r requirements.txt"
    exit 1
fi

cleanup() {
    echo ""
    echo "Shutting down..."
    kill $FLASK_PID 2>/dev/null
    kill $STREAMLIT_PID 2>/dev/null
    wait $FLASK_PID 2>/dev/null
    wait $STREAMLIT_PID 2>/dev/null
    echo "Done."
}
trap cleanup EXIT INT TERM

echo "Starting Flask API on port 5000..."
python api.py &
FLASK_PID=$!

sleep 2

echo "Starting Streamlit UI on port 8501..."
streamlit run ui.py --server.port 8501 --server.headless true &
STREAMLIT_PID=$!

echo ""
echo "Both servers running:"
echo "  Flask API:     http://localhost:5000"
echo "  Streamlit UI:  http://localhost:8501"
echo ""
echo "Press Ctrl+C to stop both."

wait
