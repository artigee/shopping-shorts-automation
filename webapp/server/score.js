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

// ── v2: 절대 트래픽이 아니라 "계정 대비 성과(바이럴 배수) × 참여율 × 구매의도" ──
// v1의 문제: play^0.55 + comments*6 은 대형 계정이 항상 이긴다. followers를 전혀 안 쓴다.
// v2: 팔로워당 재생(viral multiple)과 참여율로 정규화 → 작은 계정의 진짜 아웃라이어가 떠오른다.
export function scoreReelV2(m) {
  const cap = m.caption || ''
  const followers = Math.max(Number(m.followers) || 0, 1000)   // 미상·초소형 노이즈 방지 플로어
  const plays = m.play || 0, comments = m.comment ?? m.comments ?? 0, likes = m.like ?? m.likes ?? 0
  const traction = comments * 6 + Math.pow(plays, 0.55) * 0.5 + likes * 0.2      // 절대 신호(가중 축소)
  const viral = Math.min(plays / followers, 200)                                  // 팔로워당 재생 = 아웃라이어 배수
  const er = Math.min((comments + likes) / followers, 2)                          // 참여율
  let s = traction * (1 + Math.min(viral / 40, 3)) * (1 + Math.min(er * 5, 1.5))
  if (FUNNEL.test(cap)) s *= 1.5
  if (SHOP.test(cap)) s *= 1.15
  if (NOISE.test(cap)) s *= 0.3
  return Math.round(s)
}
