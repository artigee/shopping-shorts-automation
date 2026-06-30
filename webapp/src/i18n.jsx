import { createContext, useCallback, useContext, useState } from 'react'

// 한국어 원문을 키로, 영어를 매핑. EN 없으면 한국어로 폴백.
// (Chrome 자동번역 대신 앱 내부 토글 → React 재렌더 충돌/크래시 없음)
const EN = {
  // App / 헤더 · 탭
  '발굴 콕핏': 'Discovery Cockpit',
  '발굴 + 아마존 게이트': 'Discovery + Amazon Gate',
  '① 발굴 (릴스 랭킹)': '① Discover (Reels)',
  '② 제작 대상': '② Production',
  '릴스': 'reels', '제품': 'products', '스냅샷': 'snapshots',

  // CollectView
  '네트워크': 'Network', '지역': 'Region',
  'US / 영어권': 'US / English', '한국': 'Korea',
  '해시태그 수집': 'Hashtag Collection',
  '아마존 파인즈': 'Amazon Finds', 'K-뷰티': 'K-Beauty', '홈·일상용품': 'Home·Daily', '패션': 'Fashion', '가전·가젯': 'Appliances·Gadgets',
  '개 해시태그': ' hashtags',
  '수집 중… (크롬에서 IG 호출)': 'Collecting… (calling IG via Chrome)',
  '＋ 수집 실행': '＋ Run collection',
  '수집': 'Collect',
  'ⓘ 수집 전': 'ⓘ Before collecting,',
  '로 디버그 크롬을 띄우고 그 창에서 instagram.com 로그인 상태여야 합니다.': 'open a debug Chrome and stay logged in to instagram.com there.',
  '수집 실패': 'Collection failed',
  '릴스 랭킹': 'Reels ranking',
  '펀널만': 'Funnel only', '전체': 'All', '단일': 'Single', '모음': 'Roundup',
  '노이즈 제외': 'Hide noise', '유료 제외': 'Hide paid', '최소': 'Min',
  '썸네일 클릭 → 제품 식별 → 제작 대상으로. (썸네일은 새로 수집한 릴스부터 표시)': 'Click a thumbnail → identify product → add to production. (thumbnails show from newly collected reels)',
  '아직 수집된 릴스 없음 — 위에서 수집을 실행하세요.': 'No reels yet — run a collection above.',
  '필터에 걸리는 릴스 없음 — 필터를 풀어보세요.': 'No reels match the filter — loosen it.',
  '단일': 'Single',
  'AD': 'AD', '펀널': 'Funnel',

  // IdentifyModal
  '🎯 제품 식별 → 제작 대상 만들기': '🎯 Identify product → create production',
  '닫기': 'Close', '취소': 'Cancel',
  'Claude CLI': 'Claude CLI', 'LLM(API)': 'LLM(API)', '휴리스틱': 'Heuristic',
  '📌 이 릴스가 구조·씬 분석 템플릿이 됩니다': '📌 This reel becomes the structure/scene template',
  '인스타에서 릴스 열기 ↗ (직접 보고 제품 확인)': 'Open reel on Instagram ↗ (verify product)',
  '▶ 제품 식별 시작 (Claude)': '▶ Start product identification (Claude)',
  '캡션을 읽어 제품명·카테고리·영어 검색어를 제안합니다.': 'Reads the caption to suggest product name, category, English search query.',
  '제품 식별 중 (Claude 비전/CLI)': 'Identifying product (Claude vision/CLI)',
  '다시 시도': 'Retry',
  '제품명 (한국어)': 'Product name (Korean)',
  '카테고리': 'Category', '식별 신뢰': 'Confidence',
  '🛒 아마존 제품 선택': '🛒 Select Amazon product',
  '(원본=직접입력 / 동급=검색)': '(original=manual / related=search)',
  '영어 검색어': 'English query', '검색': 'Search', '🔍 검색': '🔍 Search',
  '또는 정확한 제품 URL/ASIN (원본) — 예: B0DJ733JS1': 'or exact product URL/ASIN (original) — e.g. B0DJ733JS1',
  '가져오는 중…': 'Fetching…', '＋ 가져오기': '＋ Import',
  'ⓘ 디버그 크롬 필요. 후보를 눌러 선택하세요. 정확히 같은 제품이 아니어도 됨(별점·리뷰 좋은 동급품 OK).': 'ⓘ Debug Chrome required. Click a candidate to select. It need not be the exact product (a well-rated equivalent is fine).',
  '검색 결과 없음.': 'No results.',
  '원본': 'Original', '동급': 'Related',
  '(제목 못 가져옴 — ASIN만)': '(no title — ASIN only)',
  '선택': 'Selected', '제품 미선택 (나중에 카드에서 선택 가능)': 'No product selected (can pick later in the card)',
  '생성': 'Create', '생성 중…': 'Creating…',
  '제작 대상으로 추가 →': 'Add to production →',
  '식별 중…': 'Identifying…',

  // ProductsView
  '불러오는 중…': 'Loading…',
  '제작 대상 없음': 'No production targets',
  '제작 대상': 'Production targets', '개': '',
  '좌클릭 열기 · 우클릭 메뉴(삭제)': 'Left-click to open · right-click for menu (delete)',
  '후보': 'Candidate', '검증됨': 'Verified', '탈락': 'Eliminated', '제작완료': 'Produced',
  '이 필터에 해당하는 제품 없음': 'No products in this filter',
  '열기 / 편집': 'Open / Edit', '삭제': 'Delete',
  '출처 릴스': 'Source reels',
  '구매의도': 'Purchase intent', '릴스 ': 'reels ', '개 ': '',

  // VerifyPanel
  '✅ 검증됨': '✅ Verified',
  '릴스 원본 제품 (그 릴스와 동일)': 'Original product (same as the reel)',
  '동급 대체품 (비슷한 제품으로 판매)': 'Related substitute (sell a similar product)',
  '후보로 되돌리기': 'Back to candidate',
  'ASIN': 'ASIN', '가격': 'Price', '별점': 'Rating', '어필리에이트 링크': 'Affiliate link',
  '✘ 탈락 (아마존 구매불가)': '✘ Eliminated (not buyable on Amazon)',
  'Step 4 · 아마존 검증 게이트': 'Step 4 · Amazon Verification Gate',
  '🔍 아마존 검색': '🔍 Amazon Search', '검색 중…': 'Searching…',
  '아마존에 없음 → 탈락': 'Not on Amazon → eliminate',
  '또는 아마존 URL/ASIN 직접 입력 (예: B0DJ733JS1)': 'or enter Amazon URL/ASIN (e.g. B0DJ733JS1)',
  'ⓘ 디버그 크롬이 떠 있어야 검색됩니다. 정확히 같은 제품일 필요 없음 — ': 'ⓘ Debug Chrome must be open to search. Need not be the exact product — ',
  '별점·리뷰 좋은 동급품': 'a well-rated equivalent',
  '을 골라도 됩니다. (정확한 제품은 위 칸에 URL/ASIN 입력)': ' works too. (for the exact product, enter URL/ASIN above)',
  '📌 분석 대상 릴스 (씬 분석·구조 템플릿)': '📌 Reel for analysis (scene/structure template)',
  '릴스 열어 영상 확인 ↗': 'Open reel to watch ↗',
  '검색어를 바꿔보세요.': 'try a different query.',
  '광고': 'Ad', '이걸로 확정': 'Confirm this',

  // AnalysisPanel
  '🎬 릴스 분석': '🎬 Reel analysis', '구조·훅·씬 스크립트': 'structure·hooks·scene script',
  '분석 중… (영상 다운로드+비전, ~1분)': 'Analyzing… (download+vision, ~1min)',
  '🔄 재분석': '🔄 Re-analyze', '▶ 영상 분석 실행': '▶ Run video analysis',
  'ⓘ 디버그 크롬이 떠 있어야 영상을 받습니다. 릴스 영상→키프레임→Claude 비전으로 분석.': 'ⓘ Debug Chrome required to fetch video. Reel video→keyframes→Claude vision.',
  '영상 다운로드→프레임→비전 분석 중 (~1분)': 'Downloading→frames→vision analysis (~1min)',
  '훅': 'Hook', '구조': 'Structure', '페이싱': 'Pacing',
  '씬별 리메이크 스크립트': 'Scene-by-scene remake script',
  '자막': 'Caption', '씬 에셋 리스트': 'Scene asset list',
  '(④소싱/⑤조립 연결)': '(feeds ④sourcing/⑤assembly)',
  '영상': 'Video', '초': 's', '프레임': 'frames', '장 분석': ' analyzed',

  // ContentsView (③ 콘텐츠 제작)
  '③ 콘텐츠 제작': '③ Content Production',
  '③ 콘텐츠 제작 →': '③ Produce content →',
  '콘텐츠': 'Contents', '콘텐츠 없음': 'No contents',
  '② 제작 대상에서 [③ 콘텐츠 제작 →] 으로 만듭니다.': 'Create from ② Production via [③ Produce content →].',
  '씬': 'Scenes', '스크립트 전': 'No script yet', '분석 필요': 'Needs analysis',
  '씬 스크립트': 'Scene script', '씬 이미지': 'Scene images', '씬 영상 클립': 'Scene clips', '익스포트': 'Export',
  '② 영상 분석 먼저': '② Run video analysis first',
  '저장': 'Save', '스크립트 생성': 'Generate script',
  '🔄 재생성': '🔄 Regenerate', '▶ 스크립트 생성': '▶ Generate script',
  '릴스 설계도(분석)에 내 제품을 끼워 씬별 스크립트를 만듭니다. 자막·VO는 직접 수정 가능.': 'Builds a scene script from the reel blueprint (analysis) with your product. Edit captions/VO directly.',
  '영상화': 'Make video', '이미지만 / 이미지→영상': 'Image only / image→video',
  '다음 단계(이미지·영상·VO·익스포트)는 준비 중 — 스크립트 확정 후 이어집니다.': 'Next steps (images·video·VO·export) coming soon — after the script is finalized.',
  '테마': 'Theme', '적용 제품': 'Applied product', '(이 테마를 어느 제품에)': '(apply theme to which product)',
  '후보 없음 — ② 제작 대상에서 아마존 제품을 추가하세요.': 'No candidates — add Amazon products in ② Production.',

  // CandidatesPanel (② 후보 제품)
  '🛒 후보 제품': '🛒 Candidate products', '(이 테마에 적용할 원본+동급)': '(original+related for this theme)',
  'ⓘ 디버그 크롬 필요. 검색결과를 [＋후보로] 추가 → 콘텐츠 만들 때 그중 하나를 적용.': 'ⓘ Debug Chrome required. Add results via [＋add] → apply one when producing content.',
  '추가됨': 'Added', '＋후보로': '＋add', '내 후보': 'My candidates',
  '아직 후보 없음 — 위에서 검색/입력해 추가하세요.': 'No candidates yet — search/enter above to add.',
  '대표로': 'Set primary', '동급으로': '→ related', '원본으로': '→ original',
  '② 카드 후보 검색에 사용': 'used for candidate search in ② card',
  '대표': 'Primary', '(이 테마에 쓸 제품들 — 대표 1개 선택)': '(products for this theme — pick one as primary)',
  '만들면 ② 제작 대상이 생기고, 거기서 아마존 후보 제품을 검색·추가합니다.': 'Creates a ② Production target; add Amazon candidate products there.',

  // 신모델: ② 릴스 분석 / ③ 콘텐츠(분석×제품)
  '② 릴스 분석': '② Reel Analyses', '릴스 분석': 'Reel analyses',
  '분석 없음': 'No analyses', '분석 완료': 'Analyzed', '분석 전': 'Not analyzed', '분석': 'Analysis',
  '① 발굴에서 릴스 썸네일을 클릭(🎯)하면 분석 자산이 생깁니다.': 'Click a reel thumbnail (🎯) in ① Discover to create an analysis asset.',
  '③ 콘텐츠 만들기 →': '③ Make content →', '먼저 영상 분석을 실행하세요.': 'Run video analysis first.',
  '썸네일 클릭 → 릴스 분석 자산 생성(②). (썸네일은 새로 수집한 릴스부터 표시)': 'Click a thumbnail → create a reel-analysis asset (②). (thumbnails show from newly collected reels)',
  '② 릴스 분석에서 [③ 콘텐츠 만들기 →] 로 생성합니다.': 'Create from ② Reel Analyses via [③ Make content →].',
  '제품 선택됨': 'Product set', '제품 미선택': 'No product', '제품 변경': 'Change product',
  '적용 제품': 'Applied product', '(이 구조로 팔 제품 선택)': '(pick the product to sell with this structure)',
  'ⓘ 디버그 크롬 필요. 검색결과에서 하나 선택 → 적용 제품으로.': 'ⓘ Debug Chrome required. Pick one from results → applied product.',
  '이걸로': 'Use this', '제품 미선택 (일반)': 'No product (generic)',
  '릴스 구조(분석)에 선택 제품을 끼워 씬별 스크립트를 만듭니다. 자막·VO는 직접 수정 가능.': 'Builds a scene script from the reel structure (analysis) with the chosen product. Edit captions/VO directly.',

  // 4탭 구조
  '① 발굴': '① Discover', '③ 제품 선택': '③ Product Selection', '④ 콘텐츠 제작': '④ Content Production',
  '④ 콘텐츠 만들기 →': '④ Make content →',
  '제품 검색·추가': 'Search·add products', '제품 라이브러리': 'Product library', '우클릭 메뉴(삭제)': 'Right-click menu (delete)',
  'ⓘ 디버그 크롬 필요. 검색결과를 [＋라이브러리]에 담아두고, ④ 콘텐츠에서 분석과 짝지어 씁니다.': 'ⓘ Debug Chrome required. Add results to the library, then pair with an analysis in ④ Content.',
  '＋라이브러리': '＋library', '라이브러리 비어있음 — 위에서 검색해 추가하세요.': 'Library empty — search above to add.',
  '새 콘텐츠': 'New content', '제품': 'Product',
  '＋새 콘텐츠 또는 ②분석·③제품에서 [콘텐츠 만들기]로 생성. 콘텐츠 = 분석 × 제품.': '＋New content, or [Make content] from ②Analysis/③Product. Content = analysis × product.',
  '분석 선택': 'Pick analysis', '제품 선택': 'Select product', '— 분석 선택 —': '— pick analysis —', '— 제품 선택 —': '— pick product —',
  '제품 미선택 (일반 스크립트)': 'No product (generic script)',

  // 제품 선택 흐름 (분석 → 제품 선택 → 스크립트)
  '제품 선택 →': 'Select product →',
  '분석 (구조 템플릿)': 'Analysis (structure template)',
  '기본 = 원본과 동일 · 또는 아마존에서 새 관련 제품': 'Default = same as original · or a new related product from Amazon',
  '제휴 링크': 'affiliate link', '제품 변경': 'Change product',
  '원본 제품 추천 중': 'Suggesting original product', '원본 제품 추정': 'Original product (guess)', '이걸로 검색': 'search this',
  '영어 검색어 (기본=원본 제품)': 'English query (default = original product)', '🔍 검색': '🔍 Search',
  '또는 아마존 URL/ASIN 직접 입력': 'or paste an Amazon URL/ASIN', '선택': 'Select', '③ 선반에서': 'From ③ shelf',
  '② 릴스 분석에서 [제품 선택 →]을 누르면 콘텐츠가 생성됩니다. 콘텐츠 = 분석 + 제품.': 'Press [Select product →] in ② Reel Analysis to create a content. Content = analysis + product.',
  '릴스 구조(분석)에 선택한 제품을 끼워 씬별 스크립트를 만듭니다. 자막·VO는 직접 수정 가능.': 'Builds a per-scene script by fitting the selected product into the reel structure. Captions/VO are editable.',
  'ⓘ 제품을 먼저 선택하면 그 제품 기준으로 생성됩니다 (미선택 시 일반 스크립트).': 'ⓘ Pick a product first to generate around it (generic script if none).',
  'ⓘ 디버그 크롬 필요. 자주 쓰는 제품을 선반에 담아두면, ④ 콘텐츠 제품 선택에서 바로 고를 수 있습니다.': 'ⓘ Debug Chrome required. Stock products on the shelf to quick-pick them in ④ Content product selection.',

  // ③ 제품 선택 카드 + ④ 연결
  '제품 선택 카드': 'Product-selection cards', '카드 없음': 'No cards',
  '② 릴스 분석에서 [제품 선택 →]을 누르면 여기에 카드가 생깁니다.': 'Press [Select product →] in ② Reel Analysis to create a card here.',
  '제품 미선택': 'No product yet', '④ 콘텐츠 제작 →': '④ Produce content →', '먼저 제품을 선택하세요.': 'Select a product first.',
  '📌 원본 릴스 (이 제품을 기준으로 검색)': '📌 Original reel (search is based on its product)', '릴스 열기 ↗': 'Open reel ↗',
  '기본 = 원본과 동일한 제품(자동 검색). 또는 검색어를 바꿔 새 관련 제품을 고릅니다.': 'Default = the same product as the original (auto-searched). Or change the query to pick a new related product.',
  '원본 제품 자동 검색 중': 'Auto-searching original product', '검색 결과 없음 — 검색어를 바꿔보세요.': 'No results — try another query.',
  '② 분석 → [제품 선택 →] → ③ 제품 선택 → [④ 콘텐츠 제작 →] 순서로 진행됩니다.': 'Flow: ② Analysis → [Select product →] → ③ Product selection → [④ Produce content →].',
  '③ 제품 변경': '③ Change product', '③ 제품 선택': '③ Select product',

  // 원본 기본 선택 + 아마존 override
  '📌 원본 릴스': '📌 Original reel',
  '기본 = 릴스의 원본 제품. 아마존 검색은 다른 제품으로 바꾸고 싶을 때만(선택).': "Default = the reel's original product. Amazon search is optional, only to swap to a different product.",
  '원본 제품 식별 중': 'Identifying original product', '원본 제품 (기본)': 'Original product (default)',
  '릴스에서 식별 · 아마존 링크 없음': 'Identified from reel · no Amazon link', '원본으로': 'Back to original',
  '아마존 검색으로 교체': 'Swap via Amazon search', '아마존에서 다른 제품으로 교체': 'Swap to another product on Amazon',
  '이걸로 교체': 'Swap to this', '영어 검색어': 'English query',

  // 전체 스크립트 → 씬 분해 + 최종형
  '전체 스크립트': 'Overall script', '씬 클립': 'Scene clips',
  '풀무비': 'Full movie', '카드형': 'Card', '최종형': 'Final form',
  '카드형(이미지)': 'Card (images)', '풀무비(클립)': 'Full movie (clips)',
  '· 씬별 클립 생성': '· generate per-scene clips', '· 클립 생성 스킵': '· skip clip generation',
  '구조만 빌려 새로 작성': 'borrow structure only, write fresh', '전체 스크립트를 씬+이미지 프롬프트로 분해': 'split overall into scenes + image prompts',
  '각도(angle)': 'Angle', '훅 멘트': 'Hook line', '전체 나레이션': 'Full narration', '비트(줄바꿈 구분)': 'Beats (one per line)',
  '릴스 분석의 구조를 이해해 선택 제품으로 전체 스크립트를 새로 씁니다. 생성 후 직접 교정하세요.': "Understands the reel's structure and writes a fresh overall script for the selected product. Edit after generating.",
  '▶ 생성': '▶ Generate', '▶ 씬 분해': '▶ Split into scenes',
  '다음: 3. 씬 이미지 생성(Higgsfield) — 씬 스크립트 확정 후 이어집니다.': 'Next: 3. Scene images (Higgsfield) — after scene scripts are finalized.',

  // 스텝3 씬 이미지 (옵션2)
  '프롬프트 검수 → 생성 (영상 전, 비용 절약)': 'Review prompt → generate (before video, saves cost)', '프롬프트 저장': 'Save prompts',
  '프롬프트를 검수·수정한 뒤, 채팅에서': 'After reviewing/editing the prompts, in chat say',
  '이미지 생성': 'generate images',
  '이라고 요청하세요. 제가 제품 이미지를 레퍼런스로 Higgsfield 생성 → output 폴더 저장 → 여기 표시합니다. (자동 생성 안 함 = 비용 절약)': '— I will generate via Higgsfield using the product image as reference → save to the output folder → show them here. (No auto-generation = saves cost.)',
  '미생성': 'none', '생성됨': 'generated', '대기': 'pending', '제품 레퍼런스': 'product reference',
  '다음: 4. 씬 클립 — 영상화 켠 씬만, 이미지 확정 후.': 'Next: 4. Scene clips — only video-enabled scenes, after images are final.',
  '카드형: 이미지 확정 후 5. 익스포트. (클립 스킵)': 'Card mode: after images, go to 5. Export. (clips skipped)',
  "지시 재생성": "Guided regen", "반영": "Apply",
  "이렇게 고쳐줘 — 예: 후크 더 세게, 캠핑 빼고 일상 강조": "Tell me how to fix it — e.g. stronger hook, drop camping, emphasize daily use",
  "씬을 이렇게 고쳐줘 — 예: 씬 6개로 줄여, 마지막 CTA 더 강하게": "Tell me how to fix the scenes — e.g. cut to 6 scenes, stronger final CTA",
  "HF_CREDENTIALS 미설정 — 버튼 생성 불가.": "HF_CREDENTIALS not set — button generation disabled.",
  "넣고 재시작하면 버튼이 켜집니다. 또는 채팅에서": "add it and restart to enable the button. Or in chat say",
  "(옵션2)": "(option 2)", "HF_CREDENTIALS 필요": "HF_CREDENTIALS required",
  "씬별 [생성] → Higgsfield 생성 → output 폴더 저장 → 표시. 프롬프트 고치고 [재생성]으로 반복 (비용=씬 단위).": "Per-scene [Generate] → Higgsfield → saved to output folder → shown. Edit prompt and [Regenerate] to iterate (cost = per scene).",
  "🖼 생성": "🖼 Generate", "콘텐츠": "Content",
  "원본 열기": "Open full size",
  "전 씬 스타일": "All-scene style", "예: 여성 손, 한국 가정집, 밝은 자연광 (모든 씬 생성에 자동 적용)": "e.g. female hands, Korean home, bright natural light (auto-applied to every scene)",
  "아마존 실제 치수 (스케일에 자동 반영)": "Real Amazon dimensions (auto-applied to scale)",
  "이미지→영상 클립으로 만들 씬": "Scene to turn into an image→video clip",
  "이미지 프롬프트 (영어) — 수정하면 저장됨, [재생성]이 이 내용을 사용": "Image prompt (EN) — edits are saved; [Regenerate] uses this text",
  "이미지→영상 (영상화 켠 씬만, ~1-2분/클립)": "Image→video (only video-enabled scenes, ~1-2 min/clip)",
  "클립은 그 씬의 이미지를 입력으로 씁니다 — 이미지 먼저 확정. 영상화 OFF 씬은 정지 이미지로 사용.": "Each clip uses that scene's image as input — finalize images first. Video-OFF scenes stay as still images.",
  "영상화 켠 씬이 없습니다 — step 3에서 ☑영상화 체크.": "No video-enabled scenes — check ☑Make video in step 3.",
  "이미지 없음": "no image", "클립 생성됨": "clip ready", "이미지 먼저": "image first", "먼저 이미지 생성": "generate the image first",
  "클립 생성": "Generating clip", "🎬 클립 생성": "🎬 Generate clip",
  "VO(영어)·익스포트는 다음 단계.": "VO (English) and export are next.", "카드형: 이미지 확정 후 익스포트. (클립 스킵)": "Card mode: finalize images then export. (clips skipped)",
  "영어 VO 생성": "Generate English VO", "🔊 VO 재생성": "🔊 Regenerate VO",
  "프리뷰 무비 (ffmpeg)": "Preview movie (ffmpeg)", "현재 클립/이미지 + VO 이어붙임 (테스트용, Higgsfield 아님)": "Stitches current clips/images + VO (test only, not Higgsfield)",
  "합성 중": "Assembling", "🔄 다시 합성": "🔄 Re-assemble", "▶ 프리뷰 합성": "▶ Build preview",
  "씬 순서대로: 클립 있으면 클립, 없으면 정지 이미지. VO 있으면 깔림. 정식 익스포트는 다음 단계.": "Scene order: clip if present else still image; VO laid under. Final export is next.",
  "씬마다 애니메이션/정지 선택. 애니메이션 = 그 씬 이미지로 클립 생성(이미지 먼저). 정지 = 이미지 그대로. 모션 지시는 직접 편집 → [재생성].": "Per scene choose Animate/Static. Animate = make a clip from that scene's image (image first). Static = keep the still image. Edit the motion direction → [Regenerate].",
  "애니메이션": "Animate", "정지": "Static",
  "애니메이션 지시 — 카메라/움직임 (예: slow push-in, product lifted toward camera)": "Animation direction — camera/motion (e.g. slow push-in, product lifted toward camera)",
  "정지 이미지로 사용 (애니메이션 없음)": "Used as a still image (no animation)",
  "VO 미생성": "no VO yet", "🔊 재생성": "🔊 Regenerate", "🔊 VO 생성": "🔊 Generate VO",
  "샷 설명": "Shot description", "씬 삭제": "Delete scene", "이 씬을 삭제할까요?": "Delete this scene?",
  "씬 추가 (예: CTA 손동작)": "Add scene (e.g. CTA hand motion)",
  "🖼 전체 이미지 생성": "🖼 Generate all images", "🎬 전체 클립 생성": "🎬 Generate all clips", "🔊 전체 VO 생성": "🔊 Generate all VO",
  "썸네일": "Thumbnail",
  "먼저 ② 릴스 분석에서 🎬 영상 분석을 실행하세요.": "Run 🎬 video analysis in ② Reel Analysis first.",
  "구조만 빌려 새로 작성 · 직접 수정 가능": "Borrow structure only, write fresh · editable",
  "저장된 전체 스크립트로 분해 · 직접 수정 가능": "Crafted from the overall story — hook + storytelling applied · editable",
  "먼저 전체 스크립트를 생성하세요.": "Generate the overall script first.",
  "연출 지시": "Direction", "훅·샷 스타일 — 스크립트 생성에 항상 반영": "Hook & shot style — always applied to script generation",
  "샷 수": "Shots", "자동": "Auto",
  "씬을 새로 생성하면 기존 이미지·클립·VO가 모두 초기화됩니다. 계속할까요?": "Regenerating scenes will clear all existing images, clips and VO. Continue?",
  "먼저 씬 스크립트를 생성하세요.": "Generate the scene script first.",
  "모든 씬 이미지를 생성합니다 (기존은 덮어씀). 계속할까요?": "Generate images for all scenes (overwrites existing). Continue?",
  "영상화(✨) 켠 씬에 이미지가 먼저 있어야 합니다.": "Animate (✨) scenes need an image first.",
  "영상화 켠 씬의 클립을 모두 생성합니다 (기존 덮어씀). 계속할까요?": "Generate clips for all animate scenes (overwrites existing). Continue?",
  "VO 텍스트가 있는 씬이 없습니다.": "No scenes with VO text.",
  "모든 VO를 생성합니다 (기존 덮어씀). 계속할까요?": "Generate VO for all scenes (overwrites existing). Continue?",
  "연출 지시 (훅·샷)": "Direction (hook · shots)",
  "예: 강한 훅(충격 사실/호기심), 다이내믹하고 다양한 샷, 빠른 컷. 스토리는 전체 스크립트 유지.": "e.g. strong hook (shocking fact/curiosity), dynamic varied shots, fast cuts. Story stays from the overall script.",
  "예: 강한 훅(충격 사실/호기심), 다이내믹하고 다양한 샷, 빠른 컷, 문제→공감→해결": "e.g. strong hook (shocking fact/curiosity), dynamic varied shots, fast cuts, problem→relate→solve",
  "이 지시는 1.전체 스크립트·2.씬 분해 재생성에 반영됩니다. (수정 후 재생성)": "This direction is applied when regenerating 1.Overall script & 2.Scene split. (edit then regenerate)",
  "이 씬 레퍼런스": "Refs for this scene", "이 씬에 쓸 제품 사진 선택 (없으면 메인)": "Pick product photos for this scene (else main)",
  "레퍼런스": "Refs", "레퍼런스: 메인": "Refs: main",

  "레퍼런스 추가": "Add reference", "공개 이미지 URL (https://…) — 첫 레퍼런스로 추가": "Public image URL (https://…) — added as first reference", "추가": "Add",

  "파일": "File", "업로드": "Uploading", "파일 읽기 실패": "Failed to read file",

  "이미지 실패": "image failed", "클립 실패": "clip failed", "실패": "failed", "일부 실패 — 씬": "Some failed — scenes", "개별 [재생성]으로 다시": "retry individually with [Regenerate]",

  "정식 익스포트 (Remotion)": "Final export (Remotion)", "자막·전환·VO·CTA 합성 (1080×1920)": "Captions·transitions·VO·CTA (1080×1920)", "렌더 중": "Rendering", "🔄 다시 익스포트": "🔄 Re-export", "▶ 익스포트": "▶ Export", "mp4 다운로드": "Download mp4", "첫 렌더는 Remotion이 헤드리스 크롬을 받아서 느릴 수 있습니다(~1분+).": "First render is slow — Remotion downloads a headless Chrome (~1min+).",

  "VO 페르소나 (화자)": "VO persona (voice)", "예: been-burned skeptic now a little obsessed, deadpan / lazy genius / broke foodie / over-it parent": "e.g. been-burned skeptic now a little obsessed, deadpan / lazy genius / broke foodie / over-it parent", "VO는 이 한 사람의 연속 모놀로그(반응·아하·감각). 타이틀=주장, VO=타이틀이 못 하는 것. 수정 후 재생성.": "VO = one persons continuous monologue (react/aha/sensory). Title=claim, VO=what the title cant. Edit then regenerate.",

  "생성 언어": "Gen language", "분석·스크립트·VO가 모두 이 언어/지역으로 생성됩니다 (번역 X)": "Analysis, script & VO all generate in this language/region (no translation)", "앱 라벨 언어 (콘텐츠 생성 언어와 별개)": "App label language (separate from content generation language)",

  "화자 (페르소나)": "Voice (persona)", "훅 / 스토리텔링": "Hook / storytelling", "— 기본 (회의적·데드팬) —": "— default (skeptic, deadpan) —", "직접 입력": "Custom", "나만의 화자 — 예: tired night-shift nurse, deadpan": "Your own voice — e.g. tired night-shift nurse, deadpan", "— 자동 (분석 구조 따름) —": "— auto (follow analyzed structure) —", "화자=목소리, 훅=이야기 모양. 둘 다 shorts-playbook 폴더에서 옴. VO는 이 화자의 연속 모놀로그, 타이틀=주장. 바꾼 뒤 재생성.": "Voice=the persona, hook=the story shape. Both come from the shorts-playbook folder. VO is this voices continuous monologue; title=claim. Regenerate after changing.",

  "릴스에서 식별 · 아래에서 아마존 링크 고르기 ↓": "Identified from reel · pick an Amazon link below ↓", "🔗 아마존 링크 찾기": "🔗 Find Amazon link", "이 제품을 아마존에서 찾기 — 골라서 링크 붙이기": "Find this product on Amazon — pick one to attach the link",

  "🔗 이 링크로": "🔗 Use this link",

  "릴스 제품 · 직접 링크는 숨겨짐(comment-for-link) → 아래에서 아마존 제품 고르기 ↓": "Reel product · its link is hidden (comment-for-link) → pick an Amazon product below ↓", "원본 + 관련 상품 — 하나 골라 콘텐츠 제품으로 (링크 포함)": "Original + related products — pick one as your content product (with link)", "이걸로": "Use this",

  "아마존에서 원본 제품 링크 자동 탐색 중": "Auto-finding the original product on Amazon", "🔄 다른 제품으로 교체 (선택)": "🔄 Swap to a different product (optional)",

  "릴스 제품을 생김새로 매칭 중": "Matching the reel product by appearance",
  "원본 제품": "Original product",

  "분석 중": "Analyzing", "💡 추천 받기": "💡 Get recommendation", "이 추천 적용": "Apply this", "💡 추천 = 제품·릴스 분석 기반 화자+훅 제안. 화자=목소리, 훅=이야기 모양 (shorts-playbook 폴더). 바꾼 뒤 재생성.": "💡 Recommend = best voice+hook from the product & reel analysis. Voice=persona, hook=story shape (shorts-playbook). Regenerate after changing.",

  "추천 설정": "Recommended setup", "릴스·제품 분석 기반": "from reel + product analysis", "화자=목소리, 훅=이야기 모양. 정하면 아래 전체·씬 스크립트가 모두 이 톤으로 생성됩니다. 바꾼 뒤 재생성.": "Voice=persona, hook=story shape. Once set, both the overall and scene scripts generate in this tone. Regenerate after changing.", "익스포트": "Export", "프리뷰 & 정식 익스포트": "Preview & final export",

  "씬 순서대로: 클립 있으면 클립, 없으면 정지 이미지. VO 있으면 깔림. (빠른 테스트용)": "In order: clip if present, else still image. VO underlaid if present. (quick test only)",

  "✍ 전체 프롬프트 생성": "✍ Generate all prompts", "✍ 프롬프트": "✍ Prompt", "이미지 프롬프트(설명) 생성 — 검수 후 이미지 생성": "Generate the image prompt (description) — review, then generate the image", "프롬프트 실패": "prompt failed", "모든 씬의 이미지 프롬프트를 생성합니다 (기존 덮어씀). 계속할까요?": "Generate image prompts for all scenes (overwrites existing). Continue?",

  "타이틀 (자막)": "Title (caption)", "이미지 설명/프롬프트 — [✍ 프롬프트]로 생성하거나 직접 작성. [재생성]이 이 내용을 사용": "Image description/prompt — use [✍ Prompt] to generate or write your own. [Regenerate] uses this", "추가 카메라/연기 모션 (선택) — 비우면 잔잔한 기본 모션. 이미지 설명은 자동 상속": "Extra camera/acting motion (optional) — empty = gentle default; the image description is inherited automatically",

  "이미지 아이디어/지시 (선택) — 예: 접는 동작 말고 가방에 든 모습": "Image idea/direction (optional) — e.g. not the folding action, show it already in the bag", "이미지 설명 생성 — 위 아이디어 반영, 비우면 자동": "Generate the image description — uses the idea above, or auto if empty",

  "캐릭터 레퍼런스": "Character reference", "모든 씬에 이 인물": "Same person in every scene", "인물 사진 URL (https://…) — 모든 씬 동일 인물": "Person photo URL (https://…) — same person in all scenes", "환경/무드": "Scene/mood", "이 씬 공간/무드 레퍼런스": "This scene space/mood reference", "공간/무드 추가": "Add space/mood", "파일": "File",

  "카메라 무빙": "Camera move", "기본 (느린 push in)": "Default (slow push in)", "추가 연기/액션 (선택) — 카메라 무빙은 위에서. 한 컷에 한 동작, 느리게": "Extra action (optional) — camera move is above. One move per shot, slow",

  "✨ 자동 (씬에 맞게)": "✨ Auto (fit the beat)",

  "클릭해서 크게 보기": "Click to view full size", "이 레퍼런스를 삭제할까요?": "Delete this reference?",

  "직접 추가 (URL)": "Add from URL", "발굴 없이 릴스를 직접 가져와 리믹스. 릴스 URL 필수 · 제품 링크(아마존)는 선택 — 비우면 분석이 비전으로 매칭.": "Bring a reel directly (no Discovery) and remix it. Reel URL required · product link (Amazon) optional — leave empty and analysis vision-matches it.", "릴스 URL": "Reel URL", "제품 링크 (선택)": "Product link (optional)", "아마존 URL/ASIN (지금) · TikTok Shop·올리브영·쿠팡 등은 추후": "Amazon URL/ASIN (now) · TikTok Shop/Olive Young/Coupang later", "생성 중…": "Creating…", "＋ 분석 만들기": "＋ Create analysis", "① 발굴에서 릴스 썸네일을 클릭(🎯)하거나, 위 [직접 추가 (URL)]로 릴스를 직접 가져오세요.": "Click a reel thumbnail (🎯) in ① Discover, or use [Add from URL] above to bring a reel directly.",

}

const Ctx = createContext({ lang: 'ko', t: (s) => s, setLang: () => {} })

export function LangProvider({ children }) {
  const [lang, setLang] = useState(() => (typeof localStorage !== 'undefined' && localStorage.getItem('lang')) || 'ko')
  const set = useCallback((l) => { setLang(l); try { localStorage.setItem('lang', l) } catch { /* ignore */ } }, [])
  const t = useCallback((s) => (lang === 'en' ? (EN[s] ?? s) : s), [lang])
  return <Ctx.Provider value={{ lang, t, setLang: set }}>{children}</Ctx.Provider>
}

export function useT() { return useContext(Ctx) }
