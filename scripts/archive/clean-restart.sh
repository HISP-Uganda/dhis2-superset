#!/bin/bash
# Comprehensive Superset Restart with Cache Management
# Clears both frontend and backend caches, then restarts all services

set -e

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Configuration
PROJECT_DIR="/Users/edwinarinda/Projects/Redux/superset"
FRONTEND_DIR="$PROJECT_DIR/superset-frontend"
VENV_DIR="$PROJECT_DIR/.venv"
CONFIG_PATH="$PROJECT_DIR/superset_config.py"
LOG_FILE="$PROJECT_DIR/superset_backend.log"
PID_FILE="$PROJECT_DIR/superset.pid"
CACHE_DIR="$PROJECT_DIR/superset_home/cache"

print_info() {
    echo -e "${BLUE}ℹ${NC}  $1"
}

print_success() {
    echo -e "${GREEN}✅${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}⚠️${NC}  $1"
}

print_error() {
    echo -e "${RED}❌${NC} $1"
}

print_header() {
    echo ""
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BLUE}$1${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
}

# Check if process is running
is_running() {
    if [ -f "$PID_FILE" ]; then
        PID=$(cat "$PID_FILE")
        if ps -p "$PID" > /dev/null 2>&1; then
            return 0
        fi
    fi
    if lsof -ti:8088 > /dev/null 2>&1; then
        return 0
    fi
    return 1
}

# Stop all dev servers and processes
stop_all() {
    print_header "🛑 Stopping Services"

    # Kill backend Superset
    if is_running; then
        print_info "Stopping Superset backend..."
        if [ -f "$PID_FILE" ]; then
            PID=$(cat "$PID_FILE")
            kill -TERM "$PID" 2>/dev/null || true
            sleep 1
            if ps -p "$PID" > /dev/null 2>&1; then
                kill -9 "$PID" 2>/dev/null || true
            fi
            rm -f "$PID_FILE"
        fi
        lsof -ti:8088 | xargs kill -9 2>/dev/null || true
    fi

    # Kill frontend dev server
    print_info "Stopping frontend dev server..."
    pkill -f "webpack-dev-server\|npm.*dev\|node.*webpack" 2>/dev/null || true
    lsof -ti:9000 | xargs kill -9 2>/dev/null || true

    sleep 2
    print_success "All services stopped"
}

# Clear backend caches
clear_backend_cache() {
    print_header "🧹 Clearing Backend Cache"

    # Superset cache
    if [ -d "$CACHE_DIR" ]; then
        print_info "Clearing Superset cache: $CACHE_DIR"
        rm -rf "$CACHE_DIR"/* 2>/dev/null || true
        print_success "Superset cache cleared"
    fi

    # Python bytecode
    print_info "Clearing Python cache..."
    find "$PROJECT_DIR" -type d -name "__pycache__" -not -path "*/node_modules/*" -not -path "*/.venv/*" -exec rm -rf {} + 2>/dev/null || true
    find "$PROJECT_DIR" -type f -name "*.pyc" -not -path "*/node_modules/*" -not -path "*/.venv/*" -delete 2>/dev/null || true
    print_success "Python cache cleared"

    # Flask cache
    print_info "Clearing Flask cache..."
    rm -rf "$PROJECT_DIR/superset/instance/__pycache__" 2>/dev/null || true
}

# Clear frontend caches
clear_frontend_cache() {
    print_header "🧹 Clearing Frontend Cache"

    if [ ! -d "$FRONTEND_DIR" ]; then
        print_warning "Frontend directory not found"
        return 1
    fi

    cd "$FRONTEND_DIR"

    # Webpack/build cache
    print_info "Clearing webpack cache..."
    rm -rf dist build .webpack .next .eslintcache 2>/dev/null || true
    print_success "Webpack cache cleared"

    # Node modules cache
    print_info "Clearing npm cache..."
    rm -rf node_modules/.cache node_modules/.webpack 2>/dev/null || true
    npm cache clean --force 2>/dev/null || true
    print_success "NPM cache cleared"

    # Browser cache hint
    print_warning "Browser cache: You must hard-refresh in browser (Cmd+Shift+R or Ctrl+Shift+R)"
}

# Start backend
start_backend() {
    print_header "🚀 Starting Backend (Superset)"

    cd "$PROJECT_DIR"
    source "$VENV_DIR/bin/activate"
    export SUPERSET_CONFIG_PATH="$CONFIG_PATH"
    export FLASK_APP=superset

    print_info "Configuration: $SUPERSET_CONFIG_PATH"
    print_info "Starting on http://localhost:8088"

    nohup superset run -p 8088 --with-threads --reload --debugger > "$LOG_FILE" 2>&1 &
    SUPERSET_PID=$!
    echo "$SUPERSET_PID" > "$PID_FILE"

    print_info "Waiting for backend to start..."
    for i in {1..30}; do
        sleep 1
        if curl -s http://localhost:8088/health > /dev/null 2>&1; then
            print_success "Backend started - PID: $SUPERSET_PID"
            print_info "Backend URL: http://localhost:8088"
            return 0
        fi
        echo -n "."
    done

    echo ""
    print_error "Backend failed to start"
    print_info "Check logs: tail -50 $LOG_FILE"
    exit 1
}

# Start frontend
start_frontend() {
    print_header "🚀 Starting Frontend Dev Server"

    cd "$FRONTEND_DIR"

    print_info "Installing dependencies (if needed)..."
    if [ ! -d "node_modules" ]; then
        npm install
    fi

    print_info "Starting dev server on http://localhost:9000"
    print_info "Frontend logs will display below..."
    echo ""

    npm run dev
}

# Main execution
main() {
    print_header "🔄 COMPREHENSIVE SUPERSET RESTART WITH CACHE CLEANUP"

    # Stop everything
    stop_all

    # Clear caches
    clear_backend_cache
    clear_frontend_cache

    print_header "✨ Starting Fresh Services"

    # Start backend in background
    start_backend &
    BACKEND_PID=$!

    sleep 3

    # Start frontend (foreground - will see logs)
    start_frontend

    # If frontend exits, stop backend too
    kill $BACKEND_PID 2>/dev/null || true
}

# Show usage
show_usage() {
    cat << EOF
Superset Clean Restart Script

Usage: ./clean-restart.sh [command]

Commands:
    (no args)   Full clean restart (recommended)
    stop        Stop all services
    cache       Clear all caches (no restart)
    backend     Start only backend
    frontend    Start only frontend
    status      Show status of services
    help        Show this help message

Examples:
    ./clean-restart.sh                 # Full restart with cache cleanup
    ./clean-restart.sh stop             # Stop all services
    ./clean-restart.sh cache            # Clear all caches
    ./clean-restart.sh backend          # Start backend only
    ./clean-restart.sh frontend         # Start frontend only

Notes:
    - Full restart clears both frontend and backend caches
    - Always hard-refresh browser (Cmd+Shift+R or Ctrl+Shift+R) after restart
    - Backend runs on http://localhost:8088
    - Frontend dev server runs on http://localhost:9000

EOF
}

# Parse command
case "${1:-restart}" in
    "")
        main
        ;;
    restart)
        main
        ;;
    stop)
        stop_all
        ;;
    cache|clear-cache)
        stop_all
        clear_backend_cache
        clear_frontend_cache
        print_success "All caches cleared"
        ;;
    backend)
        start_backend
        ;;
    frontend)
        start_frontend
        ;;
    status)
        print_header "📊 Service Status"
        if is_running; then
            print_success "Backend: Running (port 8088)"
        else
            print_warning "Backend: Not running"
        fi
        if lsof -ti:9000 > /dev/null 2>&1; then
            print_success "Frontend: Running (port 9000)"
        else
            print_warning "Frontend: Not running"
        fi
        ;;
    help|--help|-h)
        show_usage
        ;;
    *)
        print_error "Unknown command: $1"
        echo ""
        show_usage
        exit 1
        ;;
esac
