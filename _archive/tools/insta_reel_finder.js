/* ============================================================
   인스타 바이럴 쇼핑 릴스 발굴기 (Insta Viral Shopping Reel Finder)
   ------------------------------------------------------------
   사용법:
   1) 크롬에서 instagram.com 에 로그인된 상태로 접속
   2) F12 → Console 탭 열기
   3) 이 파일 전체를 복사해 콘솔에 붙여넣고 Enter
   4) 자동으로 해시태그들을 긁어 점수순 표를 출력하고,
      viral_reels.csv 파일을 다운로드함
   ------------------------------------------------------------
   원리: 인스타 내부 web_info API(로그인 쿠키 사용)로 각 해시태그의
        'top' 섹션 릴스(조회수/좋아요/댓글/캡션)를 받아와 점수화.
   주의: 비공식 엔드포인트라 과도하게 돌리면 일시 차단될 수 있음.
        해시태그 5~8개, 하루 수 회 수준 권장.
   ============================================================ */

const IG_APP_ID = '936619743392459';

// 발굴할 해시태그 (원하는 대로 수정)
const TAGS = [
  'amazonfinds', 'amazonmusthaves', 'tiktokmademebuyit',
  'founditonamazon', 'amazonhome', 'amazonfavorites'
];

// --- 점수 기준 정규식 ---
const FUNNEL = /(comment|comenta|kommentier|tap ❤|i'?ll dm|dm you|send you the link|te env[ií]o|link in bio)/i;
const SHOP   = /(amazon|cart|shop|finds?|must.?have|gadget|deal|storefront|affiliat|best ?seller|prime day|product)/i;
const NOISE  = /(movie|scene|civil war|film| clip from|western|giveaway|\$?1,?000 |bike|laps|faith first)/i;

async function scrapeTag(tag) {
  const r = await fetch(
    'https://www.instagram.com/api/v1/tags/web_info/?tag_name=' + tag,
    { headers: { 'x-ig-app-id': IG_APP_ID }, credentials: 'include' }
  );
  const data = await r.json();
  const out = [];
  (function find(n) {
    if (!n || typeof n !== 'object') return;
    if (n.pk && n.user && n.code) out.push(n);
    if (Array.isArray(n)) { n.forEach(find); return; }
    for (const k in n) if (typeof n[k] === 'object') find(n[k]);
  })(data.data);
  const seen = new Set(), rows = [];
  for (const m of out) {
    if (seen.has(m.code)) continue; seen.add(m.code);
    rows.push({
      tag, code: m.code, url: 'https://www.instagram.com/reel/' + m.code + '/',
      user: m.user.username,
      like: m.like_count || 0, comment: m.comment_count || 0,
      play: m.play_count || m.ig_play_count || m.view_count || 0,
      type: m.media_type, ptype: m.product_type,
      paid: !!m.is_paid_partnership, taken: m.taken_at,
      caption: (m.caption && m.caption.text) || ''
    });
  }
  return rows;
}

function score(m) {
  const cap = m.caption || '';
  let s = Math.pow(m.play, 0.55) + m.comment * 6 + m.like * 0.4;
  if (FUNNEL.test(cap)) s *= 1.5;   // "댓글 달면 링크 DM" 펀널 = 구매의도
  if (SHOP.test(cap))   s *= 1.15;
  if (NOISE.test(cap))  s *= 0.3;
  return Math.round(s);
}

function toCSV(rows) {
  const esc = s => '"' + String(s).replace(/"/g, '""') + '"';
  const head = ['rank','score','play','like','comment','funnel','paid','date','tag','user','url','caption'];
  const body = rows.map((m, i) => [
    i + 1, m.score, m.play, m.like, m.comment, m.funnel ? 1 : 0, m.paid ? 1 : 0,
    new Date(m.taken * 1000).toISOString().slice(0, 10),
    m.tag, m.user, m.url, esc((m.caption || '').replace(/\s+/g, ' '))
  ].join(','));
  return head.join(',') + '\n' + body.join('\n');
}

function download(name, text) {
  const blob = new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
}

async function run({ minPlay = 1000, topN = 40 } = {}) {
  const pool = {}; // dedup by code
  for (const t of TAGS) {
    try {
      const rows = await scrapeTag(t);
      for (const m of rows) if (!pool[m.code] || m.play > pool[m.code].play) pool[m.code] = m;
      console.log(`✔ #${t}: ${rows.length}개`);
    } catch (e) { console.warn(`✘ #${t} 실패`, e); }
    await new Promise(r => setTimeout(r, 800)); // rate-limit 완화
  }
  let arr = Object.values(pool).filter(m => m.type === 2 && m.play >= minPlay);
  arr.forEach(m => { m.funnel = FUNNEL.test(m.caption || ''); m.score = score(m); });
  arr.sort((a, b) => b.score - a.score);
  arr = arr.slice(0, topN);

  console.table(arr.map((m, i) => ({
    rank: i + 1, score: m.score, play: m.play, like: m.like,
    comment: m.comment, funnel: m.funnel ? '✓' : '', user: m.user, url: m.url
  })));
  download('viral_reels.csv', toCSV(arr));
  console.log(`\n완료: 상위 ${arr.length}개 → viral_reels.csv 다운로드됨`);
  window.__viralReels = arr;
  return arr;
}

// 실행
run();
