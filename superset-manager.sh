#!/bin/bash
# Superset Management Script
# Provides commands to start, stop, restart, and manage Superset

set -e

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
PROJECT_DIR="/Users/edwinarinda/Projects/Redux/superset"
BACKEND_DIR="$PROJECT_DIR"
FRONTEND_DIR="$PROJECT_DIR/superset-frontend"
VENV_DIR="$PROJECT_DIR/venv"
CONFIG_PATH="$PROJECT_DIR/superset_config.py"
LOG_DIR="$PROJECT_DIR/logs"
LOG_FILE="$LOG_DIR/superset_backend.log"
FRONTEND_LOG_FILE="$LOG_DIR/superset_frontend.log"
PID_FILE="$PROJECT_DIR/superset.pid"
FRONTEND_PID_FILE="$PROJECT_DIR/superset_frontend.pid"
CACHE_DIR="$PROJECT_DIR/superset_home/cache"
FRONTEND_PORT=9000
BACKEND_PORT=8088
WEBPACK_DEV_PORT=8081
WEBPACK_DEV_PID_FILE="$PROJECT_DIR/webpack_dev.pid"
WEBPACK_DEV_LOG_FILE="$LOG_DIR/webpack_dev.log"

# Print colored message
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

# Check if backend (Superset) is running
is_running() {
    if [ -f "$PID_FILE" ]; then
        PID=$(cat "$PID_FILE")
        if ps -p "$PID" > /dev/null 2>&1; then
            return 0
        else
            rm -f "$PID_FILE"
            return 1
        fi
    fi

    # Fallback: check by port
    if lsof -ti:$BACKEND_PORT > /dev/null 2>&1; then
        return 0
    fi

    return 1
}

# Check if frontend dev server is running
is_frontend_running() {
    if [ -f "$FRONTEND_PID_FILE" ]; then
        PID=$(cat "$FRONTEND_PID_FILE")
        if ps -p "$PID" > /dev/null 2>&1; then
            return 0
        else
            rm -f "$FRONTEND_PID_FILE"
            return 1
        fi
    fi

    # Fallback: check by port
    if lsof -ti:$FRONTEND_PORT > /dev/null 2>&1; then
        return 0
    fi

    return 1
}

# Check if webpack dev server is running
is_webpack_dev_running() {
    if [ -f "$WEBPACK_DEV_PID_FILE" ]; then
        PID=$(cat "$WEBPACK_DEV_PID_FILE")
        if ps -p "$PID" > /dev/null 2>&1; then
            return 0
        else
            rm -f "$WEBPACK_DEV_PID_FILE"
            return 1
        fi
    fi

    # Fallback: check by port
    if lsof -ti:$WEBPACK_DEV_PORT > /dev/null 2>&1; then
        return 0
    fi

    return 1
}

# Ensure log directory exists
ensure_log_dir() {
    if [ ! -d "$LOG_DIR" ]; then
        mkdir -p "$LOG_DIR"
    fi
}

# Check if Redis is running
is_redis_running() {
    if command -v redis-cli > /dev/null 2>&1; then
        if redis-cli ping > /dev/null 2>&1; then
            return 0
        fi
    fi
    return 1
}

# Start Redis if available
start_redis() {
    # Check if Redis is installed
    if ! command -v redis-server > /dev/null 2>&1; then
        print_info "Redis not installed - skipping (optional for 90% faster performance)"
        print_info "Install: brew install redis (macOS) or apt-get install redis-server (Linux)"
        return 1
    fi

    # Check if already running
    if is_redis_running; then
        print_success "Redis already running"
        return 0
    fi

    # Start Redis
    print_info "Starting Redis server..."
    redis-server --daemonize yes --dir "$PROJECT_DIR" --logfile "$LOG_DIR/redis.log" > /dev/null 2>&1

    # Wait for Redis to start
    for i in {1..5}; do
        sleep 1
        if is_redis_running; then
            print_success "Redis started successfully"
            print_info "🔥 DHIS2 caching enabled - 90% faster performance!"
            return 0
        fi
    done

    print_warning "Redis failed to start - continuing without backend caching"
    return 1
}

# Stop Redis
stop_redis() {
    if ! command -v redis-cli > /dev/null 2>&1; then
        return 0
    fi

    if is_redis_running; then
        print_info "Stopping Redis..."
        redis-cli shutdown > /dev/null 2>&1
        print_success "Redis stopped"
    fi
}

# Check Redis status
redis_status() {
    if ! command -v redis-server > /dev/null 2>&1; then
        echo "  Redis: Not installed (optional)"
        return 1
    fi

    if is_redis_running; then
        # Get Redis info
        local redis_keys=$(redis-cli DBSIZE 2>/dev/null | awk '{print $2}')
        local redis_memory=$(redis-cli INFO memory 2>/dev/null | grep used_memory_human | cut -d: -f2 | tr -d '\r')
        echo "  Redis: ✅ Running (${redis_keys:-0} keys, ${redis_memory:-0B} memory)"
        return 0
    else
        echo "  Redis: ⚠️  Not running (optional - enables 90% faster caching)"
        return 1
    fi
}

# Start Superset
start_superset() {
    print_header "🚀 Starting Superset"

    if is_running; then
        print_warning "Superset is already running"
        print_info "Use './superset-manager.sh stop' to stop it first"
        print_info "Or use './superset-manager.sh restart' to restart"
        exit 0
    fi

    cd "$PROJECT_DIR"

    # Create log directory
    ensure_log_dir

    # Start Redis (optional but recommended for performance)
    echo ""
    start_redis
    echo ""

    # Activate virtual environment
    print_info "Activating virtual environment..."
    source "$VENV_DIR/bin/activate"

    # Set configuration
    export SUPERSET_CONFIG_PATH="$CONFIG_PATH"
    export FLASK_APP=superset

    print_info "Configuration: $SUPERSET_CONFIG_PATH"
    print_info "Starting server on http://localhost:8088"
    print_info "Logs: $LOG_FILE"
    echo ""

    # Start Superset in background
    nohup superset run -p 8088 --with-threads --reload --debugger > "$LOG_FILE" 2>&1 &
    SUPERSET_PID=$!

    # Save PID
    echo "$SUPERSET_PID" > "$PID_FILE"

    # Wait for startup
    print_info "Waiting for Superset to start..."
    for i in {1..30}; do
        sleep 1
        if curl -s http://localhost:8088/health > /dev/null 2>&1; then
            print_success "Superset started successfully - PID: $SUPERSET_PID"
            echo ""
            print_info "Access Superset at: http://localhost:8088"
            print_info "Stop server: ./superset-manager.sh stop"
            print_info "View logs: ./superset-manager.sh logs backend [follow]"
            echo ""
            print_info "Tailing backend logs (Ctrl+C to exit)..."
            echo ""
            sleep 1
            tail -f "$LOG_FILE"
            return 0
        fi
        echo -n "."
    done

    echo ""
    print_error "Superset failed to start"
    print_info "Check logs: tail -50 $LOG_FILE"
    exit 1
}

# Stop Superset
stop_superset() {
    print_header "🛑 Stopping Superset"

    if ! is_running; then
        print_warning "Superset is not running"
        return 0
    fi

    # Kill by PID file
    if [ -f "$PID_FILE" ]; then
        PID=$(cat "$PID_FILE")
        print_info "Stopping Superset - PID: $PID..."
        kill -TERM "$PID" 2>/dev/null || true
        sleep 2

        # Force kill if still running
        if ps -p "$PID" > /dev/null 2>&1; then
            print_warning "Process still running, forcing shutdown..."
            kill -9 "$PID" 2>/dev/null || true
        fi

        rm -f "$PID_FILE"
    fi

    # Fallback: kill by port
    if lsof -ti:8088 > /dev/null 2>&1; then
        print_info "Killing processes on port 8088..."
        lsof -ti:8088 | xargs kill -9 2>/dev/null || true
    fi

    # Also kill by process name
    pkill -f "superset run" 2>/dev/null || true

    sleep 1

    if ! is_running; then
        print_success "Superset stopped successfully"
    else
        print_error "Failed to stop Superset"
        exit 1
    fi
}

# Start frontend dev server
start_frontend() {
    print_header "🚀 Starting Frontend Dev Server"

    if is_frontend_running; then
        print_warning "Frontend dev server is already running"
        print_info "Use './superset-manager.sh stop-frontend' to stop it first"
        print_info "Or use './superset-manager.sh restart-frontend' to restart"
        exit 0
    fi

    if [ ! -d "$FRONTEND_DIR" ]; then
        print_error "Frontend directory not found: $FRONTEND_DIR"
        exit 1
    fi

    cd "$FRONTEND_DIR"

    # Create log directory
    ensure_log_dir

    print_info "Installing dependencies (if needed)..."
    npm install --quiet 2>&1 | grep -v "^npm WARN" || true

    print_info "Starting dev server on http://localhost:$FRONTEND_PORT"
    print_info "Logs: $FRONTEND_LOG_FILE"
    echo ""

    # Start frontend dev server in background
    nohup npm run dev-server > "$FRONTEND_LOG_FILE" 2>&1 &
    FRONTEND_PID=$!

    # Save PID
    echo "$FRONTEND_PID" > "$FRONTEND_PID_FILE"

    # Wait for startup
    print_info "Waiting for frontend dev server to start..."
    for i in {1..60}; do
        sleep 2
        if lsof -ti:$FRONTEND_PORT > /dev/null 2>&1; then
            print_success "Frontend dev server started successfully - PID: $FRONTEND_PID"
            echo ""
            print_info "Access frontend at: http://localhost:$FRONTEND_PORT"
            print_info "View logs: tail -f $FRONTEND_LOG_FILE"
            echo ""
            return 0
        fi
        echo -n "."
    done

    echo ""
    print_error "Frontend dev server failed to start"
    print_info "Check logs: tail -50 $FRONTEND_LOG_FILE"
    exit 1
}

# Stop frontend dev server
stop_frontend() {
    print_header "🛑 Stopping Frontend Dev Server"

    if ! is_frontend_running; then
        print_warning "Frontend dev server is not running"
        return 0
    fi

    # Kill by PID file
    if [ -f "$FRONTEND_PID_FILE" ]; then
        PID=$(cat "$FRONTEND_PID_FILE")
        print_info "Stopping frontend dev server - PID: $PID..."
        kill -TERM "$PID" 2>/dev/null || true
        sleep 2

        # Force kill if still running
        if ps -p "$PID" > /dev/null 2>&1; then
            print_warning "Process still running, forcing shutdown..."
            kill -9 "$PID" 2>/dev/null || true
        fi

        rm -f "$FRONTEND_PID_FILE"
    fi

    # Fallback: kill by port
    if lsof -ti:$FRONTEND_PORT > /dev/null 2>&1; then
        print_info "Killing processes on port $FRONTEND_PORT..."
        lsof -ti:$FRONTEND_PORT | xargs kill -9 2>/dev/null || true
    fi

    # Also kill by process name
    pkill -f "npm start" 2>/dev/null || true
    pkill -f "webpack-dev-server" 2>/dev/null || true

    sleep 1

    if ! is_frontend_running; then
        print_success "Frontend dev server stopped successfully"
    else
        print_error "Failed to stop frontend dev server"
        exit 1
    fi
}

# Start webpack dev server (port 8081)
start_webpack_dev() {
    print_header "🚀 Starting Webpack Dev Server (Port 8081)"

    if is_webpack_dev_running; then
        print_warning "Webpack dev server is already running"
        print_info "Use './superset-manager.sh stop-webpack' to stop it first"
        print_info "Or use './superset-manager.sh restart-webpack' to restart"
        exit 0
    fi

    if [ ! -d "$FRONTEND_DIR" ]; then
        print_error "Frontend directory not found: $FRONTEND_DIR"
        exit 1
    fi

    cd "$FRONTEND_DIR"

    # Create log directory
    ensure_log_dir

    print_info "Starting webpack dev server on http://localhost:$WEBPACK_DEV_PORT"
    print_info "Logs: $WEBPACK_DEV_LOG_FILE"
    echo ""

    # Start webpack dev server in background with custom port
    nohup env WEBPACK_DEVSERVER_PORT=$WEBPACK_DEV_PORT npm run dev-server > "$WEBPACK_DEV_LOG_FILE" 2>&1 &
    WEBPACK_PID=$!

    # Save PID
    echo "$WEBPACK_PID" > "$WEBPACK_DEV_PID_FILE"

    # Wait for startup
    print_info "Waiting for webpack dev server to start..."
    for i in {1..60}; do
        sleep 2
        if lsof -ti:$WEBPACK_DEV_PORT > /dev/null 2>&1; then
            print_success "Webpack dev server started successfully - PID: $WEBPACK_PID"
            echo ""
            print_info "Access webpack dev server at: http://localhost:$WEBPACK_DEV_PORT"
            print_info "View logs: tail -f $WEBPACK_DEV_LOG_FILE"
            echo ""
            return 0
        fi
        echo -n "."
    done

    echo ""
    print_error "Webpack dev server failed to start"
    print_info "Check logs: tail -50 $WEBPACK_DEV_LOG_FILE"
    exit 1
}

# Stop webpack dev server
stop_webpack_dev() {
    print_header "🛑 Stopping Webpack Dev Server (Port 8081)"

    if ! is_webpack_dev_running; then
        print_warning "Webpack dev server is not running"
        return 0
    fi

    # Kill by PID file
    if [ -f "$WEBPACK_DEV_PID_FILE" ]; then
        PID=$(cat "$WEBPACK_DEV_PID_FILE")
        print_info "Stopping webpack dev server - PID: $PID..."
        kill -TERM "$PID" 2>/dev/null || true
        sleep 2

        # Force kill if still running
        if ps -p "$PID" > /dev/null 2>&1; then
            print_warning "Process still running, forcing shutdown..."
            kill -9 "$PID" 2>/dev/null || true
        fi

        rm -f "$WEBPACK_DEV_PID_FILE"
    fi

    # Fallback: kill by port
    if lsof -ti:$WEBPACK_DEV_PORT > /dev/null 2>&1; then
        print_info "Killing processes on port $WEBPACK_DEV_PORT..."
        lsof -ti:$WEBPACK_DEV_PORT | xargs kill -9 2>/dev/null || true
    fi

    # Also kill by process name (webpack-dev-server)
    pkill -f "webpack-dev-server" 2>/dev/null || true

    sleep 1

    if ! is_webpack_dev_running; then
        print_success "Webpack dev server stopped successfully"
    else
        print_error "Failed to stop webpack dev server"
        exit 1
    fi
}

# Restart webpack dev server
restart_webpack_dev() {
    print_header "🔄 Restarting Webpack Dev Server"
    stop_webpack_dev
    sleep 2
    start_webpack_dev
}

# Restart Superset with cache clearing
restart_superset() {
    print_header "🔄 Restarting Superset with Cache Cleanup"
    stop_superset
    clear_all_caches
    sleep 2
    start_superset
}

# Restart frontend dev server
restart_frontend() {
    print_header "🔄 Restarting Frontend Dev Server"
    stop_frontend
    sleep 2
    start_frontend
}

# Start all services (backend, frontend, webpack dev)
start_all() {
    print_header "🚀 Starting Superset (Backend + Frontend + Webpack Dev)"

    # Start Redis first (optional but recommended for performance)
    echo ""
    start_redis
    echo ""

    # Start services in the background
    print_info "Starting backend..."
    (start_superset &)
    sleep 3

    print_info "Starting frontend..."
    (start_frontend &)
    sleep 3

    print_info "Starting webpack dev..."
    (start_webpack_dev &)

    echo ""
    print_success "All services are running!"
    echo ""
    print_info "Backend:              http://localhost:$BACKEND_PORT"
    print_info "Frontend:             http://localhost:$FRONTEND_PORT"
    print_info "Webpack Dev Server:   http://localhost:$WEBPACK_DEV_PORT"
    if is_redis_running; then
        print_info "Redis:                Running (DHIS2 caching active)"
    fi
    echo ""
    print_info "View logs with: ./superset-manager.sh logs backend follow"
}

# Stop all services
stop_all() {
    print_header "🛑 Stopping Superset (Backend + Frontend + Webpack Dev)"

    stop_webpack_dev
    echo ""
    stop_frontend
    echo ""
    stop_superset
    echo ""
    stop_redis

    print_success "All services stopped"
}

# Restart all services
restart_all() {
    print_header "🔄 Restarting Superset (Backend + Frontend + Webpack Dev)"
    
    stop_all
    sleep 2
    clear_all_caches
    sleep 2
    start_all
}

# Clear all caches (frontend and backend)
clear_all_caches() {
    print_header "🧹 Clearing All Caches (Frontend & Backend)"
    
    # Backend cache
    clear_cache
    
    # Frontend cache
    clear_frontend_cache
}

# Clear frontend cache
clear_frontend_cache() {
    print_header "🧹 Clearing Frontend Cache"
    
    FRONTEND_DIR="$PROJECT_DIR/superset-frontend"
    
    if [ ! -d "$FRONTEND_DIR" ]; then
        print_warning "Frontend directory not found"
        return 1
    fi
    
    cd "$FRONTEND_DIR"
    
    # Webpack/build cache
    print_info "Clearing webpack/build cache..."
    rm -rf dist build .webpack .next .eslintcache 2>/dev/null || true
    print_success "Webpack cache cleared"
    
    # Node modules cache
    print_info "Clearing npm cache..."
    rm -rf node_modules/.cache node_modules/.webpack 2>/dev/null || true
    npm cache clean --force 2>/dev/null || true
    print_success "NPM cache cleared"
}

# Show Superset status
status_superset() {
    print_header "📊 Superset Status (Backend)"

    if is_running; then
        if [ -f "$PID_FILE" ]; then
            PID=$(cat "$PID_FILE")
            print_success "Backend is running - PID: $PID"
        else
            print_success "Backend is running"
        fi

        # Show port info
        print_info "Port $BACKEND_PORT: In use"

        # Show process info
        ps aux | grep "[s]uperset run" | head -1 || true

        # Test health endpoint
        if curl -s http://localhost:$BACKEND_PORT/health > /dev/null 2>&1; then
            print_success "Health check: OK"
        else
            print_warning "Health check: Failed"
        fi

        echo ""
        print_info "Access: http://localhost:$BACKEND_PORT"

    else
        print_warning "Backend is not running"
        echo ""
        print_info "Start with: ./superset-manager.sh start-backend"
    fi
}

# Show frontend status
status_frontend() {
    print_header "📊 Frontend Dev Server Status"

    if is_frontend_running; then
        if [ -f "$FRONTEND_PID_FILE" ]; then
            PID=$(cat "$FRONTEND_PID_FILE")
            print_success "Frontend dev server is running - PID: $PID"
        else
            print_success "Frontend dev server is running"
        fi

        # Show port info
        print_info "Port $FRONTEND_PORT: In use"

        # Show process info
        ps aux | grep "[n]pm start" | head -1 || true

        # Test if server responds
        if curl -s http://localhost:$FRONTEND_PORT > /dev/null 2>&1; then
            print_success "Health check: OK"
        else
            print_warning "Health check: Failed"
        fi

        echo ""
        print_info "Access: http://localhost:$FRONTEND_PORT"

    else
        print_warning "Frontend dev server is not running"
        echo ""
        print_info "Start with: ./superset-manager.sh start-frontend"
    fi
}

# Show webpack dev server status
status_webpack_dev() {
    print_header "📊 Webpack Dev Server Status (Port 8081)"

    if is_webpack_dev_running; then
        if [ -f "$WEBPACK_DEV_PID_FILE" ]; then
            PID=$(cat "$WEBPACK_DEV_PID_FILE")
            print_success "Webpack dev server is running - PID: $PID"
        else
            print_success "Webpack dev server is running"
        fi

        # Show port info
        print_info "Port $WEBPACK_DEV_PORT: In use"

        # Test if server responds
        if curl -s http://localhost:$WEBPACK_DEV_PORT > /dev/null 2>&1; then
            print_success "Health check: OK"
        else
            print_warning "Health check: Failed"
        fi

        echo ""
        print_info "Access: http://localhost:$WEBPACK_DEV_PORT"

    else
        print_warning "Webpack dev server is not running"
        echo ""
        print_info "Start with: ./superset-manager.sh start-webpack"
    fi
}

# Show combined status
status_all() {
    print_header "📊 Superset Full Status (Backend + Frontend + Webpack Dev)"
    
    echo ""
    echo "Backend Status:"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    if is_running; then
        if [ -f "$PID_FILE" ]; then
            PID=$(cat "$PID_FILE")
            print_success "Backend is running - PID: $PID"
        else
            print_success "Backend is running"
        fi
        print_info "Access: http://localhost:$BACKEND_PORT"
    else
        print_warning "Backend is not running"
    fi
    
    echo ""
    echo "Frontend Status:"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    if is_frontend_running; then
        if [ -f "$FRONTEND_PID_FILE" ]; then
            PID=$(cat "$FRONTEND_PID_FILE")
            print_success "Frontend is running - PID: $PID"
        else
            print_success "Frontend is running"
        fi
        print_info "Access: http://localhost:$FRONTEND_PORT"
    else
        print_warning "Frontend is not running"
    fi
    
    echo ""
    echo "Webpack Dev Server Status:"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    if is_webpack_dev_running; then
        if [ -f "$WEBPACK_DEV_PID_FILE" ]; then
            PID=$(cat "$WEBPACK_DEV_PID_FILE")
            print_success "Webpack dev server is running - PID: $PID"
        else
            print_success "Webpack dev server is running"
        fi
        print_info "Access: http://localhost:$WEBPACK_DEV_PORT"
    else
        print_warning "Webpack dev server is not running"
    fi

    echo ""
    echo "Redis Status:"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    redis_status
    
    echo ""
}

# View logs
view_logs() {
    local log_type="${1:-backend}"
    local follow="${2:-}"

    if [ "$log_type" == "backend" ]; then
        print_header "📋 Backend Logs"
        if [ ! -f "$LOG_FILE" ]; then
            print_warning "Log file not found: $LOG_FILE"
            return 1
        fi
        if [ "$follow" == "follow" ]; then
            tail -f "$LOG_FILE"
        else
            print_info "Showing last 50 lines (press Ctrl+C to exit)"
            echo ""
            tail -50 "$LOG_FILE"
        fi
    elif [ "$log_type" == "frontend" ]; then
        print_header "📋 Frontend Logs"
        if [ ! -f "$FRONTEND_LOG_FILE" ]; then
            print_warning "Log file not found: $FRONTEND_LOG_FILE"
            return 1
        fi
        if [ "$follow" == "follow" ]; then
            tail -f "$FRONTEND_LOG_FILE"
        else
            print_info "Showing last 50 lines (press Ctrl+C to exit)"
            echo ""
            tail -50 "$FRONTEND_LOG_FILE"
        fi
    elif [ "$log_type" == "webpack" ]; then
        print_header "📋 Webpack Dev Server Logs"
        if [ ! -f "$WEBPACK_DEV_LOG_FILE" ]; then
            print_warning "Log file not found: $WEBPACK_DEV_LOG_FILE"
            return 1
        fi
        if [ "$follow" == "follow" ]; then
            tail -f "$WEBPACK_DEV_LOG_FILE"
        else
            print_info "Showing last 50 lines (press Ctrl+C to exit)"
            echo ""
            tail -50 "$WEBPACK_DEV_LOG_FILE"
        fi
    else
        print_error "Unknown log type: $log_type"
        print_info "Use 'backend', 'frontend', or 'webpack'"
        return 1
    fi
}

# Clear cache
clear_cache() {
    print_header "🧹 Clearing Cache"

    if is_running; then
        print_error "Please stop Superset before clearing cache"
        print_info "Run: ./superset-manager.sh stop"
        exit 1
    fi

    if [ -d "$CACHE_DIR" ]; then
        print_info "Clearing cache directory: $CACHE_DIR"
        rm -rf "$CACHE_DIR"/*
        print_success "Cache cleared"
    else
        print_warning "Cache directory not found: $CACHE_DIR"
    fi

    # Clear Python cache
    print_info "Clearing Python cache..."
    find "$PROJECT_DIR" -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true
    find "$PROJECT_DIR" -type f -name "*.pyc" -delete 2>/dev/null || true
    print_success "Python cache cleared"
}

# Database upgrade
db_upgrade() {
    print_header "🔧 Database Upgrade"

    cd "$PROJECT_DIR"
    source "$VENV_DIR/bin/activate"
    export SUPERSET_CONFIG_PATH="$CONFIG_PATH"

    print_info "Running database migrations..."
    superset db upgrade

    print_success "Database upgraded"
}

# Health check
health_check() {
    print_header "🏥 Health Check"

    # Check virtual environment
    if [ -d "$VENV_DIR" ]; then
        print_success "Virtual environment: OK"
    else
        print_error "Virtual environment: Missing"
    fi

    # Check config file
    if [ -f "$CONFIG_PATH" ]; then
        print_success "Configuration file: OK"
    else
        print_error "Configuration file: Missing"
    fi

    # Check if running
    if is_running; then
        print_success "Process: Running"

        # Check HTTP endpoint
        if curl -s http://localhost:8088/health > /dev/null 2>&1; then
            print_success "HTTP endpoint: Responding"
        else
            print_error "HTTP endpoint: Not responding"
        fi
    else
        print_warning "Process: Not running"
    fi

    # Check port
    if lsof -ti:8088 > /dev/null 2>&1; then
        print_info "Port 8088: In use"
    else
        print_info "Port 8088: Available"
    fi
}

# Clear logs
clear_logs() {
    print_header "🧹 Clearing Logs"
    
    ensure_log_dir
    
    if [ -f "$LOG_FILE" ]; then
        rm -f "$LOG_FILE"
        print_success "Backend logs cleared: $LOG_FILE"
    fi
    
    if [ -f "$FRONTEND_LOG_FILE" ]; then
        rm -f "$FRONTEND_LOG_FILE"
        print_success "Frontend logs cleared: $FRONTEND_LOG_FILE"
    fi
    
    if [ -f "$WEBPACK_DEV_LOG_FILE" ]; then
        rm -f "$WEBPACK_DEV_LOG_FILE"
        print_success "Webpack dev logs cleared: $WEBPACK_DEV_LOG_FILE"
    fi
    
    print_info "Log directory: $LOG_DIR"
}

# Show usage
show_usage() {
    cat << EOF
Superset Management Script - Backend & Frontend & Webpack Dev Manager

Usage: ./superset-manager.sh [command] [options]

COMBINED COMMANDS (Backend + Frontend + Webpack Dev):
    start-all           Start all servers (backend, frontend, webpack dev)
    stop-all            Stop all servers
    restart-all         Restart all with cache cleanup
    status-all          Show status of all servers

BACKEND COMMANDS:
    start               Start Superset backend (alias: start-backend)
    stop                Stop Superset backend (alias: stop-backend)
    restart             Restart backend with cache cleanup
    status              Show backend status (alias: status-backend)
    start-backend       Start Superset backend explicitly
    stop-backend        Stop Superset backend explicitly
    status-backend      Show backend status explicitly
    restart-backend     Restart backend with cache cleanup

FRONTEND COMMANDS:
    start-frontend      Start frontend dev server (port 9000)
    stop-frontend       Stop frontend dev server
    restart-frontend    Restart frontend dev server
    status-frontend     Show frontend status

WEBPACK DEV SERVER COMMANDS:
    start-webpack       Start webpack dev server (port 8081)
    stop-webpack        Stop webpack dev server
    restart-webpack     Restart webpack dev server
    status-webpack      Show webpack dev server status

LOGGING COMMANDS:
    logs                View last 50 lines of backend logs
    logs backend        View last 50 lines of backend logs
    logs frontend       View last 50 lines of frontend logs
    logs webpack        View last 50 lines of webpack dev logs
    logs backend follow Follow backend logs in real-time (Ctrl+C to exit)
    logs frontend follow Follow frontend logs in real-time (Ctrl+C to exit)
    logs webpack follow Follow webpack logs in real-time (Ctrl+C to exit)
    clear-logs          Clear all server logs (useful before debugging)

REDIS COMMANDS (DHIS2 Performance):
    start-redis         Start Redis server (optional, 90% faster DHIS2 caching)
    stop-redis          Stop Redis server
    redis-status        Show Redis status and performance info

CACHE & DATABASE COMMANDS:
    cache               Clear backend cache only (Superset + Python)
    cache-all           Clear ALL caches (frontend + backend)
    cache-frontend      Clear frontend cache only (webpack + npm)
    db-upgrade          Run database migrations
    health              Run health check
    help                Show this help message

EXAMPLES:
    # Start everything (backend + frontend + webpack dev)
    ./superset-manager.sh start-all
    
    # Start backend only (automatically tails logs)
    ./superset-manager.sh start
    
    # Start frontend only
    ./superset-manager.sh start-frontend
    
    # Start webpack dev server only
    ./superset-manager.sh start-webpack
    
    # Restart everything with cache cleanup
    ./superset-manager.sh restart-all
    
    # Debugging DHIS2 issues: clear logs, start fresh, and monitor
    ./superset-manager.sh clear-logs
    ./superset-manager.sh start
    
    # View logs in separate terminal
    ./superset-manager.sh logs backend follow
    ./superset-manager.sh logs frontend follow
    ./superset-manager.sh logs webpack follow
    
    # Status check
    ./superset-manager.sh status-all
    
    # Clear caches without restart
    ./superset-manager.sh cache-all

    # Redis commands for DHIS2 performance
    ./superset-manager.sh redis-status
    ./superset-manager.sh start-redis
    ./superset-manager.sh stop-redis

NOTES:
    - 'restart-all' automatically clears all caches
    - 'start-all' automatically starts Redis if installed (optional, 90% faster DHIS2)
    - Use 'start-all' for complete development environment
    - 'start' (backend) automatically tails logs after startup - Ctrl+C to stop following
    - Frontend dev server enables hot module reloading
    - Webpack dev server serves compiled assets on port 8081
    - After cache cleanup, hard-refresh browser (Cmd+Shift+R or Ctrl+Shift+R)
    - All logs stored in: logs/ directory (see locations below)
    - Redis is OPTIONAL: Superset works without it, but Redis gives 90% faster DHIS2 performance

PORTS:
    Backend:            http://localhost:8088
    Frontend:           http://localhost:9000
    Webpack Dev Server: http://localhost:8081

LOG FILES:
    Backend logs:       logs/superset_backend.log
    Frontend logs:      logs/superset_frontend.log
    Webpack dev logs:   logs/webpack_dev.log
    
    Automatically created in: $PROJECT_DIR/logs/

DEBUGGING DHIS2 QUERIES:
    1. Clear old logs:
       ./superset-manager.sh clear-logs
    
    2. Start backend (automatically tails logs):
       ./superset-manager.sh start
    
    3. In separate terminal, run your DHIS2 SQL in SQL Lab
    
    4. Watch backend logs for:
       - [DHIS2 Data Preview] entries
       - Check parameter values and API calls
       - Look for error messages with "[DHIS2 Data Preview] Empty input"
    
    5. Check browser console (F12 → Console) for:
       - [DHIS2DataLoader] parsing/validation logs
       - API request/response details

EOF
}

# Main script logic
main() {
    case "${1:-start-all}" in
        # Combined commands
        start-all)
            start_all
            ;;
        stop-all)
            stop_all
            ;;
        restart-all)
            restart_all
            ;;
        status-all)
            status_all
            ;;
        
        # Backend commands
        start|start-backend)
            start_superset
            ;;
        stop|stop-backend)
            stop_superset
            ;;
        restart|restart-backend)
            restart_superset
            ;;
        status|status-backend)
            status_superset
            ;;
        
        # Frontend commands
        start-frontend)
            start_frontend
            ;;
        stop-frontend)
            stop_frontend
            ;;
        restart-frontend)
            restart_frontend
            ;;
        status-frontend)
            status_frontend
            ;;
        
        # Webpack dev server commands
        start-webpack)
            start_webpack_dev
            ;;
        stop-webpack)
            stop_webpack_dev
            ;;
        restart-webpack)
            restart_webpack_dev
            ;;
        status-webpack)
            status_webpack_dev
            ;;
        
        # Logging commands
        logs)
            view_logs "$2" "$3"
            ;;
        clear-logs|logs-clear)
            clear_logs
            ;;
        
        # Redis commands
        start-redis)
            start_redis
            ;;
        stop-redis)
            stop_redis
            ;;
        redis-status|status-redis)
            redis_status
            ;;

        # Cache & database commands
        cache|clear-cache)
            clear_cache
            ;;
        cache-all|clear-all)
            clear_all_caches
            ;;
        cache-frontend|clear-frontend)
            clear_frontend_cache
            ;;
        db-upgrade|migrate)
            db_upgrade
            ;;
        health|check)
            health_check
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
}

# Run main function
main "$@"


