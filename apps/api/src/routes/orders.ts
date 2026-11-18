import { Router, Request, Response } from 'express';
import { store } from '../store.js';

export const ordersRouter = Router();

/**
 * [Module 1: BOLA / IDOR 실습 대상 라우트]
 *
 * GET /api/orders/:orderId
 * - 일반 사용자는 본인의 주문 번호(예: alice -> 1001, 1004)를 조회합니다.
 * - 공격자(mallory)는 본인의 유효한 로그인 토큰(tok_mallory_999)을 들고
 *   타인의 주문 번호(1001, 1002, 1003...)를 순회(Enumeration)하며 영수증/주소/카드뒷자리를 탈취합니다.
 */
ordersRouter.get('/:orderId', (req: Request, res: Response) => {
  const start = Date.now();
  const user = store.findUserByToken(req.headers.authorization);

  if (!user) {
    return res.status(401).json({ error: 'Authentication required (Missing or invalid Bearer token)' });
  }

  const orderId = Number(req.params.orderId);
  const order = store.getOrderById(orderId);

  if (!order) {
    return res.status(404).json({ error: 'Order not found' });
  }

  const isOwner = order.userId === user.id;
  const isAttackerProbe = !isOwner;

  // =========================================================================
  // [방어 계층 시뮬레이션 & 실습 포인트]
  // - v0.1-vulnerable: 인증(user 존재 여부)만 확인하고 소유권(isOwner)을 검증하지 않음!
  // - v0.2-waf-only  : 앞단 WAF가 켜져 있어도 GET /api/orders/1002 는 정상 HTTP 문법이므로 WAF 통과(PASS)!
  // - v0.3-patched   : 객체 수준 소유권 인가(Object-Level Authorization) 검증 수행
  // =========================================================================
  if (store.defenseMode === 'v0.3-patched') {
    if (!isOwner) {
      store.recordEvent({
        actor: user.username,
        actorType: user.role === 'attacker' ? 'attacker' : 'normal',
        scenario: 'BOLA_IDOR',
        method: 'GET',
        path: `/api/orders/${orderId}`,
        payloadSummary: `Bearer ${user.token} (owner=${order.ownerName})`,
        wafAction: 'PASS',
        appAction: 'BLOCKED_GUARD',
        statusCode: 404, // 존재 여부 노출(Enumeration) 방지를 위해 404 반환
        latencyMs: Date.now() - start + 4,
        impactDelta: { leakedOrders: 0, couponLossKrw: 0, stolenTokens: 0, falsePositives: 0 },
        detail: `Blocked cross-user order access: ${user.username} tried to read order #${orderId} owned by ${order.ownerName}`,
      });
      return res.status(404).json({ error: 'Order not found' });
    }
  }

  // 취약 상태(v0.1, v0.2)에서 타인 주문서가 그대로 반환되는 경우
  if (isAttackerProbe) {
    store.recordEvent({
      actor: user.username,
      actorType: 'attacker',
      scenario: 'BOLA_IDOR',
      method: 'GET',
      path: `/api/orders/${orderId}`,
      payloadSummary: `Bearer ${user.token} -> target order #${orderId}`,
      wafAction: 'PASS',
      appAction: 'EXPLOITED',
      statusCode: 200,
      latencyMs: Date.now() - start + 5,
      impactDelta: { leakedOrders: 1, couponLossKrw: 0, stolenTokens: 0, falsePositives: 0 },
      detail: `PII Leaked! Attacker ${user.username} accessed ${order.ownerName}'s order #${orderId} (${order.item}, card *${order.cardLast4}, ${order.shippingAddress})`,
    });
  } else {
    store.recordEvent({
      actor: user.username,
      actorType: 'normal',
      scenario: 'NORMAL_TRAFFIC',
      method: 'GET',
      path: `/api/orders/${orderId}`,
      payloadSummary: `Bearer ${user.token} (own order #${orderId})`,
      wafAction: 'PASS',
      appAction: 'ALLOWED',
      statusCode: 200,
      latencyMs: Date.now() - start + 3,
      impactDelta: { leakedOrders: 0, couponLossKrw: 0, stolenTokens: 0, falsePositives: 0 },
      detail: `Normal order lookup by owner ${user.username} (#${orderId})`,
    });
  }

  return res.json(order);
});
