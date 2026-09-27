#!/usr/bin/env bash
# Arranca un servidor local (sin caché, para que siempre cargue la última versión) y abre el juego.
cd "$(dirname "$0")"
PORT=${PORT:-8765}
python3 - "$PORT" <<'PY' >/dev/null 2>&1 &
import sys, http.server
class H(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()
http.server.ThreadingHTTPServer(('', int(sys.argv[1])), H).serve_forever()
PY
PID=$!
trap 'kill $PID 2>/dev/null' EXIT
sleep 0.6
xdg-open "http://localhost:$PORT/" >/dev/null 2>&1 || echo "Abre http://localhost:$PORT/"
echo "Servidor en http://localhost:$PORT/ — Ctrl+C para parar"
wait $PID
