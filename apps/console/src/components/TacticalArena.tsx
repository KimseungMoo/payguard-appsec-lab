import React, { useEffect, useRef, useState } from 'react';
import type { DefenseMode, TrafficEvent } from '../App';

interface TacticalArenaProps {
  defenseMode: DefenseMode;
  latestEvent: TrafficEvent | null;
  totalLeakedOrders: number;
  normalTotal: number;
  attackBlocked: number;
  attackTotal: number;
  onSelectEvent?: (ev: TrafficEvent) => void;
  onTriggerBurst: () => void;
}

interface PacketParticle {
  uid: string;
  event: TrafficEvent;
  actorKey: string;
  startY: number;
  targetY: number;
  bornAt: number;
  durationMs: number;
  outcome: 'normal' | 'exploited' | 'blocked';
}

interface ImpactBurst {
  uid: string;
  x: number;
  y: number;
  color: string;
  label: string;
  bornAt: number;
  durationMs: number;
}

const ACTOR_POS: Record<string, { x: number; y: number; label: string; role: 'normal' | 'attacker' }> = {
  alice_kim: { x: 86, y: 74, label: 'alice_kim', role: 'normal' },
  bob_lee: { x: 86, y: 148, label: 'bob_lee', role: 'normal' },
  charlie_park: { x: 86, y: 222, label: 'charlie_park', role: 'normal' },
  mallory_sec: { x: 86, y: 312, label: 'mallory_sec', role: 'attacker' },
};

const WAF_X = 365;
const GUARD_X = 615;
const DB_X = 870;
const DB_Y = 185;

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

export function TacticalArena({
  defenseMode,
  latestEvent,
  totalLeakedOrders,
  normalTotal,
  attackBlocked,
  attackTotal,
  onSelectEvent,
  onTriggerBurst,
}: TacticalArenaProps) {
  const [now, setNow] = useState(() => performance.now());
  const packetsRef = useRef<PacketParticle[]>([]);
  const burstsRef = useRef<ImpactBurst[]>([]);
  const actorPulseRef = useRef<Record<string, number>>({});
  const lastSeenEventIdRef = useRef<string | null>(null);
  const spawnedImpactsRef = useRef<Set<string>>(new Set());

  // 새 트래픽 이벤트가 도착하면 맵을 가로지르는 이동 패킷 생성
  useEffect(() => {
    if (!latestEvent || latestEvent.id === lastSeenEventIdRef.current) return;
    lastSeenEventIdRef.current = latestEvent.id;

    const actor = ACTOR_POS[latestEvent.actor] || ACTOR_POS.alice_kim;
    const outcome: PacketParticle['outcome'] =
      latestEvent.appAction === 'EXPLOITED'
        ? 'exploited'
        : latestEvent.appAction === 'BLOCKED_GUARD'
        ? 'blocked'
        : 'normal';

    const tNow = performance.now();
    actorPulseRef.current[latestEvent.actor] = tNow;

    packetsRef.current.push({
      uid: latestEvent.id,
      event: latestEvent,
      actorKey: latestEvent.actor,
      startY: actor.y,
      targetY: outcome === 'normal' ? DB_Y - 22 + (Math.random() * 44) : DB_Y + (Math.random() * 20 - 10),
      bornAt: tNow,
      durationMs: outcome === 'exploited' ? 1650 : outcome === 'blocked' ? 1250 : 1300,
      outcome,
    });

    if (packetsRef.current.length > 36) {
      packetsRef.current.shift();
    }
  }, [latestEvent]);

  // 방어 모드 전환 시 진행 중이던 잔여 이펙트 초기화
  useEffect(() => {
    packetsRef.current = [];
    burstsRef.current = [];
    spawnedImpactsRef.current.clear();
  }, [defenseMode]);

  // 60fps 전술 맵 애니메이션 루프
  useEffect(() => {
    let rafId = 0;
    const tick = (t: number) => {
      // 만료된 패킷/이펙트 정리 및 경계 도달 시 타격 파동 생성
      const activePackets: PacketParticle[] = [];
      for (const p of packetsRef.current) {
        const progress = (t - p.bornAt) / p.durationMs;
        if (p.outcome === 'blocked' && progress >= 0.62 && !spawnedImpactsRef.current.has(p.uid)) {
          spawnedImpactsRef.current.add(p.uid);
          burstsRef.current.push({
            uid: `imp_${p.uid}`,
            x: GUARD_X - 82,
            y: lerp(p.startY, p.targetY, 0.65),
            color: '#38bdf8',
            label: '🛡️ 404 BLOCKED',
            bornAt: t,
            durationMs: 750,
          });
        } else if (p.outcome === 'exploited' && progress >= 0.56 && !spawnedImpactsRef.current.has(p.uid)) {
          spawnedImpactsRef.current.add(p.uid);
          burstsRef.current.push({
            uid: `imp_${p.uid}`,
            x: DB_X - 86,
            y: p.targetY,
            color: '#ef4444',
            label: '💥 PII LEAK!',
            bornAt: t,
            durationMs: 900,
          });
        } else if (p.outcome === 'normal' && progress >= 0.92 && !spawnedImpactsRef.current.has(p.uid)) {
          spawnedImpactsRef.current.add(p.uid);
          burstsRef.current.push({
            uid: `imp_${p.uid}`,
            x: DB_X - 82,
            y: p.targetY,
            color: '#10b981',
            label: '✓ 200',
            bornAt: t,
            durationMs: 480,
          });
        }

        if (progress < 1) {
          activePackets.push(p);
        }
      }
      packetsRef.current = activePackets;
      burstsRef.current = burstsRef.current.filter((b) => t - b.bornAt < b.durationMs);
      setNow(t);
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, []);

  const wafEnabled = defenseMode !== 'v0.1-vulnerable';
  const guardEnabled = defenseMode === 'v0.3-patched';
  const dbBreached = totalLeakedOrders > 0 && !guardEnabled;
  const attackerActive = now - (actorPulseRef.current.mallory_sec || 0) < 900;

  return (
    <section
      style={{
        background: 'radial-gradient(circle at 50% 20%, #111b2e 0%, #090e17 75%)',
        border: '1px solid #1e293b',
        borderRadius: 12,
        padding: '14px 16px',
        marginBottom: 18,
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Top tactical HUD bar */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 10,
          flexWrap: 'wrap',
          gap: 8,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 13, fontWeight: 800, color: '#f8fafc', letterSpacing: '0.03em' }}>
            ⚔️ 전술 트래픽 관제 맵 (TACTICAL DEFENSE ARENA)
          </span>
          <span
            style={{
              fontSize: 11,
              padding: '2px 8px',
              borderRadius: 999,
              background: guardEnabled ? '#064e3b' : wafEnabled ? '#78350f' : '#7f1d1d',
              color: guardEnabled ? '#34d399' : wafEnabled ? '#fcd34d' : '#fca5a5',
              fontWeight: 700,
            }}
          >
            {guardEnabled
              ? 'GUARD ACTIVE · 전 방어선 정상'
              : wafEnabled
              ? 'EDGE WAF ONLY · IDOR 무방비'
              : 'NO GUARD · 취약 상태'}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 11, color: '#94a3b8' }}>
            정상 {normalTotal} · 공격 차단 {attackBlocked}/{attackTotal}
          </span>
          <button
            type="button"
            onClick={onTriggerBurst}
            style={{
              padding: '5px 11px',
              borderRadius: 6,
              border: '1px solid #ef4444',
              background: '#7f1d1d55',
              color: '#fca5a5',
              fontSize: 11.5,
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            ⚡ 기습 버스트 발사
          </button>
        </div>
      </div>

      {/* 980x360 SVG Tactical Arena */}
      <svg
        viewBox="0 0 980 365"
        style={{ width: '100%', height: 'auto', display: 'block', userSelect: 'none' }}
      >
        <defs>
          <pattern id="tac-grid" width="32" height="32" patternUnits="userSpaceOnUse">
            <path d="M 32 0 L 0 0 0 32" fill="none" stroke="#1e293b" strokeWidth="0.7" opacity="0.55" />
          </pattern>
          <filter id="glow-red" x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="4" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <filter id="glow-cyan" x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="4" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        <rect x="0" y="0" width="980" height="365" rx="10" fill="url(#tac-grid)" />

        {/* Lane guide paths from each actor through gates to DB Vault */}
        {Object.entries(ACTOR_POS).map(([key, pos]) => {
          const isAtk = pos.role === 'attacker';
          const pulseAge = now - (actorPulseRef.current[key] || 0);
          const hot = pulseAge < 650;
          return (
            <path
              key={`lane-${key}`}
              d={`M ${pos.x + 56} ${pos.y} C 230 ${pos.y}, 460 ${DB_Y}, ${DB_X - 64} ${DB_Y}`}
              fill="none"
              stroke={isAtk ? (hot ? '#ef4444' : '#451a1a') : hot ? '#10b981' : '#1e293b'}
              strokeWidth={hot ? 2.2 : 1.3}
              strokeDasharray={isAtk ? '6 5' : undefined}
              opacity={hot ? 0.95 : 0.7}
            />
          );
        })}

        {/* Zone Headers */}
        <text x="86" y="24" textAnchor="middle" fontSize="11" fontWeight="700" fill="#64748b">
          SPAWN AGENTS
        </text>
        <text x={WAF_X} y="24" textAnchor="middle" fontSize="11" fontWeight="700" fill="#64748b">
          LAYER 1 · EDGE WAF
        </text>
        <text x={GUARD_X} y="24" textAnchor="middle" fontSize="11" fontWeight="700" fill="#64748b">
          LAYER 2 · APPSEC GUARD
        </text>
        <text x={DB_X} y="24" textAnchor="middle" fontSize="11" fontWeight="700" fill="#64748b">
          TARGET VAULT
        </text>

        {/* Left Actor Nodes (Normal Users + Attacker) */}
        {Object.entries(ACTOR_POS).map(([key, pos]) => {
          const isAtk = pos.role === 'attacker';
          const pulseAge = now - (actorPulseRef.current[key] || 0);
          const pulsing = pulseAge < 700;
          const ringScale = pulsing ? 1 + (pulseAge / 700) * 0.45 : 1;
          const ringOpacity = pulsing ? 1 - pulseAge / 700 : 0;

          return (
            <g key={key} transform={`translate(${pos.x}, ${pos.y})`}>
              {pulsing && (
                <circle
                  r={26 * ringScale}
                  fill="none"
                  stroke={isAtk ? '#ef4444' : '#10b981'}
                  strokeWidth="2"
                  opacity={ringOpacity}
                />
              )}
              <rect
                x="-64"
                y="-24"
                width="128"
                height="48"
                rx="10"
                fill={isAtk ? '#1f1016' : '#0f172a'}
                stroke={isAtk ? (pulsing ? '#ef4444' : '#7f1d1d') : pulsing ? '#10b981' : '#1e293b'}
                strokeWidth={pulsing ? 2 : 1.4}
              />
              <circle cx="-42" cy="0" r="9" fill={isAtk ? '#ef4444' : '#10b981'} opacity="0.2" />
              <circle cx="-42" cy="0" r="4.5" fill={isAtk ? '#f87171' : '#34d399'} />
              <text x="-26" y="-3" fontSize="12" fontWeight="700" fill="#f8fafc">
                {pos.label}
              </text>
              <text x="-26" y="13" fontSize="10" fill={isAtk ? '#fca5a5' : '#94a3b8'}>
                {isAtk ? (attackerActive ? '⚡ BURST FIRING' : '🕵️ STANDBY') : '🟢 NORMAL USER'}
              </text>
            </g>
          );
        })}

        {/* Layer 1: Edge WAF Gate */}
        <g transform={`translate(${WAF_X}, ${DB_Y})`}>
          <line
            x1="0"
            y1="-140"
            x2="0"
            y2="140"
            stroke={wafEnabled ? '#f59e0b' : '#334155'}
            strokeWidth={wafEnabled ? 3 : 1.5}
            strokeDasharray={wafEnabled ? '8 4' : '4 6'}
            opacity="0.7"
          />
          <rect
            x="-62"
            y="-44"
            width="124"
            height="88"
            rx="12"
            fill="#0f172a"
            stroke={wafEnabled ? '#f59e0b' : '#475569'}
            strokeWidth="2"
          />
          <text x="0" y="-16" textAnchor="middle" fontSize="12" fontWeight="800" fill={wafEnabled ? '#fbbf24' : '#94a3b8'}>
            🛡️ Edge WAF
          </text>
          <text x="0" y="4" textAnchor="middle" fontSize="11" fill="#cbd5e1">
            {wafEnabled ? 'CRS ON (0% 차단)' : 'BYPASSED'}
          </text>
          <text x="0" y="22" textAnchor="middle" fontSize="9.5" fill="#94a3b8">
            문맥(IDOR) 판별 불가
          </text>
        </g>

        {/* Layer 2: AppSec Ownership Guard Tower */}
        <g transform={`translate(${GUARD_X}, ${DB_Y})`} filter={guardEnabled ? 'url(#glow-cyan)' : undefined}>
          <line
            x1="0"
            y1="-140"
            x2="0"
            y2="140"
            stroke={guardEnabled ? '#38bdf8' : '#ef4444'}
            strokeWidth={guardEnabled ? 3.5 : 1.5}
            strokeDasharray={guardEnabled ? undefined : '4 6'}
            opacity={guardEnabled ? 0.85 : 0.45}
          />
          <rect
            x="-76"
            y="-48"
            width="152"
            height="96"
            rx="12"
            fill={guardEnabled ? '#0c233a' : '#1a1118'}
            stroke={guardEnabled ? '#38bdf8' : '#ef4444'}
            strokeWidth="2.2"
          />
          <text x="0" y="-18" textAnchor="middle" fontSize="11.5" fontWeight="800" fill={guardEnabled ? '#38bdf8' : '#fca5a5'}>
            {guardEnabled ? '🔷 Ownership Guard' : '⚠️ No AuthZ Guard'}
          </text>
          <text x="0" y="3" textAnchor="middle" fontSize="11" fill="#e2e8f0">
            {guardEnabled ? 'userId === owner' : '소유권 검증 누락'}
          </text>
          <text x="0" y="22" textAnchor="middle" fontSize="10" fontWeight="700" fill={guardEnabled ? '#34d399' : '#f87171'}>
            {guardEnabled ? '타인 접근 404 차단' : '공격 그대로 통과!'}
          </text>
        </g>

        {/* Right Target: Orders DB & PII Vault */}
        <g transform={`translate(${DB_X}, ${DB_Y})`} filter={dbBreached ? 'url(#glow-red)' : undefined}>
          <rect
            x="-68"
            y="-64"
            width="136"
            height="128"
            rx="14"
            fill={dbBreached ? '#280f16' : '#0f1d2e'}
            stroke={dbBreached ? '#ef4444' : '#34d399'}
            strokeWidth="2.4"
          />
          <text x="0" y="-32" textAnchor="middle" fontSize="13" fontWeight="800" fill="#f8fafc">
            🗄️ Orders Vault
          </text>
          <text x="0" y="-10" textAnchor="middle" fontSize="10.5" fill="#94a3b8">
            #1001 ~ #1005 (PII)
          </text>
          <rect
            x="-50"
            y="8"
            width="100"
            height="28"
            rx="6"
            fill={totalLeakedOrders > 0 ? '#7f1d1d' : '#064e3b'}
          />
          <text
            x="0"
            y="26"
            textAnchor="middle"
            fontSize="11.5"
            fontWeight="800"
            fill={totalLeakedOrders > 0 ? '#fca5a5' : '#34d399'}
          >
            {totalLeakedOrders > 0 ? `유출 ${totalLeakedOrders}건` : 'SAFE (0건)'}
          </text>
        </g>

        {/* Moving Packet Units */}
        {packetsRef.current.map((p) => {
          const rawT = Math.min(1, Math.max(0, (now - p.bornAt) / p.durationMs));
          const startX = (ACTOR_POS[p.actorKey]?.x ?? 86) + 64;
          const endX = DB_X - 68;

          let px = startX;
          let py = p.startY;
          let returning = false;

          if (p.outcome === 'blocked') {
            // 0 -> 0.62: Guard 전면까지 이동, 0.62 -> 1.0: Guard에서 튕겨져 소멸
            if (rawT <= 0.62) {
              const t = easeOutCubic(rawT / 0.62);
              px = lerp(startX, GUARD_X - 78, t);
              py = lerp(p.startY, p.targetY, t);
            } else {
              const t = (rawT - 0.62) / 0.38;
              px = lerp(GUARD_X - 78, GUARD_X - 142, t);
              py = lerp(p.targetY, p.targetY + 34, t);
            }
          } else if (p.outcome === 'exploited') {
            // 0 -> 0.56: Guard를 뚫고 DB까지 침투, 0.56 -> 1.0: 탈취한 영수증 데이터를 들고 공격자에게 복귀!
            if (rawT <= 0.56) {
              const t = rawT / 0.56;
              px = lerp(startX, endX, t);
              py = lerp(p.startY, p.targetY, t);
            } else {
              returning = true;
              const t = (rawT - 0.56) / 0.44;
              px = lerp(endX, startX, t);
              py = lerp(p.targetY, p.startY, t);
            }
          } else {
            const t = easeOutCubic(rawT);
            px = lerp(startX, endX, t);
            py = lerp(p.startY, p.targetY, t);
          }

          const opacity = rawT > 0.88 ? (1 - rawT) / 0.12 : 1;
          const color =
            p.outcome === 'exploited'
              ? returning
                ? '#fb7185'
                : '#ef4444'
              : p.outcome === 'blocked'
              ? rawT > 0.62
                ? '#38bdf8'
                : '#f59e0b'
              : '#34d399';

          const orderLabel = p.event.path.replace('/api/orders/', '#');

          return (
            <g
              key={p.uid}
              transform={`translate(${px}, ${py})`}
              opacity={opacity}
              style={{ cursor: 'pointer' }}
              onClick={() => onSelectEvent?.(p.event)}
            >
              <circle r="11" fill={color} opacity="0.22" />
              <circle r="5.5" fill={color} stroke="#090e17" strokeWidth="1.5" />
              <rect
                x="-22"
                y="-24"
                width="44"
                height="15"
                rx="4"
                fill="#090e17cc"
                stroke={color}
                strokeWidth="0.8"
              />
              <text x="0" y="-13.5" textAnchor="middle" fontSize="9.5" fontWeight="700" fill="#f8fafc">
                {returning ? `💰 ${orderLabel}` : orderLabel}
              </text>
            </g>
          );
        })}

        {/* Impact Shockwaves & Labels */}
        {burstsRef.current.map((b) => {
          const p = (now - b.bornAt) / b.durationMs;
          const r = 10 + p * 30;
          const opacity = Math.max(0, 1 - p);
          const labelY = -20 - p * 16;
          return (
            <g key={b.uid} transform={`translate(${b.x}, ${b.y})`} opacity={opacity}>
              <circle r={r} fill="none" stroke={b.color} strokeWidth="2.5" />
              <rect x="-54" y={labelY - 13} width="108" height="18" rx="5" fill="#090e17e6" stroke={b.color} strokeWidth="0.8" />
              <text
                x="0"
                y={labelY}
                textAnchor="middle"
                fontSize="10.5"
                fontWeight="800"
                fill={b.color}
              >
                {b.label}
              </text>
            </g>
          );
        })}
      </svg>
    </section>
  );
}
