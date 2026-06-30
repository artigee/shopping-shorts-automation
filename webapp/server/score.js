// 발굴 점수 로직 — tools/insta_reel_finder.js 의 철학 상속:
//   진짜 신호 = 구매의도(댓글). 펀널("댓글→링크 DM")이면 강하게 가중.
// 릴스 단위 점수. 제품 단위 정규화 점수는 Step 3에서 별도.

export const FUNNEL = /(comment|comenta|kommentier|tap ❤|tap heart|i'?ll dm|dm you|send you the link|te env[ií]o|link in bio)/i
export const SHOP   = /(amazon|cart|shop|finds?|must.?have|gadget|deal|storefront|affiliat|best ?seller|prime day|product)/i
export const NOISE  = /(movie|scene|civil war|film| clip from|western|giveaway|\$?1,?000 |bike|laps|faith first)/i

export function flags(caption = '') {
  return {
    funnel: FUNNEL.test(caption),
    shop: SHOP.test(caption),
    noise: NOISE.test(caption),
  }
}

export function scoreReel(m) {
  const cap = m.caption || ''
  let s = Math.pow(m.play || 0, 0.55) + (m.comment || 0) * 6 + (m.like || 0) * 0.4
  if (FUNNEL.test(cap)) s *= 1.5 // "댓글 달면 링크 DM" 펀널 = 구매의도
  if (SHOP.test(cap)) s *= 1.15
  if (NOISE.test(cap)) s *= 0.3
  return Math.round(s)
}
