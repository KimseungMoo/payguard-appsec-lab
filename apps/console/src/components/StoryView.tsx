import React, { useState } from 'react';
import type { DefenseMode, TelemetryMetrics, TrafficEvent } from '../App';
import { IncidentLinks } from './IncidentLinks';
import { StatusBadge } from './StatusBadge';
import { TacticalArena } from './TacticalArena';

interface StoryViewProps {
  defenseMode: DefenseMode;
  events: TrafficEvent[];
  metrics: TelemetryMetrics;
  onSelectMode: (mode: DefenseMode) => Promise<void>;
  onTriggerBurst: () => void;
  onSwitchToConsole: () => void;
}

interface StoryStep {
  num: string;
  tag: string;
  title: string;
  desc: string;
  targetMode: DefenseMode;
  calloutColor: string;
  calloutBg: string;
  calloutBorder: string;
  calloutText: string;
  codeSnippet: string;
}

const STORY_STEPS: StoryStep[] = [
  {
    num: 'STEP 01 · REAL INCIDENT',
    tag: 'USPS (2018) · Peloton (2021)',
    title: '로그인한 사용자가 남의 주문서를 조회할 수 있었던 이유',
    desc: '시스템이 "로그인했는가(인증)"만 확인하고 "이 주문이 본인 것인가(인가)"를 확인하지 않으면, 주문 번호만 바꿔 타인의 영수증·카드 뒷자리·배송지가 유출됩니다.',
    targetMode: 'v0.1-vulnerable',
    calloutColor: '#fda4af',
    calloutBg: 'rgba(244, 63, 94, 0.12)',
    calloutBorder: 'rgba(244, 63, 94, 0.35)',
    calloutText: '현재 v0.1 취약 상태입니다. 공격자(mallory_sec)가 주문 번호를 순회하며 타인 개인정보를 탈취하는 장면을 확인하세요.',
    codeSnippet: `// [v0.1 Vulnerable] 로그인만 통과하면 남의 주문서도 그대로 반환
const order = store.getOrderById(Number(req.params.orderId));
return res.json(order);`,
  },
  {
    num: 'STEP 02 · WHY WAF FAILS',
    tag: '경계 방화벽의 한계',
    title: '앞단 웹방화벽(Edge WAF)은 왜 이 공격을 막지 못할까?',
    desc: '해킹 특수문자(<script>, OR 1=1) 없이 지극히 정상적인 GET /api/orders/1002 요청을 보내기 때문입니다. 문법만 검사하는 WAF는 차단율 0%로 그대로 통과시킵니다.',
    targetMode: 'v0.2-waf-only',
    calloutColor: '#fcd34d',
    calloutBg: 'rgba(245, 158, 11, 0.12)',
    calloutBorder: 'rgba(245, 158, 11, 0.35)',
    calloutText: 'Edge WAF가 켜졌지만(WAF PASS), 업무 문맥(누구의 주문인지)을 판별할 수 없어 여전히 유출됩니다.',
    codeSnippet: `// [v0.2 Edge WAF Only]
// 요청 문법이 정상이므로 WAF는 PASS 처리
// -> 결국 애플리케이션 코드가 소유권을 검사해야 함`,
  },
  {
    num: 'STEP 03 · CODE PATCH',
    tag: '근본 해결 (v0.3)',
    title: '서버 코드의 소유권 인가 + 404 존재 은폐로 100% 차단',
    desc: 'DB에서 조회한 주문의 소유자(order.userId)와 로그인 사용자(user.id)가 일치할 때만 응답하고, 다르면 존재 여부까지 숨기기 위해 404를 반환합니다.',
    targetMode: 'v0.3-patched',
    calloutColor: '#38bdf8',
    calloutBg: 'rgba(56, 189, 248, 0.12)',
    calloutBorder: 'rgba(56, 189, 248, 0.35)',
    calloutText: '정상 고객 트래픽은 100% 통과(오탐 0%)하고, 공격자의 타인 주문 접근만 404로 즉시 반사됩니다.',
    codeSnippet: `+ // [v0.3 Patched] 객체 수준 소유권 인가 검증
+ if (order.userId !== user.id) {
+   return res.status(404).json({ error: 'Order not found' });
+ }`,
  },
  {
    num: 'STEP 04 · CI GUARDRAIL',
    tag: 'SecDevOps 자동화 (v0.4)',
    title: 'GitHub Actions가 코드 변경마다 공격 회귀를 자동 차단',
    desc: '앞으로 누군가 실수로 인가 검증 코드를 지우더라도 PR 단계에서 자동 공격 테스트(npm run test:idor:ci)가 실패해 배포가 차단됩니다.',
    targetMode: 'v0.3-patched',
    calloutColor: '#34d399',
    calloutBg: 'rgba(16, 185, 129, 0.12)',
    calloutBorder: 'rgba(16, 185, 129, 0.35)',
    calloutText: 'Module 1 GitHub Actions CI 게이트 통과 완료 — 정상 가용성 100% · 공격 성공률 0% 검증됨.',
    codeSnippet: `# .github/workflows/ci.yml
- name: Run Module 1 v0.3-patched BOLA/IDOR regression gate
  run: npm run test:idor:ci  # 정상 100% 통과 & 공격 0% 검증`,
  },
];

/** Non-developer / HR friendly scrollytelling view linked to the live TacticalArena simulator. */
export function StoryView({
  defenseMode,
  events,
  metrics,
  onSelectMode,
  onTriggerBurst,
  onSwitchToConsole,
}: StoryViewProps) {
  const [activeStepIdx, setActiveStepIdx] = useState<number>(() =>
    defenseMode === 'v0.3-patched' ? 2 : defenseMode === 'v0.2-waf-only' ? 1 : 0,
  );

  const step = STORY_STEPS[activeStepIdx];
  const { normalTotal, normalPassed, attackTotal, attackBlocked, totalLeakedOrders } = metrics;

  const handleSelectStep = async (idx: number) => {
    setActiveStepIdx(idx);
    const nextMode = STORY_STEPS[idx].targetMode;
    if (nextMode !== defenseMode) {
      await onSelectMode(nextMode);
    }
    setTimeout(() => onTriggerBurst(), 180);
  };

  return (
    <div className="pg-story-layout">
      {/* Left: 4-Step Narrative Cards */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div
          style={{
            padding: '10px 13px',
            borderRadius: 9,
            background: '#0f172a',
            border: '1px solid #1e293b',
            fontSize: 12,
            color: '#94a3b8',
            lineHeight: 1.5,
          }}
        >
          아래 4단계 카드를 순서대로 눌러보세요. 각 단계를 클릭하면 실시간 시뮬레이터가 해당 방어 단계로 자동 전환됩니다.
        </div>

        {STORY_STEPS.map((s, idx) => {
          const active = idx === activeStepIdx;
          return (
            <button
              key={s.num}
              type="button"
              onClick={() => void handleSelectStep(idx)}
              style={{
                textAlign: 'left',
                padding: '13px 15px',
                borderRadius: 10,
                border: active ? '1px solid #6366f1' : '1px solid #1e293b',
                background: active ? '#131c31' : '#0f172a',
                cursor: 'pointer',
                color: '#f8fafc',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <span
                  style={{
                    fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                    fontSize: 10.5,
                    fontWeight: 700,
                    color: active ? '#818cf8' : '#64748b',
                  }}
                >
                  {s.num}
                </span>
                <span style={{ fontSize: 10.5, color: '#94a3b8' }}>{s.tag}</span>
              </div>
              <div style={{ fontSize: 13.5, fontWeight: 700, marginBottom: 5, color: '#f8fafc' }}>{s.title}</div>
              <div style={{ fontSize: 12, color: '#94a3b8', lineHeight: 1.55 }}>{s.desc}</div>
            </button>
          );
        })}

        <button
          type="button"
          onClick={onSwitchToConsole}
          style={{
            padding: '9px 12px',
            borderRadius: 8,
            border: '1px solid #334155',
            background: '#111827',
            color: '#cbd5e1',
            fontSize: 12,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          상세 콘솔(워터폴·패킷 분석)로 보기
        </button>
      </div>

      {/* Right: Sticky Live Tactical Simulator */}
      <div className="pg-story-sticky">
        <div
          style={{
            padding: '10px 14px',
            borderRadius: 9,
            background: step.calloutBg,
            border: `1px solid ${step.calloutBorder}`,
            fontSize: 12.5,
            color: '#f8fafc',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 10,
            flexWrap: 'wrap',
          }}
        >
          <span>
            <strong style={{ color: step.calloutColor, marginRight: 8 }}>{step.num}</strong>
            {step.calloutText}
          </span>
          {activeStepIdx === 0 && (
            <span style={{ fontSize: 11.5, color: '#cbd5e1', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <span>원문 사례:</span>
              <IncidentLinks />
            </span>
          )}
        </div>

        {/* Compact 4 KPI Strip */}
        <div className="pg-story-kpis">
          <div style={{ background: '#111827', border: '1px solid #1e293b', borderRadius: 9, padding: '10px 12px' }}>
            <div style={{ fontSize: 11, color: '#94a3b8' }}>정상 유저 가용성</div>
            <div style={{ fontSize: 19, fontWeight: 800, color: '#34d399', fontVariantNumeric: 'tabular-nums' }}>
              {normalTotal ? `${Math.round((normalPassed / normalTotal) * 100)}%` : '100%'}
            </div>
          </div>
          <div style={{ background: '#111827', border: '1px solid #1e293b', borderRadius: 9, padding: '10px 12px' }}>
            <div style={{ fontSize: 11, color: '#94a3b8' }}>L1 · Edge WAF</div>
            <div style={{ fontSize: 19, fontWeight: 800, color: '#fbbf24', fontVariantNumeric: 'tabular-nums' }}>0% 차단</div>
          </div>
          <div style={{ background: '#111827', border: '1px solid #1e293b', borderRadius: 9, padding: '10px 12px' }}>
            <div style={{ fontSize: 11, color: '#94a3b8' }}>L2 · 코드 가드</div>
            <div style={{ fontSize: 19, fontWeight: 800, color: '#38bdf8', fontVariantNumeric: 'tabular-nums' }}>
              {attackTotal ? `${Math.round((attackBlocked / attackTotal) * 100)}%` : '0%'}
            </div>
          </div>
          <div style={{ background: '#111827', border: '1px solid #1e293b', borderRadius: 9, padding: '10px 12px' }}>
            <div style={{ fontSize: 11, color: '#94a3b8' }}>유출된 타인 주문서</div>
            <div
              style={{
                fontSize: 19,
                fontWeight: 800,
                color: totalLeakedOrders > 0 ? '#fda4af' : '#34d399',
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {totalLeakedOrders}건
            </div>
          </div>
        </div>

        <TacticalArena
          defenseMode={defenseMode}
          events={events}
          totalLeakedOrders={totalLeakedOrders}
          normalTotal={normalTotal}
          attackBlocked={attackBlocked}
          attackTotal={attackTotal}
          compact
          onTriggerBurst={onTriggerBurst}
        />

        <div className="pg-story-bottom">
          <div style={{ background: '#111827', border: '1px solid #1e293b', borderRadius: 10, padding: 12, minWidth: 0 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', marginBottom: 8 }}>
              최근 실시간 요청 (고정폭 배지)
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {events.slice(0, 4).map((ev) => (
                <div
                  key={ev.id}
                  className="pg-story-row"
                  style={{
                    background: '#0f172a',
                    border: '1px solid #1e293b',
                  }}
                >
                  <StatusBadge event={ev} />
                  <code
                    style={{
                      fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                      color: '#f1f5f9',
                      minWidth: 0,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {ev.method} {ev.path}
                  </code>
                  <span className="pg-story-actor" style={{ color: '#94a3b8' }}>
                    {ev.actor}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div style={{ background: '#111827', border: '1px solid #1e293b', borderRadius: 10, padding: 12, minWidth: 0 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', marginBottom: 8 }}>핵심 코드 / 자동화 검증</div>
            <pre
              style={{
                margin: 0,
                padding: 10,
                borderRadius: 7,
                background: '#070b12',
                border: '1px solid #1e293b',
                color: '#e2e8f0',
                fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                fontSize: 11,
                lineHeight: 1.5,
                overflowX: 'auto',
              }}
            >
              {step.codeSnippet}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}
