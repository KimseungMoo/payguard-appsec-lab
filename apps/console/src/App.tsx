import React, { useEffect, useMemo, useRef, useState } from 'react';
import { IncidentLinks } from './components/IncidentLinks';
import { ServiceEvolutionBar } from './components/ServiceEvolutionBar';
import { StatusBadge } from './components/StatusBadge';
import { StoryView } from './components/StoryView';
import { TacticalArena } from './components/TacticalArena';

export type DefenseMode = 'v0.1-vulnerable' | 'v0.2-waf-only' | 'v0.3-patched';
export type ViewTab = 'console' | 'story';

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

const MODE_STORY: Record<
  DefenseMode,
  { label: string; dotColor: string; badge: string; text: string; accent: string; bg: string; border: string }
> = {
  'v0.1-vulnerable': {
    label: 'v0.1 취약',
    dotColor: '#f43f5e',
    badge: 'STEP 1 · VULNERABLE',
    text: "로그인만 확인하고 '내 주문인지' 검사하지 않아 타인의 영수증·배송지가 그대로 유출됩니다.",
    accent: '#fda4af',
    bg: 'rgba(244, 63, 94, 0.12)',
    border: 'rgba(244, 63, 94, 0.35)',
  },
  'v0.2-waf-only': {
    label: 'v0.2 WAF',
    dotColor: '#f59e0b',
    badge: 'STEP 2 · EDGE WAF ONLY',
    text: '앞단 WAF가 켜져 있어도 정상 HTTP 문법의 타인 주문 조회는 탐지하지 못합니다 (WAF 차단 0%).',
    accent: '#fcd34d',
    bg: 'rgba(245, 158, 11, 0.12)',
    border: 'rgba(245, 158, 11, 0.35)',
  },
  'v0.3-patched': {
    label: 'v0.3 패치',
    dotColor: '#38bdf8',
    badge: 'STEP 3 · CODE PATCHED',
    text: '서버 코드에서 주문 소유자 일치(userId === owner)를 검증해 정상 트래픽은 유지하고 공격만 100% 차단합니다.',
    accent: '#38bdf8',
    bg: 'rgba(56, 189, 248, 0.12)',
    border: 'rgba(56, 189, 248, 0.35)',
  },
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

function readInitialView(): ViewTab {
  if (typeof window === 'undefined') return 'console';
  return new URLSearchParams(window.location.search).get('view') === 'story' ? 'story' : 'console';
}

export function App() {
  const [viewTab, setViewTab] = useState<ViewTab>(readInitialView);
  const [defenseMode, setDefenseMode] = useState<DefenseMode>('v0.1-vulnerable');
  const [isLiveApiConnected, setIsLiveApiConnected] = useState<boolean>(false);
  const [isRunning, setIsRunning] = useState<boolean>(true);
  const [events, setEvents] = useState<TrafficEvent[]>([]);
  const [metrics, setMetrics] = useState<TelemetryMetrics>(EMPTY_METRICS);
  const [selectedEvent, setSelectedEvent] = useState<TrafficEvent | null>(null);
  const [isCompactView, setIsCompactView] = useState<boolean>(false);
  const [demoPhase, setDemoPhase] = useState<'vulnerable' | 'patched' | null>(null);
  const stepIndexRef = useRef(0);
  const seenEventIdsRef = useRef<Set<string>>(new Set());
  const defenseModeRef = useRef<DefenseMode>(defenseMode);
  const isLiveApiConnectedRef = useRef<boolean>(isLiveApiConnected);

  useEffect(() => {
    defenseModeRef.current = defenseMode;
  }, [defenseMode]);

  useEffect(() => {
    isLiveApiConnectedRef.current = isLiveApiConnected;
  }, [isLiveApiConnected]);

  const handleSetViewTab = (next: ViewTab) => {
    setViewTab(next);
    const url = new URL(window.location.href);
    if (next === 'story') {
      url.searchParams.set('view', 'story');
    } else {
      url.searchParams.delete('view');
    }
    window.history.replaceState({}, '', url.toString());
  };

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
    defenseModeRef.current = mode;
    setDefenseMode(mode);
    setEvents([]);
    setMetrics(EMPTY_METRICS);
    setSelectedEvent(null);
    stepIndexRef.current = 0;
    seenEventIdsRef.current.clear();
    if (isLiveApiConnectedRef.current) {
      await fetch(`${API_BASE}/api/simulation/mode`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
      });
    }
  };

  const dispatchTrafficStep = async (step: TrafficStep) => {
    stepIndexRef.current += 1;

    if (isLiveApiConnectedRef.current) {
      await fetch(`${API_BASE}/api/orders/${step.orderId}`, {
        headers: { Authorization: `Bearer ${step.token}` },
      });
      return;
    }

    // Static Replay fallback (GitHub Pages 무서버 동작용)
    const activeMode = defenseModeRef.current;
    const isPatched = activeMode === 'v0.3-patched';
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
      defenseMode: activeMode,
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

  // 12초 Before/After 자동 데모: v0.1 유출(5.5초) -> v0.3 패치 차단(6.5초)
  useEffect(() => {
    if (!demoPhase) return;
    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];

    const runSequence = async () => {
      setIsRunning(true);
      await switchMode('v0.1-vulnerable');
      if (cancelled) return;
      void triggerAttackBurst();

      timers.push(
        setTimeout(() => {
          if (!cancelled) void triggerAttackBurst();
        }, 2600),
      );
      timers.push(
        setTimeout(async () => {
          if (cancelled) return;
          setDemoPhase('patched');
          await switchMode('v0.3-patched');
          if (!cancelled) void triggerAttackBurst();
        }, 5500),
      );
      timers.push(
        setTimeout(() => {
          if (!cancelled) void triggerAttackBurst();
        }, 8400),
      );
      timers.push(
        setTimeout(() => {
          if (!cancelled) setDemoPhase(null);
        }, 12000),
      );
    };

    void runSequence();
    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
    };
  }, [demoPhase !== null]);

  const { normalTotal, normalPassed, attackTotal, attackBlocked, totalLeakedOrders } = metrics;
  const story = MODE_STORY[defenseMode];

  const p95Latency = useMemo(() => {
    if (events.length === 0) return 0;
    const sorted = events.map((e) => e.latencyMs).sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
  }, [events]);

  const normalSparkPoints = useMemo(() => {
    const slice = events.slice(0, 12).reverse();
    if (slice.length < 2) return '2,20 58,20';
    return slice
      .map((e, i) => {
        const x = 2 + (i / (slice.length - 1)) * 56;
        const y = e.actorType === 'normal' ? 7 : 18;
        return `${x.toFixed(1)},${y}`;
      })
      .join(' ');
  }, [events]);

  const guardSparkPoints = useMemo(() => {
    const slice = events.slice(0, 12).reverse();
    if (slice.length < 2) return '2,22 58,22';
    return slice
      .map((e, i) => {
        const x = 2 + (i / (slice.length - 1)) * 56;
        const y = e.appAction === 'BLOCKED_GUARD' ? 5 : e.appAction === 'EXPLOITED' ? 22 : 14;
        return `${x.toFixed(1)},${y}`;
      })
      .join(' ');
  }, [events]);

  const inspectedEvent = selectedEvent ?? events[0] ?? null;

  return (
    <div className={`pg-page${isCompactView ? ' compact' : ''}`}>
      {/* Product Topbar */}
      <header className="pg-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <div
            style={{
              width: 28,
              height: 28,
              borderRadius: 7,
              background: '#6366f1',
              display: 'grid',
              placeItems: 'center',
              color: '#ffffff',
              flexShrink: 0,
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            </svg>
          </div>
          <div>
            <div style={{ fontSize: 15.5, fontWeight: 700, color: '#f8fafc', letterSpacing: '-0.01em' }}>
              PayGuard AppSec Console
            </div>
            <div style={{ fontSize: 11.5, color: '#94a3b8', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <span>Module 1 · BOLA / IDOR · 참고 사례:</span>
              <IncidentLinks />
            </div>
          </div>

          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 11,
              padding: '3px 9px',
              borderRadius: 999,
              border: '1px solid #1e293b',
              background: '#111827',
              color: isLiveApiConnected ? '#34d399' : '#93c5fd',
              fontWeight: 600,
            }}
          >
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: isLiveApiConnected ? '#10b981' : '#38bdf8',
              }}
            />
            {isLiveApiConnected ? 'SANDBOXED · LIVE SSE :4000' : 'SANDBOXED · STATIC REPLAY'}
          </span>
        </div>

        {/* Fixed Top-Right Utility Controls (never shift across view tabs) */}
        <div className="pg-header-actions">
          {/* Console / Story Toggle */}
          <div
            style={{
              display: 'inline-flex',
              padding: 3,
              borderRadius: 8,
              background: '#0f172a',
              border: '1px solid #1e293b',
              gap: 2,
            }}
          >
            {(['console', 'story'] as ViewTab[]).map((tab) => {
              const active = viewTab === tab;
              return (
                <button
                  key={tab}
                  type="button"
                  onClick={() => handleSetViewTab(tab)}
                  style={{
                    border: active ? '1px solid #4f46e5' : '1px solid transparent',
                    background: active ? '#1e1b4b' : 'transparent',
                    color: active ? '#e0e7ff' : '#94a3b8',
                    fontSize: 11.5,
                    fontWeight: 700,
                    padding: '5px 10px',
                    borderRadius: 6,
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {tab === 'console' ? '콘솔 뷰' : '스토리 뷰'}
                </button>
              );
            })}
          </div>

          <button
            type="button"
            onClick={() => setIsRunning((r) => !r)}
            style={{
              boxSizing: 'border-box',
              padding: '6px 10px',
              borderRadius: 7,
              border: '1px solid #334155',
              background: isRunning ? '#1e293b' : '#065f46',
              color: '#f8fafc',
              fontSize: 12,
              fontWeight: 700,
              cursor: 'pointer',
              width: 114,
              textAlign: 'center',
              whiteSpace: 'nowrap',
            }}
          >
            {isRunning ? '일시정지' : '시뮬레이션 시작'}
          </button>
        </div>
      </header>

      {!isCompactView && <ServiceEvolutionBar defenseMode={defenseMode} onSelectMode={switchMode} />}

      {viewTab === 'story' ? (
        <StoryView
          defenseMode={defenseMode}
          events={events}
          metrics={metrics}
          onSelectMode={switchMode}
          onTriggerBurst={() => void triggerAttackBurst()}
          onSwitchToConsole={() => handleSetViewTab('console')}
        />
      ) : (
        <>
          {/* One-line Story Banner + Console Mode Controls */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              padding: isCompactView ? '7px 12px' : '8px 14px',
              marginBottom: isCompactView ? 10 : 14,
              borderRadius: 8,
              background: story.bg,
              border: `1px solid ${story.border}`,
              fontSize: 12.5,
              flexWrap: 'wrap',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', flex: '1 1 380px' }}>
              <span style={{ fontWeight: 800, color: story.accent }}>{story.badge}</span>
              <span style={{ color: '#f8fafc' }}>{story.text}</span>
              {demoPhase && (
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: '#c7d2fe',
                    fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                  }}
                >
                  {demoPhase === 'vulnerable' ? 'DEMO 1/2 · EXPLOIT REPRO' : 'DEMO 2/2 · PATCH BLOCKED'}
                </span>
              )}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <div
                style={{
                  display: 'inline-flex',
                  padding: 3,
                  borderRadius: 8,
                  background: '#0f172a',
                  border: '1px solid #1e293b',
                  gap: 2,
                }}
              >
                {(['v0.1-vulnerable', 'v0.2-waf-only', 'v0.3-patched'] as DefenseMode[]).map((m) => {
                  const active = defenseMode === m;
                  const meta = MODE_STORY[m];
                  return (
                    <button
                      key={m}
                      type="button"
                      onClick={() => switchMode(m)}
                      style={{
                        border: active ? '1px solid #334155' : '1px solid transparent',
                        background: active ? '#111827' : 'transparent',
                        color: active ? '#f8fafc' : '#94a3b8',
                        fontSize: 12,
                        fontWeight: 600,
                        padding: '4px 10px',
                        borderRadius: 6,
                        cursor: 'pointer',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 6,
                      }}
                    >
                      <span
                        style={{
                          width: 6,
                          height: 6,
                          borderRadius: '50%',
                          background: meta.dotColor,
                        }}
                      />
                      {meta.label}
                    </button>
                  );
                })}
              </div>

              <button
                type="button"
                onClick={() => setDemoPhase((p) => (p ? null : 'vulnerable'))}
                style={{
                  padding: '5px 10px',
                  borderRadius: 7,
                  border: '1px solid #6366f1',
                  background: demoPhase ? '#4f46e5' : '#6366f1',
                  color: '#ffffff',
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                {demoPhase ? '데모 중지' : '12초 데모'}
              </button>

              <button
                type="button"
                onClick={() => setIsCompactView((c) => !c)}
                style={{
                  padding: '5px 10px',
                  borderRadius: 7,
                  border: isCompactView ? '1px solid #38bdf8' : '1px solid #334155',
                  background: isCompactView ? '#0c4a6e' : '#111827',
                  color: '#e2e8f0',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                {isCompactView ? '기본 뷰' : 'GIF 뷰'}
              </button>
            </div>
          </div>

          {/* 70:30 Hero Grid: Tactical Map (Left) + KPI Sparkline Stack (Right) */}
          <div className="pg-hero-grid">
            <TacticalArena
              defenseMode={defenseMode}
              events={events}
              totalLeakedOrders={totalLeakedOrders}
              normalTotal={normalTotal}
              attackBlocked={attackBlocked}
              attackTotal={attackTotal}
              compact={isCompactView}
              onSelectEvent={(ev) => setSelectedEvent(ev)}
              onTriggerBurst={() => void triggerAttackBurst()}
            />

            <div className="pg-kpi-stack">
              <KpiRowCard
                label="정상 유저 가용성 (False Positive)"
                value={normalTotal ? `${Math.round((normalPassed / normalTotal) * 100)}%` : '100%'}
                sub={`${normalPassed} / ${normalTotal} 정상 요청 HTTP 200`}
                color="#34d399"
                sparkPoints={normalSparkPoints}
              />
              <KpiRowCard
                label="L1 · Edge WAF 차단율"
                value="0%"
                sub="정상 HTTP 문법이라 문맥 판별 불가"
                color="#fbbf24"
                badge="PASS"
              />
              <KpiRowCard
                label="L2 · AppSec Guard 차단율"
                value={attackTotal ? `${Math.round((attackBlocked / attackTotal) * 100)}%` : '0%'}
                sub={
                  defenseMode === 'v0.3-patched'
                    ? `${attackBlocked} / ${attackTotal} 타인 주문 차단`
                    : '소유권 인가 검증 누락 (취약)'
                }
                color={defenseMode === 'v0.3-patched' ? '#38bdf8' : '#fda4af'}
                sparkPoints={guardSparkPoints}
              />
              <KpiRowCard
                label="누적 피해 · 유출된 타인 주문서"
                value={`${totalLeakedOrders}건`}
                sub={totalLeakedOrders > 0 ? '카드 뒷자리·배송지 유출 발생' : '카드 뒷자리·배송지 보호됨'}
                color={totalLeakedOrders > 0 ? '#fda4af' : '#34d399'}
                badge={totalLeakedOrders > 0 ? `${totalLeakedOrders} LEAKED` : '0 LEAKED'}
              />
            </div>
          </div>

          {/* Bottom Split: Fingerprint + Fixed-Width Stream (Left) / 4-Stage Waterfall + Diff (Right) */}
          <div className="pg-bottom-grid">
            <section
              className="pg-stream-panel"
              style={{
                background: '#111827',
                border: '1px solid #1e293b',
                borderRadius: 10,
                padding: isCompactView ? 12 : 14,
                display: 'flex',
                flexDirection: 'column',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: 8,
                }}
              >
                <span style={{ fontSize: 11.5, fontWeight: 700, color: '#94a3b8', letterSpacing: '0.04em' }}>
                  LIVE REQUEST STREAM
                </span>
                <button
                  type="button"
                  onClick={fireRandomManualStep}
                  style={{
                    padding: '2px 8px',
                    borderRadius: 5,
                    border: '1px solid #334155',
                    background: '#0f172a',
                    color: '#cbd5e1',
                    fontSize: 11,
                    cursor: 'pointer',
                  }}
                >
                  +1 스텝
                </button>
              </div>

              {/* Endpoint Fingerprint Summary */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  flexWrap: 'wrap',
                  gap: 8,
                  padding: '6px 10px',
                  borderRadius: 7,
                  background: '#0f172a',
                  border: '1px solid #1e293b',
                  marginBottom: 8,
                  fontSize: 11.5,
                  color: '#94a3b8',
                  fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                }}
              >
                <span>GET /api/orders/:id</span>
                <span>
                  정상 {normalTotal} · 차단 {attackBlocked} · 유출 {totalLeakedOrders} · p95 {p95Latency}ms
                </span>
              </div>

              <div style={{ overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: 5 }}>
                {events.length === 0 && (
                  <div style={{ color: '#64748b', fontSize: 12.5, padding: 24, textAlign: 'center' }}>
                    시뮬레이션 시작 또는 기습 버스트 발사를 누르면 실시간 요청이 기록됩니다.
                  </div>
                )}

                {events.map((ev) => {
                  const isSelected = inspectedEvent?.id === ev.id;
                  return (
                    <div
                      key={ev.id}
                      className="pg-stream-row"
                      onClick={() => setSelectedEvent(ev)}
                      style={{
                        background: isSelected ? '#172033' : '#0f172a',
                        border: isSelected ? '1px solid #38bdf8' : '1px solid #1e293b',
                      }}
                    >
                      <StatusBadge event={ev} />
                      <code
                        style={{
                          fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                          fontSize: 12,
                          color: '#f8fafc',
                          fontWeight: 600,
                          minWidth: 0,
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                      >
                        {ev.method} {ev.path}
                      </code>
                      <div className="pg-stream-meta">
                        <span style={{ fontSize: 11.5, color: '#94a3b8', whiteSpace: 'nowrap' }}>{ev.actor}</span>
                        <span
                          style={{
                            fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                            fontSize: 11,
                            color: '#64748b',
                            fontVariantNumeric: 'tabular-nums',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {formatTimeMs(ev.timestamp)} · {ev.latencyMs}ms
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            {/* Right: 4-Stage Execution Waterfall + Actionable Remediation + Code Diff */}
            <section
              className="pg-inspector-panel"
              style={{
                background: '#111827',
                border: '1px solid #1e293b',
                borderRadius: 10,
                padding: isCompactView ? 12 : 14,
                overflowY: 'auto',
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 11.5, fontWeight: 700, color: '#94a3b8', letterSpacing: '0.04em' }}>
                  EXECUTION WATERFALL &amp; PATCH DIFF
                </span>
                {defenseMode !== 'v0.3-patched' && (
                  <button
                    type="button"
                    onClick={async () => {
                      await switchMode('v0.3-patched');
                      setTimeout(() => void triggerAttackBurst(), 150);
                    }}
                    style={{
                      padding: '3px 9px',
                      borderRadius: 6,
                      border: '1px solid rgba(56, 189, 248, 0.45)',
                      background: 'rgba(56, 189, 248, 0.14)',
                      color: '#38bdf8',
                      fontSize: 11,
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    v0.3 패치로 즉시 재검증
                  </button>
                )}
              </div>

              <ExecutionWaterfall event={inspectedEvent} defenseMode={defenseMode} />

              <pre
                style={{
                  background: '#070b12',
                  padding: '10px 12px',
                  borderRadius: 8,
                  border: '1px solid #1e293b',
                  fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                  fontSize: 11.5,
                  lineHeight: 1.5,
                  overflowX: 'auto',
                  color: '#e2e8f0',
                  margin: 0,
                }}
              >
{`// apps/api/src/routes/orders.ts
- // [v0.1/v0.2] 인증만 확인하고 소유권 검증 누락
- return res.json(order);

+ // [v0.3 Patched] 객체 소유권 인가 + 존재 은폐(404)
+ if (order.userId !== user.id) {
+   return res.status(404).json({ error: 'Order not found' });
+ }
+ return res.json(order);`}
              </pre>
            </section>
          </div>
        </>
      )}
    </div>
  );
}

function ExecutionWaterfall({
  event,
  defenseMode,
}: {
  event: TrafficEvent | null;
  defenseMode: DefenseMode;
}) {
  const isNormal = event ? event.actorType === 'normal' : false;
  const activeMode = event?.defenseMode ?? defenseMode;
  const isPatched = event ? event.appAction === 'BLOCKED_GUARD' : activeMode === 'v0.3-patched';

  const steps = isNormal
    ? [
        { num: '1 · GATEWAY', name: 'API 수신', status: 'AUTH OK', color: '#34d399', border: 'rgba(16,185,129,0.4)' },
        { num: '2 · L1 WAF', name: '경계 검사', status: 'PASS', color: '#34d399', border: 'rgba(16,185,129,0.4)' },
        { num: '3 · L2 GUARD', name: '소유권 인가', status: 'OWNER MATCH', color: '#34d399', border: 'rgba(16,185,129,0.4)' },
        { num: '4 · VAULT', name: '정상 응답', status: 'HTTP 200', color: '#34d399', border: 'rgba(16,185,129,0.4)' },
      ]
    : [
        { num: '1 · GATEWAY', name: 'API 수신', status: 'AUTH OK', color: '#34d399', border: 'rgba(16,185,129,0.4)' },
        {
          num: '2 · L1 WAF',
          name: '경계 검사',
          status: activeMode === 'v0.1-vulnerable' ? 'BYPASSED' : 'PASS (정상문법)',
          color: '#fbbf24',
          border: 'rgba(245,158,11,0.45)',
        },
        {
          num: '3 · L2 GUARD',
          name: '소유권 인가',
          status: isPatched ? 'BLOCKED (404)' : 'MISSING CHECK',
          color: isPatched ? '#38bdf8' : '#fda4af',
          border: isPatched ? 'rgba(56,189,248,0.55)' : 'rgba(244,63,94,0.5)',
        },
        {
          num: '4 · VAULT',
          name: '데이터 보호',
          status: isPatched ? '0 LEAKED' : 'PII LEAKED',
          color: isPatched ? '#34d399' : '#fda4af',
          border: isPatched ? 'rgba(16,185,129,0.4)' : 'rgba(244,63,94,0.5)',
        },
      ];

  return (
    <div className="pg-waterfall">
      {steps.map((s) => (
        <div
          key={s.num}
          style={{
            padding: '7px 8px',
            borderRadius: 7,
            background: '#0f172a',
            border: `1px solid ${s.border}`,
          }}
        >
          <div style={{ fontSize: 10, color: '#64748b', fontWeight: 700 }}>{s.num}</div>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#f1f5f9', marginTop: 2 }}>{s.name}</div>
          <div
            style={{
              fontFamily: "'JetBrains Mono', ui-monospace, monospace",
              fontSize: 10,
              fontWeight: 700,
              color: s.color,
              marginTop: 3,
            }}
          >
            {s.status}
          </div>
        </div>
      ))}
    </div>
  );
}

function KpiRowCard({
  label,
  value,
  sub,
  color,
  sparkPoints,
  badge,
}: {
  label: string;
  value: string;
  sub: string;
  color: string;
  sparkPoints?: string;
  badge?: string;
}) {
  return (
    <div
      style={{
        background: '#111827',
        border: '1px solid #1e293b',
        borderRadius: 10,
        padding: '10px 13px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 10,
      }}
    >
      <div>
        <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600 }}>{label}</div>
        <div style={{ fontSize: 19, fontWeight: 800, color, fontVariantNumeric: 'tabular-nums', marginTop: 2 }}>
          {value}
        </div>
        <div style={{ fontSize: 10.5, color: '#64748b', marginTop: 2 }}>{sub}</div>
      </div>

      {sparkPoints ? (
        <svg width="58" height="26" viewBox="0 0 60 26" style={{ flexShrink: 0 }}>
          <polyline fill="none" stroke={color} strokeWidth="2" points={sparkPoints} />
        </svg>
      ) : badge ? (
        <span
          style={{
            fontSize: 10.5,
            fontWeight: 700,
            color,
            padding: '3px 8px',
            borderRadius: 999,
            border: '1px solid #1e293b',
            background: '#0f172a',
            fontFamily: "'JetBrains Mono', ui-monospace, monospace",
            whiteSpace: 'nowrap',
          }}
        >
          {badge}
        </span>
      ) : null}
    </div>
  );
}
