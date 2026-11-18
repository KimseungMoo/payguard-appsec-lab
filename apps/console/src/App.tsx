import React, { useEffect, useRef, useState } from 'react';

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

// 혼합 트래픽 시퀀스: 다수의 일반 유저 요청 속에 기습적으로 끼어드는 해커의 IDOR 순회 공격
const SIMULATION_STEPS = [
  { actor: 'alice_kim', token: 'tok_alice_101', orderId: 1001, isAttack: false },
  { actor: 'bob_lee', token: 'tok_bob_102', orderId: 1002, isAttack: false },
  { actor: 'mallory_sec', token: 'tok_mallory_999', orderId: 1001, isAttack: true },
  { actor: 'charlie_park', token: 'tok_charlie_103', orderId: 1003, isAttack: false },
  { actor: 'mallory_sec', token: 'tok_mallory_999', orderId: 1002, isAttack: true },
  { actor: 'alice_kim', token: 'tok_alice_101', orderId: 1004, isAttack: false },
  { actor: 'mallory_sec', token: 'tok_mallory_999', orderId: 1003, isAttack: true },
  { actor: 'bob_lee', token: 'tok_bob_102', orderId: 1002, isAttack: false },
  { actor: 'mallory_sec', token: 'tok_mallory_999', orderId: 1004, isAttack: true },
];

export function App() {
  const [defenseMode, setDefenseMode] = useState<DefenseMode>('v0.1-vulnerable');
  const [isLiveApiConnected, setIsLiveApiConnected] = useState<boolean>(false);
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [events, setEvents] = useState<TrafficEvent[]>([]);
  const [selectedEvent, setSelectedEvent] = useState<TrafficEvent | null>(null);
  const stepIndexRef = useRef(0);

  // 로컬 API(SSE) 연결 시도 — 연결 실패 시 GitHub Pages 정적 리플레이 모드로 자동 동작
  useEffect(() => {
    let es: EventSource | null = null;
    fetch(`${API_BASE}/api/simulation/state`)
      .then((r) => r.json())
      .then((data) => {
        setIsLiveApiConnected(true);
        setDefenseMode(data.defenseMode);
        if (Array.isArray(data.recentEvents) && data.recentEvents.length > 0) {
          setEvents(data.recentEvents);
          setSelectedEvent(data.recentEvents[0]);
        }
        es = new EventSource(`${API_BASE}/api/telemetry/stream`);
        es.onmessage = (msg) => {
          const ev = JSON.parse(msg.data) as TrafficEvent;
          setEvents((prev) => {
            const next = [ev, ...prev].slice(0, 80);
            return next;
          });
          setSelectedEvent((curr) => curr ?? ev);
        };
      })
      .catch(() => {
        setIsLiveApiConnected(false);
      });

    return () => {
      es?.close();
    };
  }, []);

  const switchMode = async (mode: DefenseMode) => {
    setDefenseMode(mode);
    setEvents([]);
    setSelectedEvent(null);
    stepIndexRef.current = 0;
    if (isLiveApiConnected) {
      await fetch(`${API_BASE}/api/simulation/mode`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
      });
    }
  };

  // 1스텝 트래픽 발생 (Live API 연결 시 실제 HTTP 호출, 오프라인/Pages 시 결정적 시뮬레이션 생성)
  const fireNextTrafficStep = async () => {
    const step = SIMULATION_STEPS[stepIndexRef.current % SIMULATION_STEPS.length];
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
      latencyMs: Math.floor(Math.random() * 5) + 3,
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

    setEvents((prev) => [synthetic, ...prev].slice(0, 80));
    setSelectedEvent((curr) => curr ?? synthetic);
  };

  useEffect(() => {
    if (!isRunning) return;
    const timer = setInterval(() => {
      fireNextTrafficStep();
    }, 650);
    return () => clearInterval(timer);
  }, [isRunning, defenseMode, isLiveApiConnected]);

  // 집계 지표 계산
  const normalEvents = events.filter((e) => e.actorType === 'normal');
  const normalPassed = normalEvents.filter((e) => e.statusCode === 200).length;
  const attackEvents = events.filter((e) => e.actorType === 'attacker');
  const attackExploited = attackEvents.filter((e) => e.appAction === 'EXPLOITED').length;
  const attackBlocked = attackEvents.filter((e) => e.appAction === 'BLOCKED_GUARD' || e.wafAction === 'BLOCKED').length;
  const totalLeakedOrders = events.reduce((acc, e) => acc + e.impactDelta.leakedOrders, 0);

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
            onClick={() => fireNextTrafficStep()}
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
          value={normalEvents.length ? `${Math.round((normalPassed / normalEvents.length) * 100)}%` : '100%'}
          sub={`${normalPassed} / ${normalEvents.length} 정상 요청 성공`}
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
          value={`${attackBlocked}건 (${attackEvents.length ? Math.round((attackBlocked / attackEvents.length) * 100) : 0}%)`}
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

      {/* Main Split View: Left Traffic Stream / Right Inspector & Code Diff */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.15fr 1fr', gap: 20 }}>
        {/* Left: Real-Time Mixed Traffic Stream */}
        <section
          style={{
            background: '#111827',
            border: '1px solid #1f2937',
            borderRadius: 10,
            padding: 16,
            height: 540,
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
                  <span style={{ fontSize: 11, color: '#64748b', whiteSpace: 'nowrap' }}>
                    {ev.latencyMs}ms
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
            height: 540,
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
