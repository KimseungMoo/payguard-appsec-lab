import { EventEmitter } from 'node:events';

export type DefenseMode = 'v0.1-vulnerable' | 'v0.2-waf-only' | 'v0.3-patched';

export interface User {
  id: string;
  username: string;
  role: 'customer' | 'attacker';
  token: string;
}

export interface Order {
  id: number;
  userId: string;
  ownerName: string;
  item: string;
  amount: number;
  cardLast4: string;
  shippingAddress: string;
  status: 'PAID' | 'CANCELLED';
}

export interface TrafficEvent {
  id: string;
  timestamp: string;
  actor: string;
  actorType: 'normal' | 'attacker';
  scenario: 'NORMAL_TRAFFIC' | 'BOLA_IDOR' | 'SQL_INJECTION' | 'XSS_TOKEN' | 'RACE_COUPON' | 'CRED_STUFFING';
  method: string;
  path: string;
  payloadSummary: string;
  defenseMode: DefenseMode;
  wafAction: 'PASS' | 'BLOCKED' | 'FALSE_POSITIVE';
  appAction: 'ALLOWED' | 'EXPLOITED' | 'BLOCKED_GUARD' | 'SKIPPED';
  statusCode: number;
  latencyMs: number;
  impactDelta: {
    leakedOrders: number;
    couponLossKrw: number;
    stolenTokens: number;
    falsePositives: number;
  };
  detail: string;
}

export interface TelemetryMetrics {
  normalTotal: number;
  normalPassed: number;
  attackTotal: number;
  attackBlocked: number;
  totalLeakedOrders: number;
}

const EMPTY_METRICS = (): TelemetryMetrics => ({
  normalTotal: 0,
  normalPassed: 0,
  attackTotal: 0,
  attackBlocked: 0,
  totalLeakedOrders: 0,
});

export const telemetryEmitter = new EventEmitter();

export class CommerceStore {
  public defenseMode: DefenseMode = 'v0.1-vulnerable';

  public users: User[] = [
    { id: 'u-alice', username: 'alice_kim', role: 'customer', token: 'tok_alice_101' },
    { id: 'u-bob', username: 'bob_lee', role: 'customer', token: 'tok_bob_102' },
    { id: 'u-charlie', username: 'charlie_park', role: 'customer', token: 'tok_charlie_103' },
    { id: 'u-mallory', username: 'mallory_sec', role: 'attacker', token: 'tok_mallory_999' },
  ];

  public orders: Order[] = [];
  public events: TrafficEvent[] = [];
  public metrics: TelemetryMetrics = EMPTY_METRICS();

  constructor() {
    this.reset();
  }

  reset() {
    this.orders = [
      {
        id: 1001,
        userId: 'u-alice',
        ownerName: 'alice_kim',
        item: 'MacBook Air M3 15"',
        amount: 1890000,
        cardLast4: '4242',
        shippingAddress: '서울시 강남구 테헤란로 152, 12층',
        status: 'PAID',
      },
      {
        id: 1002,
        userId: 'u-bob',
        ownerName: 'bob_lee',
        item: 'Sony WH-1000XM5',
        amount: 429000,
        cardLast4: '8819',
        shippingAddress: '경기도 성남시 분당구 판교역로 235',
        status: 'PAID',
      },
      {
        id: 1003,
        userId: 'u-charlie',
        ownerName: 'charlie_park',
        item: 'iPad Pro 11" 256GB',
        amount: 1490000,
        cardLast4: '1094',
        shippingAddress: '서울시 마포구 월드컵북로 396',
        status: 'PAID',
      },
      {
        id: 1004,
        userId: 'u-alice',
        ownerName: 'alice_kim',
        item: 'Apple Watch Series 10',
        amount: 599000,
        cardLast4: '4242',
        shippingAddress: '서울시 강남구 테헤란로 152, 12층',
        status: 'PAID',
      },
      {
        id: 1005,
        userId: 'u-mallory',
        ownerName: 'mallory_sec',
        item: 'USB-C Cable 1m',
        amount: 19000,
        cardLast4: '6660',
        shippingAddress: '서울시 용산구 한강대로 100',
        status: 'PAID',
      },
    ];
    this.events = [];
    this.metrics = EMPTY_METRICS();
  }

  findUserByToken(authHeader?: string): User | undefined {
    if (!authHeader?.startsWith('Bearer ')) return undefined;
    const token = authHeader.slice('Bearer '.length).trim();
    return this.users.find((u) => u.token === token);
  }

  getOrderById(id: number): Order | undefined {
    return this.orders.find((o) => o.id === id);
  }

  recordEvent(ev: Omit<TrafficEvent, 'id' | 'timestamp' | 'defenseMode'>): TrafficEvent {
    const full: TrafficEvent = {
      ...ev,
      id: `ev_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      timestamp: new Date().toISOString(),
      defenseMode: this.defenseMode,
    };
    this.events.unshift(full);
    if (this.events.length > 200) this.events.pop();

    // 슬라이딩 윈도우(200건)와 분리해 누적 지표를 갱신
    if (full.actorType === 'normal') {
      this.metrics.normalTotal += 1;
      if (full.statusCode === 200) this.metrics.normalPassed += 1;
    } else {
      this.metrics.attackTotal += 1;
      if (full.appAction === 'BLOCKED_GUARD' || full.wafAction === 'BLOCKED') {
        this.metrics.attackBlocked += 1;
      }
    }
    this.metrics.totalLeakedOrders += full.impactDelta.leakedOrders;

    telemetryEmitter.emit('traffic', full);
    return full;
  }
}

export const store = new CommerceStore();
