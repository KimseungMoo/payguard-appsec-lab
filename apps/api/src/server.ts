import express, { Request, Response } from 'express';
import cors from 'cors';
import { store, telemetryEmitter, DefenseMode, TrafficEvent } from './store.js';
import { ordersRouter } from './routes/orders.js';

const app = express();
app.use(cors());
app.use(express.json());

// 1. 실전 API 라우트 (Module 1: Orders BOLA/IDOR)
app.use('/api/orders', ordersRouter);

// 2. 관제 콘솔용 상태 조회 & 방어 모드 전환 API
app.get('/api/simulation/state', (_req: Request, res: Response) => {
  res.json({
    defenseMode: store.defenseMode,
    recentEvents: store.events.slice(0, 60),
    ordersCount: store.orders.length,
  });
});

app.post('/api/simulation/mode', (req: Request, res: Response) => {
  const mode = req.body?.mode as DefenseMode;
  if (!['v0.1-vulnerable', 'v0.2-waf-only', 'v0.3-patched'].includes(mode)) {
    return res.status(400).json({ error: 'Invalid defenseMode' });
  }
  store.defenseMode = mode;
  store.reset();
  return res.json({ defenseMode: store.defenseMode, message: `Switched to ${mode}` });
});

// 3. SSE 실시간 트래픽 스트림 (React 콘솔 Live Mode 연동)
app.get('/api/telemetry/stream', (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const onTraffic = (ev: TrafficEvent) => {
    res.write(`data: ${JSON.stringify(ev)}\n\n`);
  };

  telemetryEmitter.on('traffic', onTraffic);
  req.on('close', () => {
    telemetryEmitter.off('traffic', onTraffic);
  });
});

const PORT = Number(process.env.PORT || 4000);
app.listen(PORT, () => {
  console.log(`[PayGuard API] Listening on http://localhost:${PORT} (mode: ${store.defenseMode})`);
});
