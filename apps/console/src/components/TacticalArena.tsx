import React, { useEffect, useRef, useState } from 'react';
import type { DefenseMode, TrafficEvent } from '../App';

interface TacticalArenaProps {
  defenseMode: DefenseMode;
  events: TrafficEvent[];
  totalLeakedOrders: number;
  normalTotal: number;
  attackBlocked: number;
  attackTotal: number;
  compact?: boolean;
  onSelectEvent?: (ev: TrafficEvent) => void;
  onTriggerBurst: () => void;
}

interface PacketParticle {
  uid: string;
  event: TrafficEvent;
  actorKey: string;
  laneJitter: number;
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

interface ActorDef {
  label: string;
  shortLabel: string;
  role: 'normal' | 'attacker';
  desktop: { x: number; y: number };
  mobile: { x: number; y: number };
}

const ACTORS: Record<string, ActorDef> = {
  alice_kim: {
    label: 'alice_kim',
    shortLabel: 'alice',
    role: 'normal',
    desktop: { x: 86, y: 72 },
    mobile: { x: 56, y: 74 },
  },
  bob_lee: {
    label: 'bob_lee',
    shortLabel: 'bob',
    role: 'normal',
    desktop: { x: 86, y: 146 },
    mobile: { x: 158, y: 74 },
  },
  charlie_park: {
    label: 'charlie_park',
    shortLabel: 'charlie',
    role: 'normal',
    desktop: { x: 86, y: 220 },
    mobile: { x: 260, y: 74 },
  },
  mallory_sec: {
    label: 'mallory_sec',
    shortLabel: 'mallory',
    role: 'attacker',
    desktop: { x: 86, y: 310 },
    mobile: { x: 364, y: 74 },
  },
};

const DESKTOP_WAF_X = 365;
const DESKTOP_GUARD_X = 615;
const DESKTOP_DB_X = 870;
const DESKTOP_DB_Y = 185;

const MOBILE_CX = 210;
const MOBILE_WAF_Y = 192;
const MOBILE_GUARD_Y = 312;
const MOBILE_DB_Y = 442;

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

/** Shared horizontal (desktop) / vertical (mobile) packet trajectory coordinates. */
function getTrajectory(isMobile: boolean, actorKey: string, laneJitter: number) {
  const actor = ACTORS[actorKey] || ACTORS.alice_kim;
  if (isMobile) {
    const start = { x: actor.mobile.x, y: actor.mobile.y + 24 };
    const endX = MOBILE_CX + laneJitter * 1.4;
    return {
      start,
      wafHit: { x: lerp(start.x, endX, 0.34), y: MOBILE_WAF_Y - 22 },
      guardFront: { x: endX, y: MOBILE_GUARD_Y - 39 },
      guardBounce: { x: endX + laneJitter * 0.4, y: MOBILE_GUARD_Y - 86 },
      vaultEdge: { x: endX, y: MOBILE_DB_Y - 41 },
      vaultBurst: { x: endX, y: MOBILE_DB_Y - 44 },
    };
  }
  const start = { x: actor.desktop.x + 64, y: actor.desktop.y };
  const targetY = DESKTOP_DB_Y + laneJitter;
  return {
    start,
    wafHit: { x: DESKTOP_WAF_X, y: lerp(start.y, targetY, 0.34) - 14 },
    guardFront: { x: DESKTOP_GUARD_X - 80, y: targetY },
    guardBounce: { x: DESKTOP_GUARD_X - 148, y: targetY + 26 + laneJitter * 0.4 },
    vaultEdge: { x: DESKTOP_DB_X - 68, y: targetY },
    vaultBurst: { x: DESKTOP_DB_X - 88, y: targetY },
  };
}

/** Real-time SVG attack-path visualization (horizontal on desktop/tablet, vertical pipeline on mobile). */
export function TacticalArena({
  defenseMode,
  events,
  totalLeakedOrders,
  normalTotal,
  attackBlocked,
  attackTotal,
  compact = false,
  onSelectEvent,
  onTriggerBurst,
}: TacticalArenaProps) {
  const [isMobile, setIsMobile] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.matchMedia('(max-width: 640px)').matches : false,
  );
  const [now, setNow] = useState(() => performance.now());
  const packetsRef = useRef<PacketParticle[]>([]);
  const burstsRef = useRef<ImpactBurst[]>([]);
  const actorPulseRef = useRef<Record<string, number>>({});
  const vaultPulseRef = useRef<number>(0);
  const seenPacketIdsRef = useRef<Set<string>>(new Set());
  const wafPassedIdsRef = useRef<Set<string>>(new Set());
  const spawnedImpactsRef = useRef<Set<string>>(new Set());
  const burstStaggerIndexRef = useRef(0);
  const isMobileRef = useRef(isMobile);

  useEffect(() => {
    isMobileRef.current = isMobile;
  }, [isMobile]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(max-width: 640px)');
    const onChange = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    setIsMobile(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  // Batch-safe packet ingestion: inspect latest 12 events so simultaneous bursts are never dropped
  useEffect(() => {
    if (events.length === 0) return;
    const recent = events.slice(0, 12).reverse();
    const tNow = performance.now();
    let added = false;

    for (const ev of recent) {
      if (seenPacketIdsRef.current.has(ev.id)) continue;
      seenPacketIdsRef.current.add(ev.id);
      if (seenPacketIdsRef.current.size > 240) {
        const first = seenPacketIdsRef.current.values().next().value;
        if (first) seenPacketIdsRef.current.delete(first);
      }

      const outcome: PacketParticle['outcome'] =
        ev.appAction === 'EXPLOITED'
          ? 'exploited'
          : ev.appAction === 'BLOCKED_GUARD'
          ? 'blocked'
          : 'normal';

      const staggerSlot = (burstStaggerIndexRef.current++ % 4) - 1.5;
      const laneJitter = outcome === 'normal' ? staggerSlot * 10 : staggerSlot * 18;
      actorPulseRef.current[ev.actor] = tNow;

      packetsRef.current.push({
        uid: ev.id,
        event: ev,
        actorKey: ev.actor,
        laneJitter,
        bornAt: tNow,
        durationMs: outcome === 'exploited' ? 1650 : outcome === 'blocked' ? 1250 : 1280,
        outcome,
      });
      added = true;
    }

    if (packetsRef.current.length > 36) {
      packetsRef.current.splice(0, packetsRef.current.length - 36);
    }
    if (added) {
      setNow(tNow);
    }
  }, [events]);

  useEffect(() => {
    packetsRef.current = [];
    burstsRef.current = [];
    wafPassedIdsRef.current.clear();
    spawnedImpactsRef.current.clear();
    vaultPulseRef.current = 0;
    setNow(performance.now());
  }, [defenseMode]);

  // 60fps loop only triggers React renders while particles, bursts, or pulses are active
  useEffect(() => {
    let rafId = 0;
    let wasActive = false;

    const tick = (t: number) => {
      const activePackets: PacketParticle[] = [];
      const mobileLayout = isMobileRef.current;

      for (const p of packetsRef.current) {
        const progress = (t - p.bornAt) / p.durationMs;
        const traj = getTrajectory(mobileLayout, p.actorKey, p.laneJitter);

        if (
          defenseMode === 'v0.2-waf-only' &&
          p.outcome === 'exploited' &&
          progress >= 0.24 &&
          !wafPassedIdsRef.current.has(p.uid)
        ) {
          wafPassedIdsRef.current.add(p.uid);
          burstsRef.current.push({
            uid: `waf_${p.uid}`,
            x: traj.wafHit.x,
            y: traj.wafHit.y,
            color: '#f59e0b',
            label: 'WAF PASS',
            bornAt: t,
            durationMs: 650,
          });
        }

        if (p.outcome === 'blocked' && progress >= 0.62 && !spawnedImpactsRef.current.has(p.uid)) {
          spawnedImpactsRef.current.add(p.uid);
          burstsRef.current.push({
            uid: `imp_${p.uid}`,
            x: traj.guardFront.x,
            y: mobileLayout ? traj.guardFront.y - 6 : traj.guardFront.y + p.laneJitter * 0.35,
            color: '#38bdf8',
            label: '404 BLOCKED',
            bornAt: t,
            durationMs: 780,
          });
        } else if (p.outcome === 'exploited' && progress >= 0.56 && !spawnedImpactsRef.current.has(p.uid)) {
          spawnedImpactsRef.current.add(p.uid);
          vaultPulseRef.current = t;
          burstsRef.current.push({
            uid: `imp_${p.uid}`,
            x: traj.vaultBurst.x,
            y: traj.vaultBurst.y,
            color: '#f43f5e',
            label: 'PII LEAK',
            bornAt: t,
            durationMs: 920,
          });
        } else if (p.outcome === 'normal' && progress >= 0.92 && !spawnedImpactsRef.current.has(p.uid)) {
          spawnedImpactsRef.current.add(p.uid);
          burstsRef.current.push({
            uid: `imp_${p.uid}`,
            x: traj.vaultBurst.x,
            y: traj.vaultBurst.y,
            color: '#10b981',
            label: '200 OK',
            bornAt: t,
            durationMs: 460,
          });
        }

        if (progress < 1) {
          activePackets.push(p);
        }
      }

      packetsRef.current = activePackets;
      burstsRef.current = burstsRef.current.filter((b) => t - b.bornAt < b.durationMs);

      const hasActorPulse = Object.values(actorPulseRef.current).some((ts) => t - ts < 900);
      const hasVaultPulse = t - vaultPulseRef.current < 750;
      const isActive =
        packetsRef.current.length > 0 || burstsRef.current.length > 0 || hasActorPulse || hasVaultPulse;

      if (isActive || wasActive) {
        setNow(t);
      }
      wasActive = isActive;
      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [defenseMode]);

  const wafEnabled = defenseMode !== 'v0.1-vulnerable';
  const guardEnabled = defenseMode === 'v0.3-patched';
  const dbBreached = totalLeakedOrders > 0 && !guardEnabled;
  const attackerActive = now - (actorPulseRef.current.mallory_sec || 0) < 900;
  const vaultPulseAge = now - vaultPulseRef.current;
  const vaultPulsing = vaultPulseRef.current > 0 && vaultPulseAge < 750;

  return (
    <section
      style={{
        background: 'radial-gradient(circle at 50% 18%, #10192b 0%, #090e17 78%)',
        border: '1px solid #1e293b',
        borderRadius: 10,
        padding: compact || isMobile ? '10px 12px' : '13px 15px',
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
          marginBottom: 8,
          flexWrap: 'wrap',
          gap: 8,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span
            style={{
              fontSize: 11.5,
              fontWeight: 700,
              color: '#94a3b8',
              letterSpacing: '0.05em',
              textTransform: 'uppercase',
            }}
          >
            Attack Path Map
          </span>
          <span
            style={{
              fontSize: 10.5,
              padding: '2px 8px',
              borderRadius: 999,
              background: guardEnabled
                ? 'rgba(16, 185, 129, 0.14)'
                : wafEnabled
                ? 'rgba(245, 158, 11, 0.14)'
                : 'rgba(244, 63, 94, 0.16)',
              color: guardEnabled ? '#34d399' : wafEnabled ? '#fbbf24' : '#fda4af',
              fontWeight: 700,
              fontFamily: "'JetBrains Mono', ui-monospace, monospace",
            }}
          >
            {guardEnabled
              ? 'GUARD ACTIVE · 404 ISOLATION'
              : wafEnabled
              ? 'EDGE WAF ONLY · BYPASSED'
              : 'NO GUARD · PII EXPOSED'}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span
            style={{
              fontSize: 11,
              color: '#94a3b8',
              fontFamily: "'JetBrains Mono', ui-monospace, monospace",
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            NORMAL {normalTotal} · BLOCKED {attackBlocked}/{attackTotal}
          </span>
          <button
            type="button"
            onClick={onTriggerBurst}
            style={{
              padding: '4px 10px',
              borderRadius: 6,
              border: '1px solid rgba(244, 63, 94, 0.55)',
              background: 'rgba(127, 29, 29, 0.35)',
              color: '#fda4af',
              fontSize: 11.5,
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            기습 버스트 발사
          </button>
        </div>
      </div>

      {/* Responsive SVG: Horizontal (980x365) on Desktop/Tablet, Vertical Pipeline (420x510) on Mobile */}
      <svg
        viewBox={isMobile ? '0 0 420 510' : '0 0 980 365'}
        style={{
          width: '100%',
          height: 'auto',
          maxHeight: isMobile ? undefined : compact ? 255 : 320,
          display: 'block',
          userSelect: 'none',
        }}
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

        <rect x="0" y="0" width={isMobile ? 420 : 980} height={isMobile ? 510 : 365} rx="8" fill="url(#tac-grid)" />

        {/* Lane Guide Paths */}
        {Object.entries(ACTORS).map(([key, def]) => {
          const isAtk = def.role === 'attacker';
          const pulseAge = now - (actorPulseRef.current[key] || 0);
          const hot = pulseAge < 650;
          const d = isMobile
            ? `M ${def.mobile.x} ${def.mobile.y + 24} C ${def.mobile.x} 200, ${MOBILE_CX} 250, ${MOBILE_CX} ${MOBILE_DB_Y - 40}`
            : `M ${def.desktop.x + 56} ${def.desktop.y} C 230 ${def.desktop.y}, 460 ${DESKTOP_DB_Y}, ${DESKTOP_DB_X - 64} ${DESKTOP_DB_Y}`;
          return (
            <path
              key={`lane-${key}`}
              d={d}
              fill="none"
              stroke={isAtk ? (hot ? '#f43f5e' : '#451a1a') : hot ? '#10b981' : '#1e293b'}
              strokeWidth={hot ? 2.2 : 1.3}
              strokeDasharray={isAtk ? '6 5' : undefined}
              opacity={hot ? 0.95 : 0.72}
            />
          );
        })}

        {/* Zone Headers & Static Gate/Vault Architecture */}
        {isMobile ? (
          <>
            <text x="210" y="26" textAnchor="middle" fontSize="11" fontWeight="700" fill="#64748b">
              TRAFFIC SOURCES (NORMAL + ATTACKER)
            </text>

            {/* Mobile Top Actor Row */}
            {Object.entries(ACTORS).map(([key, def]) => {
              const isAtk = def.role === 'attacker';
              const pulseAge = now - (actorPulseRef.current[key] || 0);
              const pulsing = pulseAge < 700;
              return (
                <g key={key} transform={`translate(${def.mobile.x}, ${def.mobile.y})`}>
                  {pulsing && (
                    <circle
                      r={24 + (pulseAge / 700) * 10}
                      fill="none"
                      stroke={isAtk ? '#f43f5e' : '#10b981'}
                      strokeWidth="2"
                      opacity={1 - pulseAge / 700}
                    />
                  )}
                  <rect
                    x="-46"
                    y="-22"
                    width="92"
                    height="44"
                    rx="8"
                    fill={isAtk ? '#1f1016' : '#0f172a'}
                    stroke={isAtk ? (pulsing ? '#f43f5e' : '#7f1d1d') : pulsing ? '#10b981' : '#1e293b'}
                    strokeWidth={pulsing ? 2 : 1.3}
                  />
                  <circle cx="-30" cy="-5" r="4" fill={isAtk ? '#fda4af' : '#34d399'} />
                  <text x="-20" y="-2" fontSize="12" fontWeight="700" fill="#f8fafc">
                    {def.shortLabel}
                  </text>
                  <text x="0" y="14" textAnchor="middle" fontSize="9.5" fill={isAtk ? '#fda4af' : '#94a3b8'}>
                    {isAtk ? (attackerActive ? 'BURST!' : 'ATTACKER') : 'NORMAL'}
                  </text>
                </g>
              );
            })}

            {/* Mobile Layer 1: Edge WAF Bar */}
            <g transform={`translate(${MOBILE_CX}, ${MOBILE_WAF_Y})`}>
              <line
                x1="-175"
                y1="0"
                x2="175"
                y2="0"
                stroke={wafEnabled ? '#f59e0b' : '#334155'}
                strokeWidth={wafEnabled ? 2.4 : 1.4}
                strokeDasharray={wafEnabled ? '8 4' : '4 6'}
                opacity="0.6"
              />
              <rect
                x="-126"
                y="-30"
                width="252"
                height="60"
                rx="10"
                fill="#0f172a"
                stroke={wafEnabled ? '#f59e0b' : '#475569'}
                strokeWidth="2"
              />
              <text x="0" y="-6" textAnchor="middle" fontSize="13" fontWeight="800" fill={wafEnabled ? '#fbbf24' : '#94a3b8'}>
                L1 · Edge WAF {wafEnabled ? '(CRS ON)' : '(BYPASSED)'}
              </text>
              <text x="0" y="14" textAnchor="middle" fontSize="11" fill="#cbd5e1">
                {wafEnabled ? '0% 차단 · HTTP 문법 정상 통과' : 'WAF 미적용'}
              </text>
            </g>

            {/* Mobile Layer 2: Ownership Guard Bar */}
            <g transform={`translate(${MOBILE_CX}, ${MOBILE_GUARD_Y})`} filter={guardEnabled ? 'url(#glow-cyan)' : undefined}>
              <line
                x1="-175"
                y1="0"
                x2="175"
                y2="0"
                stroke={guardEnabled ? '#38bdf8' : '#f43f5e'}
                strokeWidth={guardEnabled ? 3 : 1.5}
                strokeDasharray={guardEnabled ? undefined : '4 6'}
                opacity={guardEnabled ? 0.8 : 0.45}
              />
              <rect
                x="-136"
                y="-34"
                width="272"
                height="68"
                rx="10"
                fill={guardEnabled ? '#0c233a' : '#1a1118'}
                stroke={guardEnabled ? '#38bdf8' : '#f43f5e'}
                strokeWidth="2.2"
              />
              <text x="0" y="-9" textAnchor="middle" fontSize="13" fontWeight="800" fill={guardEnabled ? '#38bdf8' : '#fda4af'}>
                {guardEnabled ? 'L2 · Ownership Guard' : 'L2 · No AuthZ Guard'}
              </text>
              <text x="0" y="12" textAnchor="middle" fontSize="11" fontWeight="700" fill={guardEnabled ? '#34d399' : '#fda4af'}>
                {guardEnabled ? 'userId === owner 검증 · 404 차단' : '소유권 검증 누락 · 공격 통과'}
              </text>
            </g>

            {/* Mobile Vault Card */}
            <g transform={`translate(${MOBILE_CX}, ${MOBILE_DB_Y})`} filter={dbBreached ? 'url(#glow-red)' : undefined}>
              {vaultPulsing && (
                <rect
                  x={-114 - (vaultPulseAge / 750) * 12}
                  y={-42 - (vaultPulseAge / 750) * 12}
                  width={228 + (vaultPulseAge / 750) * 24}
                  height={84 + (vaultPulseAge / 750) * 24}
                  rx="16"
                  fill="none"
                  stroke="#f43f5e"
                  strokeWidth="2.4"
                  opacity={1 - vaultPulseAge / 750}
                />
              )}
              <rect
                x="-110"
                y="-38"
                width="220"
                height="76"
                rx="12"
                fill={dbBreached ? '#280f16' : '#0f1d2e'}
                stroke={dbBreached ? '#f43f5e' : '#34d399'}
                strokeWidth="2.2"
              />
              <text x="0" y="-11" textAnchor="middle" fontSize="13.5" fontWeight="800" fill="#f8fafc">
                Orders Vault (#1001~#1005)
              </text>
              <rect
                x="-64"
                y="2"
                width="128"
                height="24"
                rx="6"
                fill={totalLeakedOrders > 0 ? '#7f1d1d' : '#064e3b'}
              />
              <text
                x="0"
                y="18"
                textAnchor="middle"
                fontSize="12"
                fontWeight="800"
                fill={totalLeakedOrders > 0 ? '#fca5a5' : '#34d399'}
              >
                {totalLeakedOrders > 0 ? `유출 ${totalLeakedOrders}건` : 'SAFE (0건)'}
              </text>
            </g>
          </>
        ) : (
          <>
            <text x="86" y="24" textAnchor="middle" fontSize="11" fontWeight="700" fill="#64748b">
              TRAFFIC SOURCES
            </text>
            <text x={DESKTOP_WAF_X} y="24" textAnchor="middle" fontSize="11" fontWeight="700" fill="#64748b">
              LAYER 1 · EDGE WAF
            </text>
            <text x={DESKTOP_GUARD_X} y="24" textAnchor="middle" fontSize="11" fontWeight="700" fill="#64748b">
              LAYER 2 · AUTHZ GUARD
            </text>
            <text x={DESKTOP_DB_X} y="24" textAnchor="middle" fontSize="11" fontWeight="700" fill="#64748b">
              ORDERS VAULT
            </text>

            {/* Desktop Left Actor Nodes */}
            {Object.entries(ACTORS).map(([key, def]) => {
              const isAtk = def.role === 'attacker';
              const pulseAge = now - (actorPulseRef.current[key] || 0);
              const pulsing = pulseAge < 700;
              const ringScale = pulsing ? 1 + (pulseAge / 700) * 0.45 : 1;
              const ringOpacity = pulsing ? 1 - pulseAge / 700 : 0;

              return (
                <g key={key} transform={`translate(${def.desktop.x}, ${def.desktop.y})`}>
                  {pulsing && (
                    <circle
                      r={26 * ringScale}
                      fill="none"
                      stroke={isAtk ? '#f43f5e' : '#10b981'}
                      strokeWidth="2"
                      opacity={ringOpacity}
                    />
                  )}
                  <rect
                    x="-64"
                    y="-23"
                    width="128"
                    height="46"
                    rx="9"
                    fill={isAtk ? '#1f1016' : '#0f172a'}
                    stroke={isAtk ? (pulsing ? '#f43f5e' : '#7f1d1d') : pulsing ? '#10b981' : '#1e293b'}
                    strokeWidth={pulsing ? 2 : 1.4}
                  />
                  <circle cx="-44" cy="0" r="8" fill={isAtk ? '#f43f5e' : '#10b981'} opacity="0.2" />
                  <circle cx="-44" cy="0" r="4" fill={isAtk ? '#fda4af' : '#34d399'} />
                  <text x="-28" y="-3" fontSize="12" fontWeight="700" fill="#f8fafc">
                    {def.label}
                  </text>
                  <text x="-28" y="13" fontSize="10.5" fill={isAtk ? '#fda4af' : '#94a3b8'}>
                    {isAtk ? (attackerActive ? 'BURST FIRING' : 'IDOR STANDBY') : 'NORMAL USER'}
                  </text>
                </g>
              );
            })}

            {/* Desktop Layer 1: Edge WAF Gate */}
            <g transform={`translate(${DESKTOP_WAF_X}, ${DESKTOP_DB_Y})`}>
              <line
                x1="0"
                y1="-140"
                x2="0"
                y2="140"
                stroke={wafEnabled ? '#f59e0b' : '#334155'}
                strokeWidth={wafEnabled ? 2.6 : 1.4}
                strokeDasharray={wafEnabled ? '8 4' : '4 6'}
                opacity="0.65"
              />
              <rect
                x="-64"
                y="-44"
                width="128"
                height="88"
                rx="11"
                fill="#0f172a"
                stroke={wafEnabled ? '#f59e0b' : '#475569'}
                strokeWidth="2"
              />
              <text x="0" y="-15" textAnchor="middle" fontSize="12.5" fontWeight="800" fill={wafEnabled ? '#fbbf24' : '#94a3b8'}>
                Edge WAF
              </text>
              <text x="0" y="5" textAnchor="middle" fontSize="11.5" fill="#cbd5e1">
                {wafEnabled ? 'CRS ON (0% 차단)' : 'BYPASSED'}
              </text>
              <text x="0" y="23" textAnchor="middle" fontSize="10.5" fill="#94a3b8">
                HTTP 문법 정상 통과
              </text>
            </g>

            {/* Desktop Layer 2: Ownership Guard */}
            <g transform={`translate(${DESKTOP_GUARD_X}, ${DESKTOP_DB_Y})`} filter={guardEnabled ? 'url(#glow-cyan)' : undefined}>
              <line
                x1="0"
                y1="-140"
                x2="0"
                y2="140"
                stroke={guardEnabled ? '#38bdf8' : '#f43f5e'}
                strokeWidth={guardEnabled ? 3.2 : 1.5}
                strokeDasharray={guardEnabled ? undefined : '4 6'}
                opacity={guardEnabled ? 0.82 : 0.45}
              />
              <rect
                x="-78"
                y="-48"
                width="156"
                height="96"
                rx="11"
                fill={guardEnabled ? '#0c233a' : '#1a1118'}
                stroke={guardEnabled ? '#38bdf8' : '#f43f5e'}
                strokeWidth="2.2"
              />
              <text x="0" y="-17" textAnchor="middle" fontSize="12" fontWeight="800" fill={guardEnabled ? '#38bdf8' : '#fda4af'}>
                {guardEnabled ? 'Ownership Guard' : 'No AuthZ Guard'}
              </text>
              <text x="0" y="4" textAnchor="middle" fontSize="11.5" fill="#e2e8f0">
                {guardEnabled ? 'order.userId === user' : '소유권 검증 누락'}
              </text>
              <text x="0" y="23" textAnchor="middle" fontSize="10.5" fontWeight="700" fill={guardEnabled ? '#34d399' : '#fda4af'}>
                {guardEnabled ? '타인 접근 404 차단' : '공격 그대로 통과'}
              </text>
            </g>

            {/* Desktop Target: Orders Vault */}
            <g transform={`translate(${DESKTOP_DB_X}, ${DESKTOP_DB_Y})`} filter={dbBreached ? 'url(#glow-red)' : undefined}>
              {vaultPulsing && (
                <rect
                  x={-72 - (vaultPulseAge / 750) * 14}
                  y={-68 - (vaultPulseAge / 750) * 14}
                  width={144 + (vaultPulseAge / 750) * 28}
                  height={136 + (vaultPulseAge / 750) * 28}
                  rx="18"
                  fill="none"
                  stroke="#f43f5e"
                  strokeWidth="2.4"
                  opacity={1 - vaultPulseAge / 750}
                />
              )}
              <rect
                x="-68"
                y="-64"
                width="136"
                height="128"
                rx="13"
                fill={dbBreached ? '#280f16' : '#0f1d2e'}
                stroke={dbBreached ? '#f43f5e' : '#34d399'}
                strokeWidth="2.2"
              />
              <text x="0" y="-31" textAnchor="middle" fontSize="13.5" fontWeight="800" fill="#f8fafc">
                Orders Vault
              </text>
              <text x="0" y="-10" textAnchor="middle" fontSize="11" fill="#94a3b8">
                #1001 ~ #1005 (PII)
              </text>
              <rect
                x="-52"
                y="8"
                width="104"
                height="28"
                rx="6"
                fill={totalLeakedOrders > 0 ? '#7f1d1d' : '#064e3b'}
              />
              <text
                x="0"
                y="26"
                textAnchor="middle"
                fontSize="12"
                fontWeight="800"
                fill={totalLeakedOrders > 0 ? '#fca5a5' : '#34d399'}
              >
                {totalLeakedOrders > 0 ? `유출 ${totalLeakedOrders}건` : 'SAFE (0건)'}
              </text>
            </g>
          </>
        )}

        {/* Moving Packet Units (Shared Trajectory Logic) */}
        {packetsRef.current.map((p) => {
          const rawT = Math.min(1, Math.max(0, (now - p.bornAt) / p.durationMs));
          const traj = getTrajectory(isMobile, p.actorKey, p.laneJitter);

          let px = traj.start.x;
          let py = traj.start.y;
          let returning = false;

          if (p.outcome === 'blocked') {
            if (rawT <= 0.62) {
              const t = easeOutCubic(rawT / 0.62);
              px = lerp(traj.start.x, traj.guardFront.x, t);
              py = lerp(traj.start.y, traj.guardFront.y, t);
            } else {
              const t = (rawT - 0.62) / 0.38;
              px = lerp(traj.guardFront.x, traj.guardBounce.x, t);
              py = lerp(traj.guardFront.y, traj.guardBounce.y, t);
            }
          } else if (p.outcome === 'exploited') {
            if (rawT <= 0.56) {
              const t = rawT / 0.56;
              px = lerp(traj.start.x, traj.vaultEdge.x, t);
              py = lerp(traj.start.y, traj.vaultEdge.y, t);
            } else {
              returning = true;
              const t = (rawT - 0.56) / 0.44;
              px = lerp(traj.vaultEdge.x, traj.start.x, t);
              py = lerp(traj.vaultEdge.y, traj.start.y, t);
            }
          } else {
            const t = easeOutCubic(rawT);
            px = lerp(traj.start.x, traj.vaultEdge.x, t);
            py = lerp(traj.start.y, traj.vaultEdge.y, t);
          }

          const opacity = rawT > 0.88 ? (1 - rawT) / 0.12 : 1;
          const color =
            p.outcome === 'exploited'
              ? returning
                ? '#fb7185'
                : '#f43f5e'
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
                x="-26"
                y="-25"
                width="52"
                height="16"
                rx="4"
                fill="#090e17d9"
                stroke={color}
                strokeWidth="0.9"
              />
              <text x="0" y="-14" textAnchor="middle" fontSize="10.5" fontWeight="700" fill="#f8fafc">
                {returning ? `PII ${orderLabel}` : orderLabel}
              </text>
            </g>
          );
        })}

        {/* Impact Shockwaves & Labels */}
        {burstsRef.current.map((b) => {
          const p = (now - b.bornAt) / b.durationMs;
          const r = 10 + p * 26;
          const opacity = Math.max(0, 1 - p);
          const labelY = -20 - p * 14;
          return (
            <g key={b.uid} transform={`translate(${b.x}, ${b.y})`} opacity={opacity}>
              <circle r={r} fill="none" stroke={b.color} strokeWidth="2.2" />
              <rect
                x="-48"
                y={labelY - 14}
                width="96"
                height="18"
                rx="5"
                fill="#090e17eb"
                stroke={b.color}
                strokeWidth="0.9"
              />
              <text x="0" y={labelY - 1} textAnchor="middle" fontSize="10.5" fontWeight="800" fill={b.color}>
                {b.label}
              </text>
            </g>
          );
        })}
      </svg>
    </section>
  );
}
