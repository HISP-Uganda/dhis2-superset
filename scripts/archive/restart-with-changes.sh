#!/bin/bash
# Quick restart script for Superset with Docker

echo "🛑 Stopping containers..."
docker compose down

echo "🔨 Rebuilding superset container..."
docker compose build superset

echo "🚀 Starting services..."
docker compose up -d

echo "⏳ Waiting for services to be ready..."
sleep 10

echo "✅ Testing guest token endpoint..."
curl -X POST http://localhost:8088/api/v1/security/public_guest_token/ \
  -H "Content-Type: application/json" \
  -d '{"dashboard_id": "52"}'

echo ""
echo ""
echo "📊 Services should be running!"
echo "Backend: http://localhost:8088"
echo "Frontend: http://localhost:9000"
echo ""
echo "To rebuild frontend: cd superset-frontend && npm run build"
