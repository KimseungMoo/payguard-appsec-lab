/**
 * Module 1: BOLA / IDOR 혼합 트래픽 & 공격 검증 스크립트
 *
 * 실행 방법:
 * 1. API 서버 기동: npm run dev:api
 * 2. 다른 터미널에서 실행: npm run test:idor
 *
 * 동작:
 * - 일반 사용자(alice, bob, charlie)가 본인 주문을 정상 조회하는 트래픽을 발생시키는 동시에,
 * - 공격자(mallory)가 본인 토큰(tok_mallory_999)으로 orderId 1001~1005를 순회(Enumeration) 공격합니다.
 */

const API_BASE = process.env.API_BASE || 'http://localhost:4000';

interface SimStep {
  label: string;
  token: string;
  orderId: number;
  expectedOwner: string;
  isAttack: boolean;
}

const mixedScenario: SimStep[] = [
  { label: 'Normal: Alice checks her own order #1001', token: 'tok_alice_101', orderId: 1001, expectedOwner: 'alice_kim', isAttack: false },
  { label: 'Normal: Bob checks his own order #1002', token: 'tok_bob_102', orderId: 1002, expectedOwner: 'bob_lee', isAttack: false },
  { label: 'Attack: Mallory enumerates order #1001 (Alice)', token: 'tok_mallory_999', orderId: 1001, expectedOwner: 'alice_kim', isAttack: true },
  { label: 'Normal: Charlie checks his own order #1003', token: 'tok_charlie_103', orderId: 1003, expectedOwner: 'charlie_park', isAttack: false },
  { label: 'Attack: Mallory enumerates order #1002 (Bob)', token: 'tok_mallory_999', orderId: 1002, expectedOwner: 'bob_lee', isAttack: true },
  { label: 'Attack: Mallory enumerates order #1003 (Charlie)', token: 'tok_mallory_999', orderId: 1003, expectedOwner: 'charlie_park', isAttack: true },
  { label: 'Normal: Alice checks her second order #1004', token: 'tok_alice_101', orderId: 1004, expectedOwner: 'alice_kim', isAttack: false },
  { label: 'Attack: Mallory enumerates order #1004 (Alice)', token: 'tok_mallory_999', orderId: 1004, expectedOwner: 'alice_kim', isAttack: true },
];

async function run() {
  const stateRes = await fetch(`${API_BASE}/api/simulation/state`);
  const state = (await stateRes.json()) as { defenseMode: string };

  console.log(`\n=============================================================`);
  console.log(` PayGuard Module 1 (BOLA/IDOR) Benchmark — Mode: ${state.defenseMode}`);
  console.log(`=============================================================\n`);

  let normalTotal = 0;
  let normalOk = 0;
  let attackTotal = 0;
  let attackSucceeded = 0;

  for (const step of mixedScenario) {
    const res = await fetch(`${API_BASE}/api/orders/${step.orderId}`, {
      headers: { Authorization: `Bearer ${step.token}` },
    });

    if (!step.isAttack) {
      normalTotal++;
      if (res.status === 200) {
        normalOk++;
        console.log(`🟢 [PASS] ${step.label} -> HTTP 200`);
      } else {
        console.log(`🟡 [FALSE POSITIVE] ${step.label} -> HTTP ${res.status}`);
      }
    } else {
      attackTotal++;
      if (res.status === 200) {
        attackSucceeded++;
        const body = (await res.json()) as { ownerName: string; item: string; shippingAddress: string };
        console.log(`🔴 [EXPLOITED] ${step.label} -> HTTP 200 (Leaked: ${body.ownerName}, ${body.item}, ${body.shippingAddress})`);
      } else {
        console.log(`🛡️ [BLOCKED]   ${step.label} -> HTTP ${res.status}`);
      }
    }

    await new Promise((r) => setTimeout(r, 250));
  }

  console.log(`\n-------------------------------------------------------------`);
  console.log(` Normal Traffic Availability : ${normalOk}/${normalTotal} (${((normalOk / normalTotal) * 100).toFixed(0)}%)`);
  console.log(` Attack Exploit Rate         : ${attackSucceeded}/${attackTotal} (${((attackSucceeded / attackTotal) * 100).toFixed(0)}%)`);
  console.log(`-------------------------------------------------------------\n`);
}

run().catch((err) => {
  console.error('Failed to connect to PayGuard API. Run `npm run dev` first.', err.message);
  process.exit(1);
});
