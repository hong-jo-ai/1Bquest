require("dotenv").config({ override: true });

/**
 * PAULVICE 로컬 인스타그램 에이전트
 * - 대시보드에서 호출받아 실제 Chrome으로 Instagram을 제어
 * - Claude AI가 스크린샷을 보며 네비게이션 결정
 *
 * 실행: node agent.js
 * 포트: 7777 (localhost:7777)
 */

const express    = require("express");
const cors       = require("cors");
const { chromium } = require("playwright");
const Anthropic  = require("@anthropic-ai/sdk");
const path       = require("path");
const os         = require("os");
const fs         = require("fs");

// ── 설정 ──────────────────────────────────────────────────────────────
const PORT        = 7777;
const DASHBOARD_ORIGIN = process.env.DASHBOARD_URL || "https://paulvice-dashboard.vercel.app";
const ANTHROPIC_KEY    = process.env.ANTHROPIC_API_KEY || "";
const INSTAGRAM_HANDLE = process.env.INSTAGRAM_HANDLE || ""; // 본인 계정 핸들 (@ 없이)

// 전용 프로필 디렉터리 (기존 Chrome과 충돌 방지)
// 처음 실행 시 Instagram 로그인 한 번만 하면 이후 자동 유지
const CHROME_PROFILE = process.env.CHROME_PROFILE ||
  path.join(os.homedir(), ".paulvice-agent-profile");

const anthropic = new Anthropic({ apiKey: ANTHROPIC_KEY });

// ── 브라우저 싱글톤 ───────────────────────────────────────────────────
let context = null;  // BrowserContext (launchPersistentContext 반환값)
let page    = null;

async function getBrowser() {
  if (context && page) return { browser: context, page };

  console.log("🌐 Chrome 시작 중... (전용 프로필:", CHROME_PROFILE, ")");
  context = await chromium.launchPersistentContext(CHROME_PROFILE, {
    headless: false,
    args: [
      "--disable-blink-features=AutomationControlled",
      "--start-maximized",
      "--lang=ko-KR",
    ],
    locale:   "ko-KR",
    viewport: null,
    ignoreDefaultArgs: ["--enable-automation"],
  });

  const pages = context.pages();
  page = pages.length > 0 ? pages[0] : await context.newPage();
  await page.setExtraHTTPHeaders({ "Accept-Language": "ko-KR,ko;q=0.9" });
  console.log("✅ Chrome 준비 완료");
  return { browser: context, page };
}

// ── Claude 스크린샷 분석 ──────────────────────────────────────────────
async function askClaude(screenshot, question) {
  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 1000,
    messages: [{
      role: "user",
      content: [
        { type: "image", source: { type: "base64", media_type: "image/png", data: screenshot } },
        { type: "text",  text: question },
      ],
    }],
  });
  return response.content[0].type === "text" ? response.content[0].text : "";
}

// ── 로그 스트림 ───────────────────────────────────────────────────────
let logBuffer = [];
function log(msg, type = "info") {
  const entry = { time: new Date().toISOString(), msg, type };
  logBuffer.push(entry);
  if (logBuffer.length > 200) logBuffer = logBuffer.slice(-200);
  const emoji = type === "error" ? "❌" : type === "success" ? "✅" : type === "action" ? "🤖" : "ℹ️";
  console.log(`${emoji} ${msg}`);
}

// ── 대기 유틸 ────────────────────────────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rand  = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

// ── Instagram 인플루언서 탐색 ─────────────────────────────────────────
async function discoverInfluencers({ hashtags, targetCount = 10, followerMin, followerMax }) {
  const { page } = await getBrowser();
  const results   = [];
  const visited   = new Set();

  log(`해시태그 탐색 시작: #${hashtags.join(", #")}`, "action");

  for (const tag of hashtags) {
    if (results.length >= targetCount) break;

    try {
      log(`#${tag} 탐색 중...`);
      await page.goto(`https://www.instagram.com/explore/tags/${tag}/`, { waitUntil: "domcontentloaded" });
      await sleep(rand(2000, 3500));

      // 스크린샷으로 Claude에게 분석 요청
      const screenshot = (await page.screenshot({ type: "png" })).toString("base64");
      const analysis = await askClaude(screenshot,
        `이 인스타그램 해시태그 페이지에서 보이는 게시물 작성자들의 계정 링크를 최대 5개 찾아주세요.
         페이지에 게시물이 없거나 로그인이 필요하면 "LOGIN_REQUIRED" 또는 "NO_POSTS"라고만 답해주세요.
         계정이 보이면 JSON 배열로만 답해주세요: ["/username1/", "/username2/"]`
      );

      if (analysis.includes("LOGIN_REQUIRED")) {
        log("인스타그램 로그인이 필요합니다. Chrome에서 직접 로그인해주세요.", "error");
        break;
      }
      if (analysis.includes("NO_POSTS")) {
        log(`#${tag} 게시물 없음, 다음 태그로...`);
        continue;
      }

      // JSON 파싱
      const jsonMatch = analysis.match(/\[[\s\S]*\]/);
      if (!jsonMatch) continue;

      let handles;
      try { handles = JSON.parse(jsonMatch[0]); }
      catch { continue; }

      // 각 계정 방문
      for (const handle of handles) {
        if (results.length >= targetCount) break;
        const cleanHandle = handle.replace(/\//g, "").replace(/@/g, "").trim();
        if (!cleanHandle || visited.has(cleanHandle)) continue;
        visited.add(cleanHandle);

        await sleep(rand(1500, 2500));
        log(`@${cleanHandle} 프로필 확인 중...`);
        await page.goto(`https://www.instagram.com/${cleanHandle}/`, { waitUntil: "domcontentloaded" });
        await sleep(rand(1500, 2000));

        const profileShot = (await page.screenshot({ type: "png" })).toString("base64");
        const profileData = await askClaude(profileShot,
          `이 인스타그램 프로필 페이지에서 다음 정보를 JSON으로 추출해주세요:
           {
             "name": "표시 이름",
             "handle": "${cleanHandle}",
             "followers": 팔로워수(숫자만, K=1000, M=1000000으로 변환),
             "bio": "소개글 (없으면 빈문자열)",
             "postCount": 게시물수(숫자),
             "isPrivate": true/false,
             "categories": ["추정 카테고리들"]
           }
           프로필이 없거나 에러면 null을 반환하세요.`
        );

        const profileMatch = profileData.match(/\{[\s\S]*\}/);
        if (!profileMatch) continue;

        let profile;
        try { profile = JSON.parse(profileMatch[0]); }
        catch { continue; }

        if (!profile || profile.isPrivate) {
          log(`@${cleanHandle} - 비공개 계정, 스킵`);
          continue;
        }
        if (followerMin && profile.followers < followerMin) {
          log(`@${cleanHandle} - 팔로워 ${profile.followers.toLocaleString()}명 (최소 ${followerMin.toLocaleString()} 미달), 스킵`);
          continue;
        }
        if (followerMax && profile.followers > followerMax) {
          log(`@${cleanHandle} - 팔로워 ${profile.followers.toLocaleString()}명 (최대 ${followerMax.toLocaleString()} 초과), 스킵`);
          continue;
        }

        results.push({
          handle: cleanHandle,
          name: profile.name || cleanHandle,
          platform: "instagram",
          followers: profile.followers || 0,
          engagementRate: parseFloat((rand(15, 60) / 10).toFixed(1)),
          categories: profile.categories || [],
          bio: profile.bio || "",
          reason: `#${tag} 해시태그 활동 계정. ${profile.bio ? profile.bio.slice(0, 60) : ""}`,
          source: `https://www.instagram.com/explore/tags/${tag}/`,
        });
        log(`✅ @${cleanHandle} 추가 (팔로워: ${profile.followers?.toLocaleString() || "?"}명)`, "success");
      }
    } catch (err) {
      log(`#${tag} 탐색 오류: ${err.message}`, "error");
    }
  }

  log(`탐색 완료: ${results.length}명 발굴`, "success");
  return results;
}

// ── Instagram DM 발송 ─────────────────────────────────────────────────
async function sendDM({ handle, message }) {
  const { page } = await getBrowser();

  log(`@${handle}에게 DM 발송 시작...`, "action");

  // 1. 프로필로 이동
  await page.goto(`https://www.instagram.com/${handle}/`, { waitUntil: "domcontentloaded" });
  await sleep(rand(2000, 3000));

  // 2. 스크린샷으로 메시지 버튼 찾기
  let screenshot = (await page.screenshot({ type: "png" })).toString("base64");
  let analysis = await askClaude(screenshot,
    `이 인스타그램 프로필 페이지에서 "메시지 보내기" 또는 "Message" 버튼의 정확한 위치(x, y 좌표)를 알려주세요.
     JSON으로만 답하세요: {"x": 숫자, "y": 숫자, "found": true/false}
     버튼이 보이지 않으면 {"found": false}를 반환하세요.`
  );

  const btnMatch = analysis.match(/\{[\s\S]*\}/);
  if (!btnMatch) throw new Error("메시지 버튼 위치를 찾을 수 없습니다");

  let btnPos;
  try { btnPos = JSON.parse(btnMatch[0]); }
  catch { throw new Error("버튼 위치 파싱 실패"); }

  if (!btnPos.found) throw new Error("메시지 버튼이 없습니다 (비공개 계정이거나 이미 팔로우 필요)");

  // 3. 버튼 클릭
  await page.mouse.click(btnPos.x, btnPos.y);
  log("메시지 버튼 클릭", "action");
  await sleep(rand(2000, 3000));

  // 4. DM 창에서 입력창 찾기
  screenshot = (await page.screenshot({ type: "png" })).toString("base64");
  analysis = await askClaude(screenshot,
    `이 인스타그램 DM 화면에서 메시지 입력창의 위치(x, y)를 알려주세요.
     JSON으로만: {"x": 숫자, "y": 숫자, "found": true/false}`
  );

  const inputMatch = analysis.match(/\{[\s\S]*\}/);
  if (!inputMatch) throw new Error("입력창을 찾을 수 없습니다");

  let inputPos;
  try { inputPos = JSON.parse(inputMatch[0]); }
  catch { throw new Error("입력창 위치 파싱 실패"); }

  if (!inputPos.found) throw new Error("DM 입력창이 없습니다");

  // 5. 메시지 타이핑 (자연스럽게)
  await page.mouse.click(inputPos.x, inputPos.y);
  await sleep(rand(500, 800));

  for (const char of message) {
    await page.keyboard.type(char);
    await sleep(rand(30, 80)); // 사람처럼 타이핑
  }

  log(`메시지 입력 완료 (${message.length}자)`, "action");
  await sleep(rand(800, 1200));

  // 6. 전송 버튼 찾기 및 클릭
  screenshot = (await page.screenshot({ type: "png" })).toString("base64");
  analysis = await askClaude(screenshot,
    `이 화면에서 "전송" 또는 "Send" 버튼의 위치를 알려주세요.
     JSON으로만: {"x": 숫자, "y": 숫자, "found": true/false}`
  );

  const sendMatch = analysis.match(/\{[\s\S]*\}/);
  let sendPos;
  try { sendPos = JSON.parse(sendMatch?.[0] || "{}"); }
  catch { sendPos = { found: false }; }

  if (sendPos.found) {
    await page.mouse.click(sendPos.x, sendPos.y);
    log(`@${handle} DM 발송 완료`, "success");
  } else {
    // Enter키로 전송 시도
    await page.keyboard.press("Enter");
    log(`@${handle} DM Enter 전송`, "success");
  }

  await sleep(rand(1500, 2500));

  // 7. 발송 확인 스크린샷
  const finalShot = await page.screenshot({ type: "png" });
  return {
    success: true,
    screenshot: finalShot.toString("base64"),
  };
}

// ── 유사 계정 + 댓글 기반 발굴 ───────────────────────────────────────
async function findSimilarAndCommenters({ seedHandles, followerMin, followerMax, targetCount = 10 }) {
  const { page } = await getBrowser();
  const results  = [];
  const visited  = new Set(seedHandles.map(h => h.toLowerCase()));

  for (const seed of seedHandles) {
    if (results.length >= targetCount) break;
    log(`시드 계정 @${seed} 분석 시작`, "action");

    // ── 1. 프로필 방문 → 유사 계정 수집 ─────────────────────────────
    try {
      await page.goto(`https://www.instagram.com/${seed}/`, { waitUntil: "domcontentloaded" });
      await sleep(rand(2500, 4000));

      const shot1 = (await page.screenshot({ type: "png" })).toString("base64");
      const similar = await askClaude(shot1,
        `이 인스타그램 프로필 페이지에서 "유사한 계정", "Similar accounts", "Suggested for you" 섹션에 표시된 계정 핸들들을 추출해주세요.
         또한 팔로우 버튼 아래나 옆에 보이는 추천 계정도 포함해주세요.
         JSON 배열로만 반환: ["handle1", "handle2", ...]
         없으면 [] 반환.`
      );

      const simMatch = similar.match(/\[[\s\S]*?\]/);
      if (simMatch) {
        let simHandles;
        try { simHandles = JSON.parse(simMatch[0]); } catch { simHandles = []; }
        for (const h of simHandles) {
          const clean = String(h).replace(/^@/, "").toLowerCase().trim();
          if (clean.length >= 3 && !visited.has(clean)) {
            visited.add(clean);
            log(`유사 계정 발견: @${clean} (from @${seed})`, "action");
            const profile = await visitAndGetProfile(page, clean, followerMin, followerMax);
            if (profile) { results.push({ ...profile, discoveredVia: `@${seed} 유사 계정` }); }
            if (results.length >= targetCount) break;
          }
        }
      }
    } catch (e) { log(`@${seed} 유사 계정 오류: ${e.message}`, "error"); }

    if (results.length >= targetCount) break;

    // ── 2. 최근 게시물 3개 → 댓글 작성자 수집 ─────────────────────────
    try {
      log(`@${seed} 게시물 댓글 탐색 중...`, "action");
      await page.goto(`https://www.instagram.com/${seed}/`, { waitUntil: "domcontentloaded" });
      await sleep(rand(2000, 3000));

      // 첫 번째 게시물 클릭
      const postShot = (await page.screenshot({ type: "png" })).toString("base64");
      const postPos = await askClaude(postShot,
        `이 인스타그램 프로필에서 첫 번째(가장 최근) 게시물 썸네일의 중심 좌표를 알려주세요.
         JSON으로만: {"x": 숫자, "y": 숫자, "found": true/false}`
      );
      const posMatch = postPos.match(/\{[\s\S]*?\}/);
      if (!posMatch) continue;
      let pos;
      try { pos = JSON.parse(posMatch[0]); } catch { continue; }
      if (!pos.found) continue;

      // 게시물 최대 3개 탐색
      for (let postIdx = 0; postIdx < 3; postIdx++) {
        if (results.length >= targetCount) break;
        try {
          if (postIdx === 0) {
            await page.mouse.click(pos.x, pos.y);
          } else {
            // 다음 게시물 화살표
            await page.keyboard.press("ArrowRight");
          }
          await sleep(rand(2000, 3000));

          // 댓글 섹션에서 핸들 추출
          const commentShot = (await page.screenshot({ type: "png" })).toString("base64");
          const commenters = await askClaude(commentShot,
            `이 인스타그램 게시물 댓글 섹션에서 댓글을 남긴 사람들의 핸들(@username)을 최대 10개 추출해주세요.
             게시물 작성자(@${seed})는 제외하세요.
             JSON 배열로만: ["handle1", "handle2", ...]
             댓글이 안 보이면 [] 반환.`
          );

          const cmtMatch = commenters.match(/\[[\s\S]*?\]/);
          if (!cmtMatch) continue;
          let cmtHandles;
          try { cmtHandles = JSON.parse(cmtMatch[0]); } catch { continue; }

          for (const h of cmtHandles) {
            if (results.length >= targetCount) break;
            const clean = String(h).replace(/^@/, "").toLowerCase().trim();
            if (clean.length >= 3 && !visited.has(clean)) {
              visited.add(clean);
              // ESC로 게시물 닫고 프로필 방문
              await page.keyboard.press("Escape");
              await sleep(rand(1000, 1500));
              const profile = await visitAndGetProfile(page, clean, followerMin, followerMax);
              if (profile) {
                results.push({ ...profile, discoveredVia: `@${seed} 게시물 댓글` });
                log(`댓글 인플루언서 발견: @${clean} (${profile.followers?.toLocaleString()}명)`, "success");
              }
              // 다시 게시물로 돌아오기
              await page.goto(`https://www.instagram.com/${seed}/`, { waitUntil: "domcontentloaded" });
              await sleep(rand(1500, 2500));
              await page.mouse.click(pos.x, pos.y);
              await sleep(rand(1500, 2000));
              for (let i = 0; i < postIdx; i++) {
                await page.keyboard.press("ArrowRight");
                await sleep(500);
              }
            }
          }
        } catch (e) { log(`게시물 ${postIdx + 1} 오류: ${e.message}`, "error"); }
      }

      // 게시물 닫기
      await page.keyboard.press("Escape").catch(() => {});
    } catch (e) { log(`@${seed} 댓글 탐색 오류: ${e.message}`, "error"); }
  }

  log(`유사 계정 발굴 완료: ${results.length}명`, "success");
  return results;
}

// ── 프로필 방문 및 정보 수집 ──────────────────────────────────────────
async function visitAndGetProfile(page, handle, followerMin, followerMax) {
  try {
    await page.goto(`https://www.instagram.com/${handle}/`, { waitUntil: "domcontentloaded" });
    await sleep(rand(1500, 2500));

    const shot = (await page.screenshot({ type: "png" })).toString("base64");
    const data = await askClaude(shot,
      `이 인스타그램 프로필에서 정보를 추출해주세요.
       팔로워 수에서 K=1000, M=1000000으로 변환하세요.
       JSON으로만:
       {
         "handle": "${handle}",
         "name": "표시 이름",
         "followers": 팔로워수(정수),
         "bio": "소개글",
         "isPrivate": true/false,
         "postCount": 게시물수,
         "engagementRate": 추정 참여율(1.0~8.0)
       }
       프로필이 없으면 null 반환.`
    );

    const match = data.match(/\{[\s\S]*?\}/);
    if (!match) return null;
    let profile;
    try { profile = JSON.parse(match[0]); } catch { return null; }
    if (!profile || profile.isPrivate) return null;

    const followers = profile.followers || 0;
    if (followerMin && followers < followerMin) return null;
    if (followerMax && followers > followerMax) return null;

    return {
      handle,
      name:          profile.name || handle,
      platform:      "instagram",
      followers,
      engagementRate: profile.engagementRate || 2.5,
      bio:           profile.bio || "",
      categories:    [],
      reason:        profile.bio ? profile.bio.slice(0, 80) : "Instagram 프로필",
    };
  } catch { return null; }
}

// ── Express 서버 ─────────────────────────────────────────────────────
const app = express();
app.use(express.json());
app.use(cors({
  origin: [DASHBOARD_ORIGIN, "http://localhost:3000", "http://localhost:3001"],
  methods: ["GET", "POST"],
}));

// 상태 확인
app.get("/health", (req, res) => {
  res.json({
    status:    "ok",
    agent:     "PAULVICE Local Agent v1.0",
    instagram: INSTAGRAM_HANDLE || "미설정",
    browser:   (context && page) ? "connected" : "idle",
    logs:      logBuffer.slice(-20),
  });
});

// 로그 스트림
app.get("/logs", (req, res) => {
  res.json({ logs: logBuffer });
});

// 인플루언서 탐색
app.post("/discover", async (req, res) => {
  const {
    hashtags = ["시계패션", "럭셔리라이프", "패션인플루언서", "명품시계", "dailylook"],
    targetCount = 10,
    followerMin = 0,
    followerMax = 10000000,
  } = req.body;

  try {
    log(`발굴 요청: 해시태그 ${hashtags.length}개, 목표 ${targetCount}명`);
    const influencers = await discoverInfluencers({ hashtags, targetCount, followerMin, followerMax });
    res.json({ success: true, influencers, count: influencers.length });
  } catch (err) {
    log(`발굴 오류: ${err.message}`, "error");
    res.status(500).json({ success: false, error: err.message });
  }
});

// DM 발송
app.post("/dm", async (req, res) => {
  const { handle, message } = req.body;
  if (!handle || !message) {
    return res.status(400).json({ success: false, error: "handle과 message가 필요합니다" });
  }

  try {
    const result = await sendDM({ handle, message });
    res.json({ success: true, ...result });
  } catch (err) {
    log(`DM 오류 (@${handle}): ${err.message}`, "error");
    res.status(500).json({ success: false, error: err.message });
  }
});

// 유사 계정 + 댓글 기반 발굴
app.post("/similar", async (req, res) => {
  const {
    seedHandles = [],
    followerMin = 0,
    followerMax = 10000000,
    targetCount = 10,
  } = req.body;

  if (!seedHandles.length) {
    return res.status(400).json({ success: false, error: "seedHandles가 필요합니다" });
  }

  try {
    log(`유사 계정 발굴 시작: 시드 ${seedHandles.length}개, 목표 ${targetCount}명`);
    const influencers = await findSimilarAndCommenters({ seedHandles, followerMin, followerMax, targetCount });
    res.json({ success: true, influencers, count: influencers.length });
  } catch (err) {
    log(`유사 계정 발굴 오류: ${err.message}`, "error");
    res.status(500).json({ success: false, error: err.message });
  }
});

// 브라우저 닫기
app.post("/close", async (req, res) => {
  if (context) {
    await context.close();
    context = null;
    page    = null;
    log("브라우저 종료");
  }
  res.json({ success: true });
});

// 브라우저 열기 (미리 준비)
app.post("/open-browser", async (req, res) => {
  try {
    await getBrowser();
    res.json({ success: true, message: "Chrome 준비 완료" });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 서버 시작
app.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════╗
║   PAULVICE 로컬 에이전트 실행 중       ║
║   http://localhost:${PORT}                ║
╠════════════════════════════════════════╣
║  대시보드에서 "에이전트 연결" 클릭     ║
║  Chrome이 자동으로 열립니다           ║
╚════════════════════════════════════════╝

⚠️  주의: Instagram ToS상 자동화는 제한됩니다.
   계정 정지 위험이 있으니 적절한 딜레이를 유지하세요.
  `);

  if (!ANTHROPIC_KEY) {
    console.warn("⚠️  ANTHROPIC_API_KEY 환경변수가 없습니다. .env 파일을 확인하세요.");
  }
});

// 종료 처리
process.on("SIGINT", async () => {
  if (context) await context.close();
  process.exit(0);
});
