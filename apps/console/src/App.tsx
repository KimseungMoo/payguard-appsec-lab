import React, { useEffect, useRef, useState } from 'react';
import { TacticalArena } from './components/TacticalArena';

export type DefenseMode = 'v0.1-vulnerable' | 'v0.2-waf-only' | 'v0.3-patched';

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

const API_BASE = 'http://localhost:4000';

interface TrafficStep {
  actor: string;
  token: string;
  orderId: number;
  isAttack: boolean;
}

const NORMAL_PROFILES: TrafficStep[] = [
  { actor: 'alice_kim', token: 'tok_alice_101', orderId: 1001, isAttack: false },
  { actor: 'alice_kim', token: 'tok_alice_101', orderId: 1004, isAttack: false },
  { actor: 'bob_lee', token: 'tok_bob_102', orderId: 1002, isAttack: false },
  { actor: 'charlie_park', token: 'tok_charlie_103', orderId: 1003, isAttack: false },
];

const ATTACK_TARGET_ORDERS = [1001, 1002, 1003, 1004];

// 실제 웹 트래픽과 유사한 포아송 분포 기반 지터(최소/최대 클램핑)
function sampleExponentialDelay(meanMs: number, minMs: number, maxMs: number): number {
  const raw = -Math.log(1 - Math.random()) * meanMs;
  return Math.round(Math.min(maxMs, Math.max(minMs, raw)));
}

function randomBetween(minMs: number, maxMs: number): number {
  return Math.round(minMs + Math.random() * (maxMs - minMs));
}

function formatTimeMs(iso: string): string {
  const d = new Date(iso);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  const ms = String(d.getMilliseconds()).padStart(3, '0');
  return `${hh}:${mm}:${ss}.${ms}`;
}

export interface TelemetryMetrics {
  normalTotal: number;
  normalPassed: number;
  attackTotal: number;
  attackBlocked: number;
  totalLeakedOrders: number;
}

const EMPTY_METRICS: TelemetryMetrics = {
  normalTotal: 0,
  normalPassed: 0,
  attackTotal: 0,
  attackBlocked: 0,
  totalLeakedOrders: 0,
};

function applyEventToMetrics(prev: TelemetryMetrics, ev: TrafficEvent): TelemetryMetrics {
  const isNormal = ev.actorType === 'normal';
  const isBlocked = ev.appAction === 'BLOCKED_GUARD' || ev.wafAction === 'BLOCKED';
  return {
    normalTotal: prev.normalTotal + (isNormal ? 1 : 0),
    normalPassed: prev.normalPassed + (isNormal && ev.statusCode === 200 ? 1 : 0),
    attackTotal: prev.attackTotal + (!isNormal ? 1 : 0),
    attackBlocked: prev.attackBlocked + (!isNormal && isBlocked ? 1 : 0),
    totalLeakedOrders: prev.totalLeakedOrders + ev.impactDelta.leakedOrders,
  };
}

export function App() {
  const [defenseMode, setDefenseMode] = useState<DefenseMode>('v0.1-vulnerable');
  const [isLiveApiConnected, setIsLiveApiConnected] = useState<boolean>(false);
  const [isRunning, setIsRunning] = useState<boolean>(true);
  const [events, setEvents] = useState<TrafficEvent[]>([]);
  const [metrics, setMetrics] = useState<TelemetryMetrics>(EMPTY_METRICS);
  const [selectedEvent, setSelectedEvent] = useState<TrafficEvent | null>(null);
  const stepIndexRef = useRef(0);
  const seenEventIdsRef = useRef<Set<string>>(new Set());

  const pushTelemetryEvent = (ev: TrafficEvent) => {
    if (seenEventIdsRef.current.has(ev.id)) return;
    seenEventIdsRef.current.add(ev.id);
    setEvents((prev) => [ev, ...prev].slice(0, 80));
    setMetrics((prev) => applyEventToMetrics(prev, ev));
    setSelectedEvent((curr) => curr ?? ev);
  };

  // 로컬 API(SSE) 연결 시도 — 연결 실패 시 GitHub Pages 정적 리플레이 모드로 자동 동작
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    let es: EventSource | null = null;
    fetch(`${API_BASE}/api/simulation/state`, { signal: controller.signal })
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        setIsLiveApiConnected(true);
        setDefenseMode(data.defenseMode);
        if (data.metrics) {
          setMetrics(data.metrics);
        }
        if (Array.isArray(data.recentEvents) && data.recentEvents.length > 0) {
          seenEventIdsRef.current = new Set(data.recentEvents.map((e: TrafficEvent) => e.id));
          setEvents(data.recentEvents);
          setSelectedEvent(data.recentEvents[0]);
        } else {
          seenEventIdsRef.current.clear();
        }
        es = new EventSource(`${API_BASE}/api/telemetry/stream`);
        es.onmessage = (msg) => {
          if (cancelled) return;
          const ev = JSON.parse(msg.data) as TrafficEvent;
          pushTelemetryEvent(ev);
        };
      })
      .catch(() => {
        if (!cancelled) {
          setIsLiveApiConnected(false);
        }
      });

    return () => {
      cancelled = true;
      controller.abort();
      es?.close();
    };
  }, []);

  const switchMode = async (mode: DefenseMode) => {
    setDefenseMode(mode);
    setEvents([]);
    setMetrics(EMPTY_METRICS);
    setSelectedEvent(null);
    stepIndexRef.current = 0;
    seenEventIdsRef.current.clear();
    if (isLiveApiConnected) {
      await fetch(`${API_BASE}/api/simulation/mode`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
      });
    }
  };

  const dispatchTrafficStep = async (step: TrafficStep) => {
    stepIndexRef.current += 1;

    if (isLiveApiConnected) {
      await fetch(`${API_BASE}/api/orders/${step.orderId}`, {
        headers: { Authorization: `Bearer ${step.token}` },
      });
      return;
    }

    // Static Replay fallback (GitHub Pages 무서버 동작용)
    const isPatched = defenseMode === 'v0.3-patched';
    const isExploited = step.isAttack && !isPatched;
    const isBlocked = step.isAttack && isPatched;

    const synthetic: TrafficEvent = {
      id: `sim_${Date.now()}_${stepIndexRef.current}`,
      timestamp: new Date().toISOString(),
      actor: step.actor,
      actorType: step.isAttack ? 'attacker' : 'normal',
      scenario: step.isAttack ? 'BOLA_IDOR' : 'NORMAL_TRAFFIC',
      method: 'GET',
      path: `/api/orders/${step.orderId}`,
      payloadSummary: `Bearer ${step.token} -> order #${step.orderId}`,
      defenseMode,
      wafAction: 'PASS',
      appAction: isExploited ? 'EXPLOITED' : isBlocked ? 'BLOCKED_GUARD' : 'ALLOWED',
      statusCode: isBlocked ? 404 : 200,
      latencyMs: Math.floor(Math.random() * 6) + 2,
      impactDelta: {
        leakedOrders: isExploited ? 1 : 0,
        couponLossKrw: 0,
        stolenTokens: 0,
        falsePositives: 0,
      },
      detail: isExploited
        ? `PII Leaked! Attacker ${step.actor} accessed order #${step.orderId} without ownership check`
        : isBlocked
        ? `Blocked by Ownership Guard: ${step.actor} denied access to order #${step.orderId}`
        : `Normal order lookup by owner ${step.actor} (#${step.orderId})`,
    };

    pushTelemetryEvent(synthetic);
  };

  const fireRandomManualStep = () => {
    const pickAttack = Math.random() < 0.35;
    if (pickAttack) {
      const targetOrder = ATTACK_TARGET_ORDERS[Math.floor(Math.random() * ATTACK_TARGET_ORDERS.length)];
      void dispatchTrafficStep({
        actor: 'mallory_sec',
        token: 'tok_mallory_999',
        orderId: targetOrder,
        isAttack: true,
      });
    } else {
      const normal = NORMAL_PROFILES[Math.floor(Math.random() * NORMAL_PROFILES.length)];
      void dispatchTrafficStep(normal);
    }
  };

  const triggerAttackBurst = async () => {
    const startOffset = Math.floor(Math.random() * ATTACK_TARGET_ORDERS.length);
    for (let i = 0; i < 4; i++) {
      const orderId = ATTACK_TARGET_ORDERS[(startOffset + i) % ATTACK_TARGET_ORDERS.length];
      void dispatchTrafficStep({
        actor: 'mallory_sec',
        token: 'tok_mallory_999',
        orderId,
        isAttack: true,
      });
      if (i < 3) {
        await new Promise((r) => setTimeout(r, randomBetween(60, 140)));
      }
    }
  };

  // 독립적인 2개의 비동기 루프: (1) 불규칙한 정상 유저 트래픽 (2) 간헐적 단발 프로브 또는 기습 연타 공격 버스트
  useEffect(() => {
    if (!isRunning) return;
    let cancelled = false;
    let normalTimer: ReturnType<typeof setTimeout> | null = null;
    let attackTimer: ReturnType<typeof setTimeout> | null = null;

    const scheduleNormalUser = () => {
      if (cancelled) return;
      // 20% 확률로 동시 접속자 겹침(70~160ms), 평소엔 포아송 분포 기반 160~1500ms 랜덤 간격
      const delay =
        Math.random() < 0.2
          ? randomBetween(70, 160)
          : sampleExponentialDelay(520, 160, 1500);

      normalTimer = setTimeout(() => {
        if (cancelled) return;
        const profile = NORMAL_PROFILES[Math.floor(Math.random() * NORMAL_PROFILES.length)];
        void dispatchTrafficStep(profile);
        scheduleNormalUser();
      }, delay);
    };

    const scheduleAttacker = () => {
      if (cancelled) return;
      // 공격자는 1.4초 ~ 4.4초 불규칙하게 잠복하다가 기습 요청 발사
      const cooldown = randomBetween(1400, 4400);
      attackTimer = setTimeout(async () => {
        if (cancelled) return;
        const isBurst = Math.random() < 0.6; // 60% 확률로 2~4건 연속 순회(Enumeration Burst), 40% 단발 프로브
        const burstCount = isBurst ? Math.floor(Math.random() * 3) + 2 : 1;
        const startOffset = Math.floor(Math.random() * ATTACK_TARGET_ORDERS.length);

        for (let i = 0; i < burstCount; i++) {
          if (cancelled) break;
          const orderId = ATTACK_TARGET_ORDERS[(startOffset + i) % ATTACK_TARGET_ORDERS.length];
          void dispatchTrafficStep({
            actor: 'mallory_sec',
            token: 'tok_mallory_999',
            orderId,
            isAttack: true,
          });
          if (i < burstCount - 1) {
            await new Promise((r) => setTimeout(r, randomBetween(65, 175)));
          }
        }
        scheduleAttacker();
      }, cooldown);
    };

    scheduleNormalUser();
    scheduleAttacker();

    return () => {
      cancelled = true;
      if (normalTimer) clearTimeout(normalTimer);
      if (attackTimer) clearTimeout(attackTimer);
    };
  }, [isRunning, defenseMode, isLiveApiConnected]);

  // 누적 지표(metrics state) 기반 표시값 계산 (80건 화면 버퍼와 분리)
  const { normalTotal, normalPassed, attackTotal, attackBlocked, totalLeakedOrders } = metrics;

  return (
    <div style={{ maxWidth: 1400, margin: '0 auto', padding: '20px 24px' }}>
      {/* Header */}
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          borderBottom: '1px solid #1e293b',
          paddingBottom: 16,
          marginBottom: 20,
          flexWrap: 'wrap',
          gap: 12,
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 20, fontWeight: 700, color: '#f8fafc' }}>
              🛡️ PayGuard AppSec Replay Console
            </span>
            <span
              style={{
                fontSize: 12,
                padding: '2px 8px',
                borderRadius: 999,
                background: isLiveApiConnected ? '#064e3b' : '#1e3a8a',
                color: isLiveApiConnected ? '#34d399' : '#93c5fd',
                fontWeight: 600,
              }}
            >
              {isLiveApiConnected ? '● LIVE API CONNECTED (:4000)' : '● STATIC REPLAY MODE'}
            </span>
          </div>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: '#94a3b8' }}>
            동시 다발적 정상 사용자 트래픽 속 기습 공격(Module 1: BOLA/IDOR) 시뮬레이션 및 방어 계층 검증
          </p>
        </div>

        {/* Mode Selector & Controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {(['v0.1-vulnerable', 'v0.2-waf-only', 'v0.3-patched'] as DefenseMode[]).map((m) => {
            const active = defenseMode === m;
            return (
              <button
                key={m}
                onClick={() => switchMode(m)}
                style={{
                  padding: '8px 12px',
                  borderRadius: 6,
                  border: active ? '1px solid #38bdf8' : '1px solid #334155',
                  background: active ? '#0284c7' : '#0f172a',
                  color: '#f8fafc',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                {m === 'v0.1-vulnerable' && '🔴 v0.1 Vulnerable'}
                {m === 'v0.2-waf-only' && '🟡 v0.2 Edge WAF Only'}
                {m === 'v0.3-patched' && '🟢 v0.3 Code Patched'}
              </button>
            );
          })}

          <button
            onClick={() => setIsRunning((r) => !r)}
            style={{
              padding: '8px 16px',
              borderRadius: 6,
              border: 'none',
              background: isRunning ? '#dc2626' : '#10b981',
              color: '#ffffff',
              fontSize: 13,
              fontWeight: 700,
              cursor: 'pointer',
              marginLeft: 8,
            }}
          >
            {isRunning ? '⏸ 일시정지' : '▶ 혼합 트래픽 시뮬레이션 시작'}
          </button>

          <button
            onClick={fireRandomManualStep}
            style={{
              padding: '8px 12px',
              borderRadius: 6,
              border: '1px solid #475569',
              background: '#1e293b',
              color: '#e2e8f0',
              fontSize: 12,
              cursor: 'pointer',
            }}
          >
            +1 스텝 수동 실행
          </button>
        </div>
      </header>

      {/* Top Metrics & Defense Funnel */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: 14,
          marginBottom: 20,
        }}
      >
        <MetricCard
          title="정상 유저 가용성 (Availability)"
          value={normalTotal ? `${Math.round((normalPassed / normalTotal) * 100)}%` : '100%'}
          sub={`${normalPassed} / ${normalTotal} 정상 요청 성공`}
          color="#34d399"
        />
        <MetricCard
          title="Layer 1: Edge WAF 차단"
          value="0건 (0%)"
          sub="IDOR는 정상 HTTP 문법이라 WAF 통과"
          color="#fbbf24"
        />
        <MetricCard
          title="Layer 2: AppSec Guard 차단"
          value={`${attackBlocked}건 (${attackTotal ? Math.round((attackBlocked / attackTotal) * 100) : 0}%)`}
          sub={defenseMode === 'v0.3-patched' ? '소유권 인가 검증 작동 중' : '소유권 검증 누락 (취약)'}
          color="#38bdf8"
        />
        <MetricCard
          title="누적 피해: 유출된 타인 주문서"
          value={`${totalLeakedOrders}건`}
          sub={totalLeakedOrders > 0 ? '🚨 카드뒷자리·배송지 유출 발생!' : '✅ 피해 없음 (0건)'}
          color={totalLeakedOrders > 0 ? '#f87171' : '#34d399'}
        />
      </div>

      {/* Tactical Live Traffic Arena */}
      <TacticalArena
        defenseMode={defenseMode}
        latestEvent={events[0] ?? null}
        totalLeakedOrders={totalLeakedOrders}
        normalTotal={normalTotal}
        attackBlocked={attackBlocked}
        attackTotal={attackTotal}
        onSelectEvent={(ev) => setSelectedEvent(ev)}
        onTriggerBurst={triggerAttackBurst}
      />

      {/* Main Split View: Left Traffic Stream / Right Inspector & Code Diff */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.15fr 1fr', gap: 20 }}>
        {/* Left: Real-Time Mixed Traffic Stream */}
        <section
          style={{
            background: '#111827',
            border: '1px solid #1f2937',
            borderRadius: 10,
            padding: 16,
            height: 410,
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
            <strong style={{ fontSize: 14, color: '#f3f4f6' }}>
              📡 실시간 혼합 트래픽 스트림 (Normal Users + Attacker Bursts)
            </strong>
            <span style={{ fontSize: 12, color: '#9ca3af' }}>클릭하여 상세 패킷·코드 분석</span>
          </div>

          <div style={{ overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {events.length === 0 && (
              <div style={{ color: '#64748b', fontSize: 13, padding: 32, textAlign: 'center' }}>
                우측 상단의 <b>[▶ 혼합 트래픽 시뮬레이션 시작]</b> 버튼을 누르면<br />
                일반 사용자 요청과 해커의 기습 IDOR 공격이 실시간으로 흘러갑니다.
              </div>
            )}

            {events.map((ev) => {
              const isSelected = selectedEvent?.id === ev.id;
              const badgeColor =
                ev.appAction === 'EXPLOITED'
                  ? '#ef4444'
                  : ev.appAction === 'BLOCKED_GUARD'
                  ? '#3b82f6'
                  : '#10b981';
              const badgeText =
                ev.appAction === 'EXPLOITED'
                  ? '🔴 EXPLOITED (200)'
                  : ev.appAction === 'BLOCKED_GUARD'
                  ? '🛡️ BLOCKED (404)'
                  : '🟢 NORMAL (200)';

              return (
                <div
                  key={ev.id}
                  onClick={() => setSelectedEvent(ev)}
                  style={{
                    padding: '10px 12px',
                    borderRadius: 8,
                    background: isSelected ? '#1e293b' : '#0f172a',
                    border: isSelected ? '1px solid #38bdf8' : '1px solid #1e293b',
                    cursor: 'pointer',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: 10,
                  }}
                >
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 700,
                          padding: '2px 6px',
                          borderRadius: 4,
                          background: badgeColor + '22',
                          color: badgeColor,
                        }}
                      >
                        {badgeText}
                      </span>
                      <code style={{ fontSize: 13, color: '#f8fafc', fontWeight: 600 }}>
                        {ev.method} {ev.path}
                      </code>
                      <span style={{ fontSize: 12, color: '#94a3b8' }}>by {ev.actor}</span>
                    </div>
                    <div style={{ fontSize: 12, color: '#cbd5e1', marginTop: 4 }}>{ev.detail}</div>
                  </div>
                  <span style={{ fontSize: 11, color: '#64748b', whiteSpace: 'nowrap', textAlign: 'right' }}>
                    <div>{formatTimeMs(ev.timestamp)}</div>
                    <div>{ev.latencyMs}ms</div>
                  </span>
                </div>
              );
            })}
          </div>
        </section>

        {/* Right: Case Inspector & Code Diff */}
        <section
          style={{
            background: '#111827',
            border: '1px solid #1f2937',
            borderRadius: 10,
            padding: 16,
            height: 410,
            overflowY: 'auto',
          }}
        >
          <strong style={{ fontSize: 14, color: '#f3f4f6', display: 'block', marginBottom: 12 }}>
            🔍 케이스 인스펙터 & 방어 코드 비교 (Module 1: BOLA / IDOR)
          </strong>

          {selectedEvent ? (
            <div style={{ marginBottom: 16, padding: 12, background: '#0f172a', borderRadius: 8, fontSize: 12 }}>
              <div style={{ color: '#38bdf8', fontWeight: 700, marginBottom: 6 }}>
                선택된 이벤트: {selectedEvent.method} {selectedEvent.path} ({selectedEvent.actor})
              </div>
              <div style={{ color: '#cbd5e1', lineHeight: 1.6 }}>
                • <b>요청 헤더 요약</b>: <code>{selectedEvent.payloadSummary}</code>
                <br />• <b>Edge WAF 판정</b>: <code>{selectedEvent.wafAction}</code> (문법적으로 정상인 조회 요청이므로 WAF는 통과시킴)
                <br />• <b>AppSec 최종 결과</b>: <code>{selectedEvent.appAction}</code> (HTTP {selectedEvent.statusCode})
              </div>
            </div>
          ) : null}

          <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 8 }}>
            <b>핵심 원인 & 해결 (apps/api/src/routes/orders.ts)</b>: 인증(로그인 여부)만 체크하고 객체 소유권(<code>order.userId === user.id</code>)을 확인하지 않아 발생.
          </div>

          <pre
            style={{
              background: '#090d16',
              padding: 14,
              borderRadius: 8,
              border: '1px solid #1e293b',
              fontSize: 12,
              lineHeight: 1.55,
              overflowX: 'auto',
              color: '#e2e8f0',
              margin: 0,
            }}
          >
{`// apps/api/src/routes/orders.ts
ordersRouter.get('/:orderId', (req, res) => {
  const user = store.findUserByToken(req.headers.authorization);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  const order = store.getOrderById(Number(req.params.orderId));
  if (!order) return res.status(404).json({ error: 'Order not found' });

- // [v0.1 Vulnerable] 로그인만 되어 있으면 남의 주문서도 그대로 반환!
- return res.json(order);

+ // [v0.3 Patched] 객체 수준 소유권 인가(Object-Level Authorization) 검증
+ // 존재 여부 열거(Enumeration) 방지를 위해 403 대신 404 반환
+ if (order.userId !== user.id) {
+   return res.status(404).json({ error: 'Order not found' });
+ }
+ return res.json(order);
});`}
          </pre>
        </section>
      </div>
    </div>
  );
}

function MetricCard({
  title,
  value,
  sub,
  color,
}: {
  title: string;
  value: string;
  sub: string;
  color: string;
}) {
  return (
    <div
      style={{
        background: '#111827',
        border: '1px solid #1f2937',
        borderRadius: 10,
        padding: '14px 16px',
      }}
    >
      <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 6 }}>{title}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color }}>{value}</div>
      <div style={{ fontSize: 11, color: '#cbd5e1', marginTop: 4 }}>{sub}</div>
    </div>
  );
}
