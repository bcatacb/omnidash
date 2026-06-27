/**
 * Realtime SSE hub for the Discord Unibox demo.
 *
 * One endpoint: GET /api/realtime. Each connected client gets a long-lived
 * text/event-stream response. We subscribe to discord-mock's event bus once
 * per client and tear down the subscription on disconnect.
 *
 * No external deps — plain Express response writes per the SSE spec.
 *   id: <numeric>\n
 *   event: <type>\n
 *   data: <json>\n\n
 */

import type { Request, Response } from 'express';
import { EventEmitter } from 'node:events';
import { subscribe } from './discord-mock';
import type { RealtimeEvent } from './api-types';

let sequence = 0;

const writeSseFrame = (res: Response, event: RealtimeEvent) => {
  sequence += 1;
  const payload = JSON.stringify(event);
  res.write(`id: ${sequence}\n`);
  res.write(`event: ${event.type}\n`);
  res.write(`data: ${payload}\n\n`);
};

// Side channel for events that don't originate in discord-mock (e.g. QR-login events
// from discord-remote-auth). Anything written here is fanned out to every connected
// SSE client alongside the mock-driven stream.
const externalBus = new EventEmitter();
export const publishExternalEvent = (event: RealtimeEvent) => externalBus.emit('evt', event);

export const sseHandler = (req: Request, res: Response): void => {
  // Standard SSE headers
  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // disable nginx buffering if proxied
  res.flushHeaders?.();

  // Initial hello — lets clients confirm the stream is alive.
  res.write(`retry: 5000\n`);
  res.write(`event: hello\n`);
  res.write(`data: ${JSON.stringify({ ts: new Date().toISOString() })}\n\n`);

  const onEvent = (event: RealtimeEvent) => {
    try { writeSseFrame(res, event); } catch (err) {
      console.warn('[realtime] write failed, closing subscription:', (err as Error)?.message);
      cleanup();
    }
  };
  const unsubscribeMock = subscribe(onEvent);
  externalBus.on('evt', onEvent);

  // Heartbeat every 25s so intermediate proxies don't kill idle streams.
  const heartbeat = setInterval(() => {
    try { res.write(`: ping ${Date.now()}\n\n`); } catch { cleanup(); }
  }, 25_000);

  let closed = false;
  const cleanup = () => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    try { unsubscribeMock(); } catch { /* noop */ }
    try { externalBus.off('evt', onEvent); } catch { /* noop */ }
    try { res.end(); } catch { /* noop */ }
  };

  req.on('close', cleanup);
  req.on('aborted', cleanup);
  res.on('close', cleanup);
  res.on('error', cleanup);
};
