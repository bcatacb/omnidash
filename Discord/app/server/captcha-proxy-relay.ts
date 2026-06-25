// Proxy relay server for captcha solving.
//
// Problem: 2captcha workers can't connect through residential proxies (they
// block inbound). Proxyless solve → token bound to 2captcha datacenter IP →
// Discord request uses residential proxy IP → IP mismatch → 400.
//
// Solution: for each captcha solve, spin up a temporary HTTP CONNECT relay
// on a dedicated port. 2captcha connects to VPS_IP:PORT with no credentials
// needed — the port itself identifies which residential proxy to use.
// hCaptcha sees the residential IP → token bound to it → IPs match.

import * as net from 'net';
import * as http from 'http';

const VPS_IP = process.env.VPS_PUBLIC_IP || '';
const PORT_MIN = parseInt(process.env.CAPTCHA_RELAY_PORT_MIN || '4002');
const PORT_MAX = parseInt(process.env.CAPTCHA_RELAY_PORT_MAX || '4099');

// Track which ports are in use so concurrent solves don't collide.
const portsInUse = new Set<number>();

function pickPort(): number | null {
  for (let p = PORT_MIN; p <= PORT_MAX; p++) {
    if (!portsInUse.has(p)) return p;
  }
  return null;
}

export interface ProxyRelay {
  proxyParam: string; // "VPS_IP:PORT" to pass to 2captcha
  close: () => void;
}

// Start a relay bound to one port that tunnels ALL traffic through
// residentialProxyUrl. Returns null if no port is available or VPS_IP unset.
export function startSolveRelay(residentialProxyUrl: string): Promise<ProxyRelay | null> {
  if (!VPS_IP) return Promise.resolve(null);

  const port = pickPort();
  if (port === null) {
    console.warn('[captcha-relay] all relay ports in use — solving without relay');
    return Promise.resolve(null);
  }

  portsInUse.add(port);

  return new Promise((resolve) => {
    const server = http.createServer((_req, res) => { res.writeHead(405).end(); });

    server.on('connect', (req, clientSocket, head) => {
      const socket = clientSocket as net.Socket;
      const target = req.url || '';
      const lastColon = target.lastIndexOf(':');
      const targetHost = target.slice(0, lastColon);
      const targetPort = parseInt(target.slice(lastColon + 1)) || 443;
      tunnelViaProxy(residentialProxyUrl, targetHost, targetPort, socket, head);
    });

    server.on('error', (err) => {
      portsInUse.delete(port);
      console.warn(`[captcha-relay] port ${port} error: ${err.message}`);
      resolve(null);
    });

    server.listen(port, '0.0.0.0', () => {
      console.log(`[captcha-relay] relay :${port} → ${residentialProxyUrl.split('@').pop()}`);
      resolve({
        proxyParam: `${VPS_IP}:${port}`,
        close: () => {
          portsInUse.delete(port);
          server.close();
        },
      });
    });
  });
}

function tunnelViaProxy(
  proxyUrl: string,
  targetHost: string,
  targetPort: number,
  clientSocket: net.Socket,
  head: Buffer,
): void {
  let parsed: URL;
  try {
    parsed = new URL(proxyUrl);
  } catch {
    try { parsed = new URL('http://' + proxyUrl); } catch {
      clientSocket.write('HTTP/1.1 502 Bad Gateway\r\n\r\n');
      clientSocket.end();
      return;
    }
  }

  const isSocks = parsed.protocol.startsWith('socks');
  const pHost = parsed.hostname;
  const pPort = parseInt(parsed.port) || (isSocks ? 1080 : 80);
  const pUser = parsed.username ? decodeURIComponent(parsed.username) : null;
  const pPass = parsed.password ? decodeURIComponent(parsed.password) : null;

  const proxySocket = net.connect(pPort, pHost);

  const onErr = (e: Error) => {
    console.warn(`[captcha-relay] tunnel error: ${e.message}`);
    clientSocket.destroy();
    proxySocket.destroy();
  };
  proxySocket.on('error', onErr);
  clientSocket.on('error', onErr);
  proxySocket.on('end', () => clientSocket.end());
  clientSocket.on('end', () => proxySocket.end());

  const established = () => {
    clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    if (head.length > 0) proxySocket.write(head);
    proxySocket.pipe(clientSocket);
    clientSocket.pipe(proxySocket);
  };

  if (isSocks) {
    connectSocks5(proxySocket, pUser, pPass, targetHost, targetPort)
      .then(established)
      .catch((e) => {
        console.warn(`[captcha-relay] socks5 failed: ${e.message}`);
        clientSocket.write('HTTP/1.1 502 Bad Gateway\r\n\r\n');
        clientSocket.end();
        proxySocket.end();
      });
    return;
  }

  proxySocket.once('connect', () => {
    let req = `CONNECT ${targetHost}:${targetPort} HTTP/1.1\r\nHost: ${targetHost}:${targetPort}\r\n`;
    if (pUser && pPass) {
      req += `Proxy-Authorization: Basic ${Buffer.from(`${pUser}:${pPass}`).toString('base64')}\r\n`;
    }
    req += '\r\n';
    proxySocket.write(req);
  });

  let buf = '';
  const onData = (data: Buffer) => {
    buf += data.toString('binary');
    const end = buf.indexOf('\r\n\r\n');
    if (end === -1) return;
    proxySocket.removeListener('data', onData);
    if (buf.split('\r\n')[0].includes(' 200')) {
      const leftover = Buffer.from(buf.slice(end + 4), 'binary');
      if (leftover.length > 0) clientSocket.write(leftover);
      established();
    } else {
      clientSocket.write('HTTP/1.1 502 Bad Gateway\r\n\r\n');
      clientSocket.end();
      proxySocket.end();
    }
  };
  proxySocket.on('data', onData);
}

function connectSocks5(
  socket: net.Socket,
  user: string | null,
  pass: string | null,
  host: string,
  port: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const useAuth = !!(user && pass);
    socket.write(Buffer.from([0x05, 1, useAuth ? 0x02 : 0x00]));

    socket.once('data', (reply) => {
      if (reply[0] !== 0x05) return reject(new Error('not socks5'));
      if (reply[1] === 0xFF) return reject(new Error('no acceptable auth'));

      const sendConnect = () => {
        const h = Buffer.from(host);
        socket.write(Buffer.concat([
          Buffer.from([0x05, 0x01, 0x00, 0x03, h.length]),
          h,
          Buffer.from([port >> 8, port & 0xFF]),
        ]));
        socket.once('data', (r) => r[1] === 0x00 ? resolve() : reject(new Error(`socks5 rep=${r[1]}`)));
      };

      if (reply[1] === 0x02 && useAuth) {
        const u = Buffer.from(user!);
        const p = Buffer.from(pass!);
        socket.write(Buffer.concat([Buffer.from([0x01, u.length]), u, Buffer.from([p.length]), p]));
        socket.once('data', (a) => a[1] === 0x00 ? sendConnect() : reject(new Error('socks5 auth failed')));
      } else {
        sendConnect();
      }
    });
  });
}
