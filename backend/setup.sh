#!/bin/bash
# MedsMinder Backend — One-time setup script
# Run this once before starting development.
#
# Usage:
#   cd backend
#   chmod +x setup.sh && ./setup.sh

set -e

echo "=== MedsMinder Backend Setup ==="
echo ""

# Check Python version
python3 --version || { echo "❌ Python 3.8+ required"; exit 1; }

# Create virtual environment
echo "→ Creating virtual environment..."
python3 -m venv venv

# Activate
source venv/bin/activate

# Install dependencies
echo "→ Installing dependencies..."
pip install -r requirements.txt --quiet

echo ""
echo "✅ Setup complete!"
echo ""
echo "Next steps:"
echo "  1. Fill in your API keys in backend/.env"
echo "  2. Run ingestion (one time):  source venv/bin/activate && python ingest.py"
echo "  3. Start the server:          source venv/bin/activate && python main.py"
echo ""
echo "The server runs at http://localhost:8000"
echo "Check health at: http://localhost:8000/health"
