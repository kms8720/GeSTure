import { createHash, timingSafeEqual } from 'node:crypto';
import type { RequestHandler } from 'express';

/** 관객 참여 토큰과 별개이며, URL이나 공개 QR에 넣지 않는다. */
export function operatorAuth(token: string | undefined): RequestHandler
{
  const expected = token ? createHash('sha256').update(token).digest() : null;
  return (request, response, next) =>
  {
    response.setHeader('Cache-Control', 'no-store');
    if (!expected)
    {
      response.status(503).json({ ok: false, error: '운영자 키가 설정되지 않았습니다. OPERATOR_TOKEN을 설정해 주세요.' });
      return;
    }
    const header = request.get('authorization') ?? '';
    const supplied = header.startsWith('Bearer ') ? header.slice(7) : '';
    const actual = createHash('sha256').update(supplied).digest();
    if (!supplied || !timingSafeEqual(expected, actual))
    {
      response.status(401).json({ ok: false, error: '운영자 키를 확인해 주세요.' });
      return;
    }
    next();
  };
}
