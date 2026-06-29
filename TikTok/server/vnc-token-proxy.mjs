// vnc-token-proxy.mjs — gates noVNC access by an ephemeral token minted by c2.
// HTTP (noVNC static assets) passes through to websockify; the WebSocket upgrade
// is allowed ONLY if ?token= validates against c2 (/api/vnc/validate). Because
// this is the only thing exposed via the cloudflared tunnel, x11vnc itself can
// run -nopw bound to localhost — the token is the sole, ephemeral gate.
import http from 'http'
import httpProxy from 'http-proxy'

const WEBSOCKIFY = process.env.WEBSOCKIFY_TARGET || 'http://127.0.0.1:6080'
const C2 = process.env.C2_BASE || 'http://127.0.0.1:3000'
const PORT = parseInt(process.env.VNC_PROXY_PORT || '6090')

const proxy = httpProxy.createProxyServer({ target: WEBSOCKIFY, ws: true })
proxy.on('error', (err, _req, res) => {
  console.log('[vnc-proxy] upstream error:', err.message)
  try { if (res && res.writeHead) { res.writeHead(502); res.end('proxy error') } } catch {}
})

async function validate(token) {
  if (!token) return false
  try {
    const r = await fetch(`${C2}/api/vnc/validate?token=${encodeURIComponent(token)}`)
    return r.ok
  } catch { return false }
}

const server = http.createServer((req, res) => {
  // noVNC static assets (vnc.html, core/, app/...) — no secrets, pass through.
  proxy.web(req, res)
})

server.on('upgrade', async (req, socket, head) => {
  const u = new URL(req.url, 'http://x')
  const token = u.searchParams.get('token')
  if (!(await validate(token))) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
    socket.destroy()
    console.log('[vnc-proxy] WS REJECTED (missing/expired token)')
    return
  }
  console.log('[vnc-proxy] WS authorized')
  proxy.ws(req, socket, head)
})

server.listen(PORT, () => console.log(`[vnc-proxy] :${PORT} -> ${WEBSOCKIFY} (gate: ${C2}/api/vnc/validate)`))
