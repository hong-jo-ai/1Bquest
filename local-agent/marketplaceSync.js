const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { chromium } = require("playwright");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const CHANNELS = {
  wconcept: {
    label: "W컨셉",
    authMethod: "email",   // 2차 인증: 이메일 인증번호 (Gmail에서 자동 수신)
    loginUrl: env("WCONCEPT_LOGIN_URL"),
    ordersUrl: env("WCONCEPT_ORDERS_URL"),
    username: env("WCONCEPT_LOGIN_ID"),
    password: env("WCONCEPT_LOGIN_PASSWORD"),
    usernameSelector: env("WCONCEPT_ID_SELECTOR"),
    passwordSelector: env("WCONCEPT_PASSWORD_SELECTOR"),
    loginButtonSelector: env("WCONCEPT_LOGIN_BUTTON_SELECTOR"),
    emailCodeSelector: env("WCONCEPT_EMAIL_CODE_SELECTOR"),
    emailCodeSubmitSelector: env("WCONCEPT_EMAIL_CODE_SUBMIT_SELECTOR"),
    gmailQuery: env("WCONCEPT_GMAIL_QUERY") || "newer_than:10m",
    gmailRefreshToken: env("WCONCEPT_GMAIL_REFRESH_TOKEN"),
    dateStartSelector: env("WCONCEPT_DATE_START_SELECTOR"),
    dateEndSelector: env("WCONCEPT_DATE_END_SELECTOR"),
    searchButtonSelector: env("WCONCEPT_SEARCH_BUTTON_SELECTOR"),
    downloadButtonSelector: env("WCONCEPT_DOWNLOAD_BUTTON_SELECTOR"),
  },
  musinsa: {
    label: "무신사",
    authMethod: "email",   // 2차 인증: 이메일 인증번호 (shong@ Gmail에서 자동 수신)
    loginUrl: env("MUSINSA_LOGIN_URL"),
    ordersUrl: env("MUSINSA_ORDERS_URL"),
    username: env("MUSINSA_LOGIN_ID"),
    password: env("MUSINSA_LOGIN_PASSWORD"),
    usernameSelector: env("MUSINSA_ID_SELECTOR"),
    passwordSelector: env("MUSINSA_PASSWORD_SELECTOR"),
    loginButtonSelector: env("MUSINSA_LOGIN_BUTTON_SELECTOR"),
    emailMethodSelector: env("MUSINSA_EMAIL_METHOD_SELECTOR"),  // 2차 인증 '이메일' 탭
    emailSendSelector: env("MUSINSA_EMAIL_SEND_SELECTOR"),      // '인증번호 받기' 버튼 (메일 발송)
    emailConfirmSelector: env("MUSINSA_EMAIL_CONFIRM_SELECTOR"),// '전송됨' 모달의 확인 (닫아야 입력칸 활성화)
    emailCodeSelector: env("MUSINSA_EMAIL_CODE_SELECTOR"),
    emailCodeSubmitSelector: env("MUSINSA_EMAIL_CODE_SUBMIT_SELECTOR"),
    codeViaDashboard: true,  // 인증번호는 대시보드 API가 shong@ Gmail에서 읽어 전달 (로컬에 Google secret 불필요)
    dateStartSelector: env("MUSINSA_DATE_START_SELECTOR"),
    dateEndSelector: env("MUSINSA_DATE_END_SELECTOR"),
    searchButtonSelector: env("MUSINSA_SEARCH_BUTTON_SELECTOR"),
    downloadButtonSelector: env("MUSINSA_DOWNLOAD_BUTTON_SELECTOR"),
    // 무신사: 보이는 다운로드 버튼이 없고, 그리드 우클릭 → '내려받기' 컨텍스트 메뉴로 다운로드
    downloadRightClickSelector: env("MUSINSA_DOWNLOAD_RIGHTCLICK_SELECTOR"),
    downloadMenuSelector: env("MUSINSA_DOWNLOAD_MENU_SELECTOR"),
  },
  "29cm": {
    label: "29CM",
    authMethod: "email",   // 무신사와 동일 SSO → 이메일 인증 (plvekorea@gmail.com, 대시보드 자동읽기)
    loginUrl: env("CM29_LOGIN_URL"),
    ordersUrl: env("CM29_ORDERS_URL"),
    username: env("CM29_LOGIN_ID"),
    password: env("CM29_LOGIN_PASSWORD"),
    // partner-sso.one.musinsa.com 공통 → 로그인/이메일 인증 셀렉터는 무신사와 동일
    usernameSelector: "input[name='id']",
    passwordSelector: "input[name='password']",
    loginButtonSelector: "button[type='submit']",
    emailMethodSelector: '.ant-radio-button-wrapper:has-text("이메일")',
    emailSendSelector: 'button:has-text("인증번호 받기")',
    emailConfirmSelector: '.ant-modal button:has-text("확인")',
    emailCodeSelector: "input[name='code']",
    emailCodeSubmitSelector: "button[type='submit']",
    codeViaDashboard: true,
    customDownload: true,  // /list 페이지 + URL 날짜 + '엑셀 다운로드'→'받기' (downloadOrders 29cm 분기)
  },
};

const contexts = new Map();

function env(name) {
  return process.env[name] || "";
}

function marketplaceProfileDir(channel) {
  const root = env("MARKETPLACE_CHROME_PROFILE_ROOT") ||
    path.join(os.homedir(), ".paulvice-marketplace-agent");
  return path.join(root, channel);
}

function missingConfig(channel) {
  const cfg = CHANNELS[channel];
  const required = [
    "loginUrl",
    "ordersUrl",
    "username",
    "password",
    "usernameSelector",
    "passwordSelector",
    "loginButtonSelector",
  ];
  // customDownload(29CM 등)는 날짜/검색/다운로드 셀렉터 대신 전용 흐름을 씀
  if (!cfg.customDownload) {
    required.push("dateStartSelector", "dateEndSelector", "searchButtonSelector");
    if (cfg.downloadRightClickSelector) required.push("downloadMenuSelector");
    else required.push("downloadButtonSelector");
  }
  if (cfg.authMethod === "email") {
    required.push("emailCodeSelector", "emailCodeSubmitSelector");
    if (!cfg.codeViaDashboard) required.push("gmailRefreshToken");
  } else {
    required.push("totpSecret", "otpSelector", "otpSubmitSelector");
  }
  return required.filter((key) => !cfg[key]);
}

function normalizeBase32(secret) {
  return secret.toUpperCase().replace(/[^A-Z2-7]/g, "");
}

function base32ToBuffer(secret) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const ch of normalizeBase32(secret)) {
    const value = alphabet.indexOf(ch);
    if (value === -1) throw new Error("TOTP secret 형식이 올바르지 않습니다");
    bits += value.toString(2).padStart(5, "0");
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

function generateTotp(secret, now = Date.now()) {
  const key = base32ToBuffer(secret);
  const counter = Math.floor(now / 1000 / 30);
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  buf.writeUInt32BE(counter & 0xffffffff, 4);

  const hmac = crypto.createHmac("sha1", key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code = (
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff)
  ) % 1000000;
  return String(code).padStart(6, "0");
}

async function getMarketplacePage(channel, log) {
  const existing = contexts.get(channel);
  if (existing?.context && existing?.page) return existing;

  const profileDir = marketplaceProfileDir(channel);
  fs.mkdirSync(profileDir, { recursive: true });
  log(`${CHANNELS[channel].label} 전용 Chrome 프로필 시작: ${profileDir}`);
  const context = await chromium.launchPersistentContext(profileDir, {
    headless: false,
    channel: env("MARKETPLACE_BROWSER_CHANNEL") || "chrome",  // 설치된 시스템 Chrome 사용
    acceptDownloads: true,
    args: [
      "--disable-blink-features=AutomationControlled",
      "--start-maximized",
      "--lang=ko-KR",
    ],
    locale: "ko-KR",
    viewport: null,
    ignoreDefaultArgs: ["--enable-automation"],
  });
  const page = context.pages()[0] || await context.newPage();
  await page.setExtraHTTPHeaders({ "Accept-Language": "ko-KR,ko;q=0.9" });
  const opened = { context, page };
  contexts.set(channel, opened);
  return opened;
}

async function fillIfVisible(page, selector, value, timeout = 5000) {
  const locator = page.locator(selector).first();
  await locator.waitFor({ state: "visible", timeout });
  await locator.fill(value);
}

async function clickIfConfigured(page, selector, timeout = 10000) {
  const locator = page.locator(selector).first();
  await locator.waitFor({ state: "visible", timeout });
  await locator.click();
}

async function refreshGoogleAccessToken(refreshToken) {
  const clientId = env("GOOGLE_CLIENT_ID");
  const clientSecret = env("GOOGLE_CLIENT_SECRET");
  if (!clientId || !clientSecret) {
    throw new Error("GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET 설정이 필요합니다");
  }
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) throw new Error(`Google token refresh 실패: ${res.status} ${await res.text()}`);
  const json = await res.json();
  if (!json.access_token) throw new Error("Google access_token 없음");
  return json.access_token;
}

function extractCodeFromPayload(payload) {
  const chunks = [];
  const walk = (part) => {
    if (!part) return;
    if (part.body?.data) chunks.push(part.body.data);
    for (const child of part.parts || []) walk(child);
  };
  walk(payload);
  const text = chunks
    .map((data) => Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"))
    .join("\n");
  const match = text.match(/(?<!\d)(\d{6})(?!\d)/);
  if (!match) throw new Error("W컨셉 인증 메일에서 6자리 코드를 찾지 못했습니다");
  return match[1];
}

async function fetchLatestGmailCode(refreshToken, query) {
  const accessToken = await refreshGoogleAccessToken(refreshToken);
  const base = "https://gmail.googleapis.com/gmail/v1/users/me";
  const listRes = await fetch(`${base}/messages?q=${encodeURIComponent(query)}&maxResults=5`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!listRes.ok) throw new Error(`Gmail 메시지 검색 실패: ${listRes.status} ${await listRes.text()}`);
  const list = await listRes.json();
  const messageId = list.messages?.[0]?.id;
  if (!messageId) throw new Error(`W컨셉 인증 메일을 찾지 못했습니다: ${query}`);

  const msgRes = await fetch(`${base}/messages/${messageId}?format=full`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!msgRes.ok) throw new Error(`Gmail 메시지 조회 실패: ${msgRes.status} ${await msgRes.text()}`);
  const msg = await msgRes.json();
  return extractCodeFromPayload(msg.payload);
}

async function fetchCodeFromDashboard(channel, afterTs, log) {
  const base = (env("DASHBOARD_URL") || "https://paulvice-dashboard.vercel.app").replace(/\/$/, "");
  const token = env("PAULWISE_MCP_TOKEN") || "";
  const url = `${base}/api/marketplace/verification-code?channel=${encodeURIComponent(channel)}`
    + (afterTs ? `&after=${encodeURIComponent(afterTs)}` : "");
  let lastErr;
  // 인증번호 메일이 도착할 때까지 몇 번 재시도
  for (let attempt = 1; attempt <= 6; attempt++) {
    try {
      const res = await fetch(url, { headers: { "x-agent-token": token } });
      const json = await res.json().catch(() => ({}));
      if (res.ok && json.code) {
        log(`대시보드에서 인증번호 수신 (${attempt}회 시도)`);
        return json.code;
      }
      lastErr = new Error(json.error || `코드 조회 실패 (HTTP ${res.status})`);
    } catch (e) {
      lastErr = e;
    }
    await sleep(4000);
  }
  throw lastErr || new Error("대시보드에서 인증번호를 가져오지 못했습니다");
}

async function ensureLoggedIn(channel, page, log) {
  const cfg = CHANNELS[channel];
  await page.goto(cfg.loginUrl, { waitUntil: "domcontentloaded" });
  await sleep(1200);

  try {
    await fillIfVisible(page, cfg.usernameSelector, cfg.username, 5000);
    await fillIfVisible(page, cfg.passwordSelector, cfg.password, 5000);
    await clickIfConfigured(page, cfg.loginButtonSelector, 5000);
    log(`${cfg.label} 로그인 정보 입력 완료`);
  } catch (err) {
    log(`${cfg.label} 로그인 폼 입력 스킵: 이미 로그인 상태일 수 있습니다`);
  }

  if (cfg.authMethod === "email") {
    try {
      // 인증번호 발송 시각(=이후 도착 메일만 유효). 시계 오차 대비 15초 버퍼.
      const codeReqAt = new Date(Date.now() - 15000).toISOString();
      // (무신사 등) 2차 인증 방식 탭이 있으면 '이메일' 선택
      if (cfg.emailMethodSelector) {
        await clickIfConfigured(page, cfg.emailMethodSelector, 8000);
        log(`${cfg.label} 2차 인증: 이메일 방식 선택`);
      }
      // '인증번호 받기' 버튼이 있으면 클릭 → 메일 발송
      if (cfg.emailSendSelector) {
        await clickIfConfigured(page, cfg.emailSendSelector, 8000);
        log(`${cfg.label} 인증번호 받기 요청`);
      }
      // '전송됨' 모달이 뜨면 확인 클릭 → 코드 입력칸 활성화
      if (cfg.emailConfirmSelector) {
        await clickIfConfigured(page, cfg.emailConfirmSelector, 8000).catch(() => {});
      }
      await page.locator(cfg.emailCodeSelector).first().waitFor({ state: "visible", timeout: 15000 });
      await sleep(5000); // 인증번호 메일 도착 대기
      const code = cfg.codeViaDashboard
        ? await fetchCodeFromDashboard(channel, codeReqAt, log)
        : await fetchLatestGmailCode(cfg.gmailRefreshToken, cfg.gmailQuery);
      await fillIfVisible(page, cfg.emailCodeSelector, code, 5000);
      await clickIfConfigured(page, cfg.emailCodeSubmitSelector, 5000);
      // 인증 후 리다이렉트가 끝날 때까지 대기 (바로 이동하면 ERR_ABORTED)
      await sleep(4000);
      await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
      log(`${cfg.label} 이메일 인증번호 자동 입력 완료`);
    } catch (err) {
      log(`${cfg.label} 이메일 인증 단계 스킵/실패: ${err.message}`);
    }
    return;
  }

  try {
    await page.locator(cfg.otpSelector).first().waitFor({ state: "visible", timeout: 15000 });
    const seconds = Math.floor(Date.now() / 1000) % 30;
    if (seconds > 25) await sleep((31 - seconds) * 1000);
    await fillIfVisible(page, cfg.otpSelector, generateTotp(cfg.totpSecret), 5000);
    await clickIfConfigured(page, cfg.otpSubmitSelector, 5000);
    log(`${cfg.label} Google OTP 자동 입력 완료`);
  } catch (err) {
    log(`${cfg.label} OTP 단계 스킵/실패: ${err.message}`);
  }
}

async function downloadOrders(channel, page, startDate, endDate, log) {
  const cfg = CHANNELS[channel];

  // ── 29CM: /list 전체 주문 조회 (날짜는 URL 파라미터) → '엑셀 다운로드' → '받기' ──
  if (channel === "29cm") {
    const base = (cfg.ordersUrl || "https://partner-order.29cm.co.kr/list").replace(/\/$/, "");
    const url = `${base}?fromDate=${startDate}&toDate=${endDate}&dateConditionType=ORDERED_AT&periodTemplate=1&page=1&size=50`;
    try { await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 }); }
    catch (e) { log(`29CM 주문페이지 이동 재시도 (${e.message.slice(0, 40)})`); await sleep(2500); await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 }); }
    await sleep(3000);
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
    await page.locator('button:has-text("검색하기")').first().click({ timeout: 8000 }).catch(() => {});
    await sleep(3500);

    const dir = path.join(os.tmpdir(), "paulvice-marketplace-downloads");
    fs.mkdirSync(dir, { recursive: true });
    const [dl] = await Promise.all([
      page.waitForEvent("download", { timeout: 120000 }),
      (async () => {
        await page.getByText("엑셀 다운로드", { exact: false }).first().click({ timeout: 10000 });
        await sleep(1000);
        await page.getByRole("button", { name: "받기" }).first().click({ timeout: 8000 })
          .catch(async () => { await page.getByText("받기", { exact: true }).first().click({ timeout: 8000 }); });
      })(),
    ]);
    const suggested = dl.suggestedFilename();
    const filePath = path.join(dir, `${Date.now()}-29cm-${suggested}`);
    await dl.saveAs(filePath);
    log(`29CM 엑셀 다운로드 완료: ${filePath}`);
    return { filePath, fileName: suggested };
  }

  // 인증 직후 리다이렉트와 겹치면 ERR_ABORTED 가능 → 1회 재시도
  try {
    await page.goto(cfg.ordersUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
  } catch (e) {
    log(`${cfg.label} 주문페이지 이동 재시도 (${e.message.slice(0, 40)})`);
    await sleep(2500);
    await page.goto(cfg.ordersUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
  }
  await sleep(2000);

  await fillIfVisible(page, cfg.dateStartSelector, startDate, 10000);
  await fillIfVisible(page, cfg.dateEndSelector, endDate, 10000);
  await clickIfConfigured(page, cfg.searchButtonSelector, 10000);
  await sleep(2000);

  // 다운로드 트리거: (1) 그리드 우클릭 → 컨텍스트 메뉴 '내려받기' (무신사),
  // (2) 일반 다운로드 버튼 클릭 (그 외)
  const triggerDownload = async () => {
    if (cfg.downloadRightClickSelector) {
      await page.locator(cfg.downloadRightClickSelector).first().click({ button: "right", timeout: 15000 });
      await sleep(800);
      await clickIfConfigured(page, cfg.downloadMenuSelector, 10000);
    } else {
      await clickIfConfigured(page, cfg.downloadButtonSelector, 30000);
    }
  };

  const download = await Promise.all([
    page.waitForEvent("download", { timeout: 120000 }),
    triggerDownload(),
  ]).then(([dl]) => dl);

  const suggested = download.suggestedFilename();
  const dir = path.join(os.tmpdir(), "paulvice-marketplace-downloads");
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `${Date.now()}-${channel}-${suggested}`);
  await download.saveAs(filePath);
  log(`${cfg.label} 엑셀 다운로드 완료: ${filePath}`);
  return { filePath, fileName: suggested };
}

// 인터랙티브(미리보기) — 로컬 대시보드 /api/upload 로 파싱만 (저장 안 함)
async function parseDownloadedFile(channel, filePath, fileName) {
  const uploadBase = env("DASHBOARD_UPLOAD_BASE_URL") || "http://localhost:3000";
  const buffer = fs.readFileSync(filePath);
  const form = new FormData();
  form.append("file", new Blob([buffer]), fileName);
  const res = await fetch(`${uploadBase}/api/upload?channel=${encodeURIComponent(channel)}`, {
    method: "POST",
    body: form,
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || `업로드 파싱 실패 (${res.status})`);
  return json;
}

// 무인(크론) — 배포 대시보드 /api/marketplace/sync-ingest 로 파싱 + 영속 저장 (토큰 인증)
async function ingestDownloadedFile(channel, filePath, fileName, log) {
  const base = (env("DASHBOARD_URL") || "https://paulvice-dashboard.vercel.app").replace(/\/$/, "");
  const token = env("PAULWISE_MCP_TOKEN") || "";
  const buffer = fs.readFileSync(filePath);
  const form = new FormData();
  form.append("file", new Blob([buffer]), fileName);
  const res = await fetch(`${base}/api/marketplace/sync-ingest?channel=${encodeURIComponent(channel)}`, {
    method: "POST",
    headers: { "x-agent-token": token },
    body: form,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.ok) throw new Error(json.error || `적재 실패 (HTTP ${res.status})`);
  log(`${CHANNELS[channel].label} 대시보드 적재 완료: ${json.rowCount}건 (${json.period?.start}~${json.period?.end})`);
  return json;
}

async function syncMarketplaceSales({ channel, startDate, endDate, ingest = false }, log) {
  if (!CHANNELS[channel]) throw new Error("지원하지 않는 채널입니다");
  const missing = missingConfig(channel);
  if (missing.length) {
    throw new Error(`${CHANNELS[channel].label} 자동화 설정 누락: ${missing.join(", ")}`);
  }

  const { page } = await getMarketplacePage(channel, log);
  await ensureLoggedIn(channel, page, log);
  const downloaded = await downloadOrders(channel, page, startDate, endDate, log);
  // ingest=true(무인): 서버에 파싱+저장 / 그 외(인터랙티브): 파싱만 (미리보기)
  const parsed = ingest
    ? await ingestDownloadedFile(channel, downloaded.filePath, downloaded.fileName, log)
    : await parseDownloadedFile(channel, downloaded.filePath, downloaded.fileName);
  return {
    success: true,
    channel,
    downloadedFile: downloaded.fileName,
    ...parsed,
  };
}

async function closeMarketplaceBrowsers() {
  for (const { context } of contexts.values()) {
    await context.close().catch(() => {});
  }
  contexts.clear();
}

module.exports = {
  CHANNELS,
  closeMarketplaceBrowsers,
  generateTotp,
  missingConfig,
  syncMarketplaceSales,
};
