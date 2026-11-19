import React, { useState } from 'react';
import type { DefenseMode } from '../App';

export interface ServiceModuleStage {
  id: string;
  code: string;
  stageLabel: string;
  endpoint: string;
  vulnName: string;
  incident: string;
  status: 'live' | 'planned';
  phaseTag: string;
  before: string;
  after: string;
  layerSummary: string;
}

export const PAYGUARD_MODULES: ServiceModuleStage[] = [
  {
    id: 'm1-idor',
    code: 'M1',
    stageLabel: '주문 조회 API',
    endpoint: 'GET /api/orders/:id',
    vulnName: 'BOLA / IDOR',
    incident: 'USPS (2018) · Peloton (2021)',
    status: 'live',
    phaseTag: 'v0.1 ➔ v0.4 검증 완료',
    before: '로그인(AuthN)만 확인해 주문번호만 바꾸면 타인 영수증·배송지 조회 가능 (정상 문법이라 WAF 차단 0%)',
    after: 'order.userId === user.id 소유권 인가 가드 + 404 은폐 + GitHub Actions PR 회귀 차단 게이트',
    layerSummary: 'L2 AppSec Guard + L4 CI Gate',
  },
  {
    id: 'm2-sqli',
    code: 'M2',
    stageLabel: '상품 검색·정렬',
    endpoint: 'GET /api/products?sort=',
    vulnName: 'SQL Injection (ORDER BY)',
    incident: 'TalkTalk (2015) · MOVEit (2023)',
    status: 'planned',
    phaseTag: 'Module 2 예정',
    before: 'ORM 바인딩 불가 구간(ORDER BY) 문자열 결합으로 DB 스키마 탈취 + WAF 단독 적용 시 정상 검색어 오탐(FP)',
    after: 'Prepared Statement + 정렬 컬럼 화이트리스트(Allowlist) 매핑 테이블 + WAF 오탐 예외 튜닝',
    layerSummary: 'L1 WAF Tuning + L2/L3 Allowlist',
  },
  {
    id: 'm3-xss',
    code: 'M3',
    stageLabel: '상품 리뷰·세션',
    endpoint: 'POST /api/reviews',
    vulnName: 'XSS · JWT · CSRF · CSP',
    incident: 'TweetDeck (2014) · British Airways (2018)',
    status: 'planned',
    phaseTag: 'Module 3 예정',
    before: '리뷰 DOM Stored XSS + localStorage 토큰 탈취 + 무검증 상태 변경 요청 위조',
    after: 'DOMPurify 살균 + 세션 토큰 HttpOnly; SameSite 쿠키 전환 + CSRF 토큰 + 엄격한 CSP 헤더',
    layerSummary: 'L2 Output Encoding + Cookie/CSP',
  },
  {
    id: 'm4-race',
    code: 'M4',
    stageLabel: '선착순 쿠폰 결제',
    endpoint: 'POST /api/coupons/redeem',
    vulnName: 'Race Condition (TOCTOU)',
    incident: 'Starbucks 기프트카드 (2015)',
    status: 'planned',
    phaseTag: 'Module 4 예정',
    before: '조회 후 차감(TOCTOU) 틈을 노린 동시 20요청 단일 패킷 공격으로 1회용 쿠폰 중복 발급 성공',
    after: 'DB 비관적 락 / 원자적 조건부 UPDATE + Idempotency-Key 멱등성 보장',
    layerSummary: 'L3 Atomic DB Lock + Idempotency',
  },
  {
    id: 'm5-auth-ci',
    code: 'M5',
    stageLabel: '로그인·통합 CI',
    endpoint: 'POST /api/auth/login',
    vulnName: 'Credential Stuffing · CI',
    incident: 'DraftKings 계정 탈취 (2022)',
    status: 'planned',
    phaseTag: 'Module 5 예정',
    before: '유출 계정 대량 대입(Brute-force) 무방비 + 배포 전 수동 보안 점검',
    after: '계정·IP 이중 Sliding Window Rate Limit + Semgrep(SAST)·Trivy(SCA)·5대 공격 회귀(DAST) 통합 파이프라인',
    layerSummary: 'L1/L3 Dual Rate Limit + L4 Full CI',
  },
];

interface ServiceEvolutionBarProps {
  defenseMode: DefenseMode;
  onSelectMode?: (mode: DefenseMode) => Promise<void>;
}

export function ServiceEvolutionBar({ defenseMode, onSelectMode }: ServiceEvolutionBarProps) {
  const [selectedId, setSelectedId] = useState<string>('m1-idor');
  const activeModule = PAYGUARD_MODULES.find((m) => m.id === selectedId) ?? PAYGUARD_MODULES[0];

  const m1LiveState =
    defenseMode === 'v0.3-patched'
      ? { text: '강화 완료 (공격 0%)', color: '#34d399', border: 'rgba(52, 211, 153, 0.45)', bg: 'rgba(6, 78, 59, 0.28)' }
      : defenseMode === 'v0.2-waf-only'
        ? { text: 'WAF 우회 노출', color: '#fbbf24', border: 'rgba(251, 191, 36, 0.45)', bg: 'rgba(120, 53, 15, 0.25)' }
        : { text: 'v0.1 취약 노출', color: '#fda4af', border: 'rgba(244, 63, 94, 0.45)', bg: 'rgba(136, 19, 55, 0.25)' };

  return (
    <section
      aria-label="PayGuard 단일 서비스 단계별 보안 진화 맵"
      data-testid="pg-service-evolution"
      style={{
        marginBottom: 14,
        padding: '12px 14px',
        borderRadius: 10,
        background: '#0b1220',
        border: '1px solid #1e293b',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 10,
          flexWrap: 'wrap',
          marginBottom: 10,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span
            style={{
              fontSize: 10.5,
              fontWeight: 800,
              letterSpacing: '0.07em',
              padding: '2px 8px',
              borderRadius: 999,
              background: '#1e1b4b',
              border: '1px solid #4338ca',
              color: '#c7d2fe',
              fontFamily: "'JetBrains Mono', ui-monospace, monospace",
            }}
          >
            ONE SERVICE · PROGRESSIVE HARDENING
          </span>
          <strong style={{ fontSize: 13.5, color: '#f8fafc' }}>
            PayGuard 단일 서비스 단계별 보안 진화 로드맵
          </strong>
          <span style={{ fontSize: 12, color: '#94a3b8' }}>
            (하나의 커머스 API에서 5대 핵심 모듈을 차례로 패치·자동화)
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', fontSize: 11.5 }}>
          <span
            style={{
              padding: '3px 9px',
              borderRadius: 999,
              background: '#064e3b',
              border: '1px solid #059669',
              color: '#a7f3d0',
              fontWeight: 700,
            }}
          >
            누적 하드닝: 1 / 5 모듈 완료 (M1 Live)
          </span>
        </div>
      </div>

      {/* 5-Module Progression Track */}
      <div className="pg-evo-track">
        {PAYGUARD_MODULES.map((mod) => {
          const isSelected = mod.id === activeModule.id;
          const isLive = mod.status === 'live';
          return (
            <button
              key={mod.id}
              type="button"
              data-testid={`pg-evo-${mod.code.toLowerCase()}`}
              onClick={() => setSelectedId(mod.id)}
              style={{
                textAlign: 'left',
                padding: '9px 11px',
                borderRadius: 9,
                cursor: 'pointer',
                background: isSelected ? '#131c31' : isLive ? m1LiveState.bg : '#0f172a',
                border: isSelected
                  ? '1px solid #6366f1'
                  : isLive
                    ? `1px solid ${m1LiveState.border}`
                    : '1px solid #1e293b',
                color: '#f8fafc',
                display: 'flex',
                flexDirection: 'column',
                gap: 3,
                minWidth: 0,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 4 }}>
                <span
                  style={{
                    fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                    fontSize: 11,
                    fontWeight: 800,
                    color: isLive ? '#38bdf8' : '#94a3b8',
                  }}
                >
                  {mod.code} · {mod.vulnName}
                </span>
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 800,
                    padding: '1px 6px',
                    borderRadius: 999,
                    background: isLive ? 'rgba(16, 185, 129, 0.16)' : '#1e293b',
                    color: isLive ? m1LiveState.color : '#94a3b8',
                    whiteSpace: 'nowrap',
                    flexShrink: 0,
                  }}
                >
                  {isLive ? m1LiveState.text : '예정'}
                </span>
              </div>
              <div style={{ fontSize: 12.5, fontWeight: 700, color: '#f8fafc' }}>{mod.stageLabel}</div>
              <code
                style={{
                  fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                  fontSize: 10.5,
                  color: '#94a3b8',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {mod.endpoint}
              </code>
            </button>
          );
        })}
      </div>

      {/* Focused Module Before -> After Strip */}
      <div
        data-testid="pg-evo-detail"
        style={{
          marginTop: 9,
          padding: '8px 11px',
          borderRadius: 8,
          background: '#0f172a',
          border: '1px solid #1e293b',
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
          fontSize: 12,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span
              style={{
                fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                fontSize: 11,
                fontWeight: 800,
                padding: '2px 7px',
                borderRadius: 5,
                background: activeModule.status === 'live' ? '#065f46' : '#1e293b',
                color: activeModule.status === 'live' ? '#a7f3d0' : '#cbd5e1',
              }}
            >
              {activeModule.code} · {activeModule.phaseTag}
            </span>
            <strong style={{ color: '#f8fafc' }}>
              {activeModule.stageLabel} ({activeModule.endpoint})
            </strong>
            <span style={{ color: '#94a3b8', fontSize: 11.5 }}>
              실제 사고 모티브: {activeModule.incident} · 방어 계층: {activeModule.layerSummary}
            </span>
          </div>

          {activeModule.status === 'live' && onSelectMode && (
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <span style={{ fontSize: 11, color: '#94a3b8', marginRight: 2 }}>M1 방어 단계 전환:</span>
              {(
                [
                  ['v0.1-vulnerable', 'v0.1 취약'],
                  ['v0.2-waf-only', 'v0.2 WAF'],
                  ['v0.3-patched', 'v0.3+v0.4 패치·CI'],
                ] as [DefenseMode, string][]
              ).map(([m, label]) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => void onSelectMode(m)}
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    padding: '2px 7px',
                    borderRadius: 5,
                    cursor: 'pointer',
                    border: defenseMode === m ? '1px solid #38bdf8' : '1px solid #334155',
                    background: defenseMode === m ? '#0c4a6e' : '#111827',
                    color: defenseMode === m ? '#e0f2fe' : '#94a3b8',
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="pg-evo-compare">
          <div
            style={{
              padding: '5px 9px',
              borderRadius: 6,
              background: 'rgba(244, 63, 94, 0.1)',
              border: '1px solid rgba(244, 63, 94, 0.3)',
              color: '#fecdd3',
              lineHeight: 1.45,
            }}
          >
            <strong style={{ color: '#fda4af', marginRight: 6 }}>Before (취약)</strong>
            {activeModule.before}
          </div>
          <span className="pg-evo-arrow" aria-hidden="true" style={{ color: '#64748b', fontWeight: 800 }}>
            ➔
          </span>
          <div
            style={{
              padding: '5px 9px',
              borderRadius: 6,
              background: 'rgba(16, 185, 129, 0.1)',
              border: '1px solid rgba(16, 185, 129, 0.3)',
              color: '#d1fae5',
              lineHeight: 1.45,
            }}
          >
            <strong style={{ color: '#34d399', marginRight: 6 }}>After (강화)</strong>
            {activeModule.after}
          </div>
        </div>
      </div>
    </section>
  );
}
