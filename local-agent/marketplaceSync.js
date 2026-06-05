const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { chromium } = require("playwright");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const CHANNELS = {
  wconcept: {
    label: "W컨셉",
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
    loginUrl: env("MUSINSA_LOGIN_URL"),
    ordersUrl: env("MUSINSA_ORDERS_URL"),
    username: env("MUSINSA_LOGIN_ID"),
    password: env("MUSINSA_LOGIN_PASSWORD"),
    totpSecret: env("MUSINSA_TOTP_SECRET"),
    usernameSelector: env("MUSINSA_ID_SELECTOR"),
    passwordSelector: env("MUSINSA_PASSWORD_SELECTOR"),
    loginButtonSelector: env("MUSINSA_LOGIN_BUTTON_SELECTOR"),
    otpSelector: env("MUSINSA_OTP_SELECTOR"),
    otpSubmitSelector: env("MUSINSA_OTP_SUBMIT_SELECTOR"),
    dateStartSelector: env("MUSINSA_DATE_START_SELECTOR"),
    dateEndSelector: env("MUSINSA_DATE_END_SELECTOR"),
    searchButtonSelector: env("MUSINSA_SEARCH_BUTTON_SELECTOR"),
    downloadButtonSelector: env("MUSINSA_DOWNLOAD_BUTTON_SELECTOR"),
  },
  "29cm": {
    label: "29CM",
    loginUrl: env("CM29_LOGIN_URL"),
    ordersUrl: env("CM29_ORDERS_URL"),
    username: env("CM29_LOGIN_ID"),
    password: env("CM29_LOGIN_PASSWORD"),
    totpSecret: env("CM29_TOTP_SECRET"),
    usernameSelector: env("CM29_ID_SELECTOR"),
    passwordSelector: env("CM29_PASSWORD_SELECTOR"),
    loginButtonSelector: env("CM29_LOGIN_BUTTON_SELECTOR"),
    otpSelector: env("CM29_OTP_SELECTOR"),
    otpSubmitSelector: env("CM29_OTP_SUBMIT_SELECTOR"),
    dateStartSelector: env("CM29_DATE_START_SELECTOR"),
    dateEndSelector: env("CM29_DATE_END_SELECTOR"),
    searchButtonSelector: env("CM29_SEARCH_BUTTON_SELECTOR"),
    downloadButtonSelector: env("CM29_DOWNLOAD_BUTTON_SELECTOR"),
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
    "dateStartSelector",
    "dateEndSelector",
    "searchButtonSelector",
    "downloadButtonSelector",
  ];
  if (channel === "wconcept") {
    required.push("emailCodeSelector", "emailCodeSubmitSelector", "gmailRefreshToken");
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

  if (channel === "wconcept") {
    try {
      await page.locator(cfg.emailCodeSelector).first().waitFor({ state: "visible", timeout: 15000 });
      const code = await fetchLatestGmailCode(cfg.gmailRefreshToken, cfg.gmailQuery);
      await fillIfVisible(page, cfg.emailCodeSelector, code, 5000);
      await clickIfConfigured(page, cfg.emailCodeSubmitSelector, 5000);
      log("W컨셉 이메일 인증번호 자동 입력 완료");
    } catch (err) {
      log(`W컨셉 이메일 인증 단계 스킵/실패: ${err.message}`);
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
  await page.goto(cfg.ordersUrl, { waitUntil: "domcontentloaded" });
  await sleep(1500);

  await fillIfVisible(page, cfg.dateStartSelector, startDate, 10000);
  await fillIfVisible(page, cfg.dateEndSelector, endDate, 10000);
  await clickIfConfigured(page, cfg.searchButtonSelector, 10000);
  await sleep(1500);

  const download = await Promise.all([
    page.waitForEvent("download", { timeout: 120000 }),
    clickIfConfigured(page, cfg.downloadButtonSelector, 30000),
  ]).then(([dl]) => dl);

  const suggested = download.suggestedFilename();
  const dir = path.join(os.tmpdir(), "paulvice-marketplace-downloads");
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `${Date.now()}-${channel}-${suggested}`);
  await download.saveAs(filePath);
  log(`${cfg.label} 엑셀 다운로드 완료: ${filePath}`);
  return { filePath, fileName: suggested };
}

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

async function syncMarketplaceSales({ channel, startDate, endDate }, log) {
  if (!CHANNELS[channel]) throw new Error("지원하지 않는 채널입니다");
  const missing = missingConfig(channel);
  if (missing.length) {
    throw new Error(`${CHANNELS[channel].label} 자동화 설정 누락: ${missing.join(", ")}`);
  }

  const { page } = await getMarketplacePage(channel, log);
  await ensureLoggedIn(channel, page, log);
  const downloaded = await downloadOrders(channel, page, startDate, endDate, log);
  const parsed = await parseDownloadedFile(channel, downloaded.filePath, downloaded.fileName);
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
