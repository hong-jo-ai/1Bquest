export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const baseUrl = `${url.protocol}//${url.host}`;
  const brand = url.searchParams.get("brand") === "harriot" ? "harriot" : "paulvice";
  const isHarriot = brand === "harriot";
  const brandName = url.searchParams.get("brandName") || (isHarriot ? "HARRIOT" : "PAULVICE");
  // 폴바이스=토프, 해리엇=골드(시계 브랜드 무드)
  const accent = sanitizeColor(url.searchParams.get("accent") || (isHarriot ? "#c79a3b" : "#b1aaa2"));
  const imgBase = isHarriot ? "/webchat/harriot" : "/webchat";
  const brandKo = isHarriot ? "해리엇" : "폴바이스";
  const email = url.searchParams.get("email") || (isHarriot ? "shong@harriotwatches.com" : "plvekorea@gmail.com");
  // 글로벌(영문)몰: lang=en → 영어 UI + 연락처는 이메일만 수집(해외고객 문자 불가)
  const lang = url.searchParams.get("lang") === "en" ? "en" : "ko";
  const emailOnly = lang === "en" || url.searchParams.get("contact") === "email";
  const t = strings(lang, brandName, brandKo);

  return new Response(buildWidgetScript({ baseUrl, brandName, accent, imgBase, brand, brandKo, email, lang, emailOnly, t }), {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "public, max-age=300",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

function sanitizeColor(value: string): string {
  return /^#[0-9a-f]{6}$/i.test(value) ? value : "#111827";
}

function strings(lang: string, brandName: string, brandKo: string): Record<string, string> {
  if (lang === "en") {
    return {
      emptyMsg: "Leave us a message about products, shipping, or after-sales and we'll reply in order. You can close this window — your conversation stays here so you can pick it back up anytime.",
      helpText: "Please leave your name and email so we can notify you when we reply. You can leave this window — your conversation stays right here.",
      namePh: "Name",
      phonePh: "Phone",
      emailPh: "Email",
      startChat: "Start chat",
      typeMsg: "Type your message",
      send: "Send",
      navHome: "Home",
      navChat: "Chats",
      closeAria: "Close chat",
      backAria: "Back",
      inquire: "Start a chat ",
      viewHours: "View hours >",
      cardCopy: "<p>This is the " + brandName + " support channel.</p><p>Ask us about products, shipping, or after-sales and we'll reply in order.</p><p>Hours: Monday – Friday, 10:00 – 17:00 (KST).</p>",
      openFrom: "Open from 10:00 AM (KST)",
      emailUs: "Email us",
      otherWays: "Other ways to reach us",
      usingChat: brandName + " support",
      consult: brandName + " chat",
      notice: "Mon – Fri 10:00 – 17:00 (KST), lunch 12:00 – 13:00",
      replyPrefix: "Reply: ",
      countSuffix: " msgs",
      noConvs: "No conversations yet. Tap 'New chat' below to start.",
      chatsTitle: "Chats",
      newChat: "New chat ",
      errName: "Please enter your name to start.",
      errContact: "Please enter a valid email so we can reply.",
      mailSubject: "[" + brandName + " Inquiry]",
      chatCta: "Chat with us",
      sendFailed: "Couldn't send — please check your connection and try again. Your message has been kept below.",
      attachAria: "Attach photo",
      uploadFailed: "Couldn't upload the photo — please try again.",
      photoTooBig: "Photos must be under 12MB.",
    };
  }
  return {
    emptyMsg: "제품, 배송, AS 문의를 남겨주시면 확인 후 순서대로 답변드리겠습니다. 화면을 닫아도 답변 알림 문자의 링크로 이어서 확인하실 수 있습니다.",
    helpText: "답변 알림을 문자로 보내드리기 위해 이름과 연락처가 필요합니다. 화면을 떠나도 링크로 이어서 상담하실 수 있습니다.",
    namePh: "이름",
    phonePh: "연락처",
    emailPh: "이메일(선택)",
    startChat: "상담 시작",
    typeMsg: "메시지를 입력해주세요.",
    send: "전송",
    navHome: "홈",
    navChat: "대화",
    closeAria: "상담 닫기",
    backAria: "뒤로",
    inquire: "문의하기 ",
    viewHours: "운영시간 보기 >",
    cardCopy: "<p>" + brandKo + " 상담 채널입니다.</p><p>제품, 배송, AS 문의를 남겨주시면 확인 후 순서대로 답변드리겠습니다.</p><p>상담 가능 시간은 월요일 - 금요일 10:00 - 17:00 입니다.</p>",
    openFrom: "오전 10:00부터 운영해요",
    emailUs: "이메일 문의",
    otherWays: "다른 방법으로 문의",
    usingChat: brandName + " 상담 이용중",
    consult: brandName + " 상담",
    notice: "월-금 10:00 - 17:00, 점심시간 12:00 - 13:00",
    replyPrefix: "답변: ",
    countSuffix: "개",
    noConvs: "아직 나눈 대화가 없어요. 아래 ‘새 문의하기’로 문의를 시작해 보세요.",
    chatsTitle: "대화",
    newChat: "새 문의하기 ",
    errName: "상담을 시작하려면 이름을 입력해 주세요.",
    errContact: "답변 알림을 받을 수 있는 연락처를 입력해 주세요.",
    mailSubject: "[" + brandName + " 문의]",
    chatCta: "채팅 상담 문의하기",
    sendFailed: "전송에 실패했어요. 네트워크 확인 후 다시 보내주세요. 입력하신 내용은 아래에 그대로 남겨두었습니다.",
    attachAria: "사진 첨부",
    uploadFailed: "사진 전송에 실패했어요. 잠시 후 다시 시도해 주세요.",
    photoTooBig: "사진은 12MB 이하로 올려주세요.",
  };
}

function buildWidgetScript(input: { baseUrl: string; brandName: string; accent: string; imgBase: string; brand: string; brandKo: string; email: string; lang: string; emailOnly: boolean; t: Record<string, string> }): string {
  const config = JSON.stringify(input);
  return `
(function () {
  if (window.PaulviceWebchatLoaded) return;
  window.PaulviceWebchatLoaded = true;

  var config = ${config};
  var STORAGE_KEY = "paulvice_webchat_conversation_id";
  var CONTACT_KEY = "paulvice_webchat_contact";
  var CONV_KEY = "paulvice_webchat_conversations";
  var pollTimer = null;
  var pollActivityTs = 0;   // 마지막 활동(전송/새 메시지) 시각 — 백오프·중단 판단용
  var lastMsgCount = -1;    // 새 인바운드 메시지 감지용
  var isOpen = false;
  var currentView = "home";

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    attrs = attrs || {};
    Object.keys(attrs).forEach(function (key) {
      if (key === "class") node.className = attrs[key];
      else if (key === "text") node.textContent = attrs[key];
      else node.setAttribute(key, attrs[key]);
    });
    (children || []).forEach(function (child) { node.appendChild(child); });
    return node;
  }

  function api(path, options) {
    return fetch(config.baseUrl + path, Object.assign({
      headers: { "Content-Type": "application/json" },
      mode: "cors"
    }, options || {})).then(function (res) { return res.json(); });
  }

  function pingPresence(state) {
    var id = getConversationId();
    if (!id) return;
    var payload = JSON.stringify({ conversationId: id, state: state });
    // 화면/사이트 이탈 신호는 페이지가 사라지는 중에도 도달해야 하므로 sendBeacon 사용.
    // text/plain 으로 보내 CORS preflight 를 피한다(서버가 본문을 파싱).
    if (state === "away") {
      try {
        if (navigator.sendBeacon) {
          navigator.sendBeacon(
            config.baseUrl + "/api/cs/webchat/presence",
            new Blob([payload], { type: "text/plain" })
          );
          return;
        }
      } catch (_) {}
    }
    try {
      fetch(config.baseUrl + "/api/cs/webchat/presence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        mode: "cors",
        keepalive: true,
        body: payload
      }).catch(function () {});
    } catch (_) {}
  }

  function getContact() {
    try { return JSON.parse(localStorage.getItem(CONTACT_KEY) || "{}"); }
    catch (_) { return {}; }
  }

  function saveContact(contact) {
    localStorage.setItem(CONTACT_KEY, JSON.stringify(contact));
  }

  function getConversationId() {
    return localStorage.getItem(STORAGE_KEY);
  }

  function setConversationId(id) {
    if (id) { localStorage.setItem(STORAGE_KEY, id); addConversation(id); }
  }

  function clearConversationId() {
    localStorage.removeItem(STORAGE_KEY);
  }

  function getConversations() {
    try { var a = JSON.parse(localStorage.getItem(CONV_KEY) || "[]"); return Array.isArray(a) ? a : []; }
    catch (_) { return []; }
  }

  function addConversation(id) {
    if (!id) return;
    var list = getConversations().filter(function (x) { return x !== id; });
    list.unshift(id);
    try { localStorage.setItem(CONV_KEY, JSON.stringify(list.slice(0, 30))); } catch (_) {}
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function formatWhen(iso) {
    if (!iso) return "";
    try {
      var d = new Date(iso);
      return d.toLocaleDateString("ko-KR", { month: "long", day: "numeric" })
        + " " + d.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
    } catch (_) { return ""; }
  }

  function pageMeta() {
    return {
      pageUrl: location.href,
      referrer: document.referrer || ""
    };
  }

  function ensureSession(contact) {
    return api("/api/cs/webchat/session", {
      method: "POST",
      body: JSON.stringify(Object.assign({}, pageMeta(), contact || {}, {
        conversationId: getConversationId(),
        brand: config.brand
      }))
    }).then(function (json) {
      if (json.conversationId) setConversationId(json.conversationId);
      return json;
    });
  }

  function injectStyles() {
    var css = ""
      + ".pv-chat-root{position:fixed;right:22px;bottom:calc(22px + var(--pv-chat-lift,0px));z-index:2147483000;font-family:Arial,'Apple SD Gothic Neo','Noto Sans KR',sans-serif;color:#161616;letter-spacing:0;-webkit-font-smoothing:antialiased}"
      + ".pv-chat-root *{box-sizing:border-box}"
      + ".pv-chat-button{position:relative;width:76px;height:76px;border:0;background:transparent;padding:0;cursor:pointer;display:block;line-height:0;transition:transform .18s ease,filter .18s ease;filter:drop-shadow(0 12px 20px rgba(0,0,0,.24)) drop-shadow(0 3px 6px rgba(0,0,0,.16))}"
      + ".pv-chat-button:hover{transform:translateY(-2px);filter:drop-shadow(0 16px 26px rgba(0,0,0,.28)) drop-shadow(0 4px 8px rgba(0,0,0,.18))}"
      + ".pv-chat-btn-img{width:100%;height:100%;object-fit:contain;display:block;pointer-events:none}"
      + ".pv-chat-panel{display:none;width:420px;max-width:calc(100vw - 32px);height:680px;max-height:calc(100vh - 84px - var(--pv-chat-lift,0px));background:#f5f4f2;border:1px solid #d8d2c8;border-radius:12px;box-shadow:0 24px 70px rgba(17,17,17,.22);overflow:hidden}"
      + ".pv-chat-panel.open{display:flex;flex-direction:column}.pv-chat-screen{display:none;min-height:0;flex:1;flex-direction:column;background:#f5f4f2}.pv-chat-screen.active{display:flex}"
      + ".pv-chat-home{padding:0}.pv-chat-home-body{flex:1;min-height:0;overflow:auto;display:flex;flex-direction:column;gap:16px;padding:24px 18px 18px}.pv-chat-home-head{display:flex;align-items:center;gap:13px;padding:0 2px}.pv-chat-avatar{width:48px;height:48px;border-radius:999px;overflow:hidden;background:#111;flex:0 0 auto}.pv-chat-avatar img{width:100%;height:100%;object-fit:cover;display:block}.pv-chat-brand{min-width:0;flex:1}.pv-chat-brand-name{font-size:20px;font-weight:800;line-height:1.2;color:#171717}.pv-chat-hours-link{margin-top:6px;font-size:13px;color:#777;background:transparent;border:0;padding:0;cursor:pointer}.pv-chat-close{width:40px;height:40px;border:0;border-radius:999px;background:#858585;color:#fff;font-size:28px;line-height:1;cursor:pointer;display:flex;align-items:center;justify-content:center;flex:0 0 auto}"
      + ".pv-chat-card{background:#fff;border:1px solid #ebe8e3;border-radius:20px;padding:18px 16px 16px;box-shadow:0 1px 0 rgba(0,0,0,.02)}.pv-chat-card-row{display:flex;gap:12px}.pv-chat-bot{width:38px;height:38px;border-radius:999px;background:#ece8e3;color:#8c8278;display:flex;align-items:center;justify-content:center;flex:0 0 auto}.pv-chat-bot svg{width:22px;height:22px}.pv-chat-card-copy{font-size:15px;line-height:1.55;font-weight:700;color:#202020}.pv-chat-card-copy p{margin:0 0 12px}.pv-chat-primary{width:100%;height:52px;border:0;border-radius:16px;background:#b1aaa2;color:#fff;font-size:16px;font-weight:800;cursor:pointer;box-shadow:0 8px 18px rgba(122,112,100,.28);display:flex;align-items:center;justify-content:center;gap:8px}.pv-chat-card-time{display:flex;align-items:center;justify-content:center;gap:6px;margin-top:10px;font-size:13px;font-weight:700;color:#777}.pv-chat-methods{display:flex;align-items:center;justify-content:space-between;gap:12px;background:#fff;border:1px solid #ebe8e3;border-radius:18px;padding:12px 14px 12px 16px;color:#8a8a8a;font-size:14px}.pv-chat-email-btn{display:inline-flex;align-items:center;gap:7px;height:40px;padding:0 16px;border:0;border-radius:14px;background:#b1aaa2;color:#fff;font-size:14px;font-weight:800;text-decoration:none;cursor:pointer;flex:0 0 auto}.pv-chat-email-btn:hover{filter:brightness(.97)}.pv-chat-powered{margin-top:2px;text-align:center;color:#a0a0a0;font-size:12px;font-weight:700}"
      + ".pv-chat-conv-list{flex:1;min-height:0;overflow:auto;padding:14px 16px;background:#fff;display:flex;flex-direction:column;gap:10px}.pv-chat-conv-card{text-align:left;border:1px solid #e7e2da;border-radius:16px;background:#fff;padding:14px;cursor:pointer;display:flex;flex-direction:column;gap:6px;width:100%}.pv-chat-conv-card:hover{background:#faf8f5;border-color:#d8d2c8}.pv-chat-conv-top{display:flex;align-items:center;justify-content:space-between;gap:8px}.pv-chat-conv-when{font-size:12px;font-weight:700;color:#8a8a8a}.pv-chat-conv-count{font-size:11px;font-weight:700;color:#b1aaa2;flex:0 0 auto}.pv-chat-conv-snippet{font-size:14px;line-height:1.45;color:#2b2b2b;font-weight:600;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}"
      + ".pv-chat-nav{margin-top:auto;height:74px;border-top:1px solid #e7e5e0;background:#fbfbfa;display:flex;align-items:center;justify-content:space-around;flex:0 0 auto}.pv-chat-nav button{width:72px;border:0;background:transparent;color:#8a8a8a;display:flex;flex-direction:column;align-items:center;gap:5px;font-size:11px;font-weight:700;cursor:pointer}.pv-chat-nav svg{width:24px;height:24px}.pv-chat-nav button.active{color:#1f1f1f}"
      + ".pv-chat-topbar{height:76px;background:#fff;color:#171717;display:flex;align-items:center;gap:12px;padding:0 16px;border-bottom:1px solid #ece9e4;flex:0 0 auto}.pv-chat-back{width:34px;height:34px;border:0;background:transparent;color:#555;font-size:28px;line-height:1;cursor:pointer}.pv-chat-title-wrap{display:flex;align-items:center;gap:10px;min-width:0;flex:1}.pv-chat-small-avatar{width:34px;height:34px;border-radius:999px;overflow:hidden;background:#111;flex:0 0 auto}.pv-chat-small-avatar img{width:100%;height:100%;object-fit:cover;display:block}.pv-chat-title{font-size:16px;font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.pv-chat-sub{font-size:12px;color:#777;margin-top:3px}.pv-chat-x{width:34px;height:34px;border:0;background:transparent;color:#555;font-size:28px;line-height:1;cursor:pointer}"
      + ".pv-chat-notice{margin:14px 16px 10px;height:46px;border:1px solid #e7e2da;border-radius:12px;background:#fff;display:flex;align-items:center;gap:9px;padding:0 12px;color:#777;font-size:14px;white-space:nowrap;overflow:hidden}.pv-chat-notice span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis}.pv-chat-contact{margin:0 16px 12px;padding:14px;border:1px solid #e7e2da;border-radius:16px;background:#fff;display:grid;gap:10px}.pv-chat-contact.saved{display:none}.pv-chat-help{font-size:13px;line-height:1.45;color:#756c61;background:#fff7ef;border:1px solid #ead7c4;border-radius:10px;padding:10px}.pv-chat-error{display:none;font-size:13px;line-height:1.45;color:#9f1239;background:#fff1f2;border:1px solid #fecdd3;border-radius:10px;padding:9px 10px}.pv-chat-error.show{display:block}"
      + ".pv-chat-input{width:100%;border:1px solid #d8d0c4;border-radius:12px;background:#fffdf9;padding:12px 13px;font-size:16px;line-height:1.25;outline:none;color:#171717}.pv-chat-input:focus{border-color:#141414;box-shadow:0 0 0 2px rgba(20,20,20,.06)}.pv-chat-save{height:44px;border:0;border-radius:12px;background:#141414;color:#fff;font-weight:800;cursor:pointer;font-size:15px}"
      + ".pv-chat-messages{flex:1;min-height:0;overflow:auto;padding:12px 16px 16px;background:#fff;display:flex;flex-direction:column;gap:10px}.pv-chat-bubble{max-width:84%;padding:11px 13px;border-radius:14px;font-size:14px;line-height:1.5;white-space:pre-wrap;word-break:break-word}.pv-chat-bubble.in{align-self:flex-start;background:#f5f4f2;border:1px solid #e5e1d9;color:#1f2933}.pv-chat-bubble.out{align-self:flex-end;background:#141414;color:#fff}.pv-chat-empty{font-size:14px;color:#625b52;background:#f8f6f2;border:1px solid #e2dbd1;border-radius:14px;padding:14px;line-height:1.55}"
      + ".pv-chat-sendfail{display:none;margin:0 12px 8px;font-size:13px;line-height:1.45;color:#9f1239;background:#fff1f2;border:1px solid #fecdd3;border-radius:10px;padding:9px 10px;flex:0 0 auto}.pv-chat-sendfail.show{display:block}"
      + ".pv-chat-attach{width:46px;min-height:46px;border:1px solid #d8d0c4;border-radius:16px;background:#fff;color:#6b635a;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:20px;flex:0 0 auto}.pv-chat-attach:hover{background:#faf8f5}.pv-chat-attach:disabled{opacity:.45;cursor:default}"
      + ".pv-chat-bubble.has-img{padding:6px}.pv-chat-bubble .pv-chat-img{display:block;max-width:220px;max-height:220px;border-radius:10px;cursor:pointer;background:#eee}.pv-chat-bubble.has-img .pv-chat-img-cap{padding:6px 7px 3px;font-size:14px;line-height:1.5}"
      + ".pv-chat-compose{border-top:1px solid #e1dbd1;padding:10px 12px;background:#fff;display:flex;gap:8px;flex:0 0 auto}.pv-chat-text{flex:1;min-height:46px;max-height:110px;resize:none;border:1px solid #d8d0c4;border-radius:16px;background:#f3f4f6;padding:13px 12px;font-size:16px;line-height:1.25;outline:none;color:#171717}.pv-chat-text:focus{border-color:#141414;box-shadow:0 0 0 2px rgba(20,20,20,.06)}.pv-chat-send{width:60px;border:0;border-radius:16px;background:#141414;color:#fff;font-weight:800;cursor:pointer;font-size:14px}.pv-chat-fab-new{align-self:center;margin:auto auto 28px;height:48px;padding:0 22px;border:0;border-radius:16px;background:#b1aaa2;color:#fff;font-size:16px;font-weight:800;box-shadow:0 10px 22px rgba(122,112,100,.26);cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:8px}"
      + "@media(max-width:640px){html.pv-chat-lock,html.pv-chat-lock body{overflow:hidden!important}.pv-chat-root{right:14px;bottom:calc(14px + var(--pv-chat-lift,0px))}.pv-chat-button{width:68px;height:68px}.pv-chat-panel{position:fixed;inset:0;width:100vw;max-width:none;height:100dvh;max-height:none;border:0;border-radius:0;box-shadow:none;background:#f5f4f2}.pv-chat-home-body{padding:calc(env(safe-area-inset-top,0px) + 22px) 20px 18px}.pv-chat-topbar{height:calc(env(safe-area-inset-top,0px) + 74px);padding-top:env(safe-area-inset-top,0px)}.pv-chat-nav{height:calc(env(safe-area-inset-bottom,0px) + 76px);padding-bottom:env(safe-area-inset-bottom,0px)}.pv-chat-compose{padding-bottom:calc(env(safe-area-inset-bottom,0px) + 10px)}.pv-chat-home-head{margin-top:2px}.pv-chat-brand-name{font-size:22px}.pv-chat-card{border-radius:22px;padding:20px 16px 16px}.pv-chat-card-copy{font-size:16px}.pv-chat-primary{height:54px}.pv-chat-messages{padding-bottom:18px}}";
    document.head.appendChild(el("style", { text: css }));
    // 브랜드 accent 오버라이드(폴바이스=토프 기본, 해리엇=골드). 액센트 요소만 재색.
    var accentCss =
      ".pv-chat-primary,.pv-chat-fab-new,.pv-chat-email-btn,.pv-chat-method-icon.hot{background:" + config.accent + "}"
      + ".pv-chat-bot{color:" + config.accent + "}";
    document.head.appendChild(el("style", { text: accentCss }));
  }

  function renderMessages(box, messages) {
    box.innerHTML = "";
    if (!messages || messages.length === 0) {
      box.appendChild(el("div", { class: "pv-chat-empty", text: config.t.emptyMsg }));
      return;
    }
    messages.forEach(function (msg) {
      var bubble = el("div", { class: "pv-chat-bubble " + (msg.direction === "out" ? "in" : "out") });
      var imgs = (msg.attachments || []).filter(function (a) { return a && a.isImage && a.url; });
      if (imgs.length) {
        bubble.className += " has-img";
        imgs.forEach(function (a) {
          var im = el("img", { class: "pv-chat-img", src: a.url, alt: a.name || "photo", loading: "lazy" });
          im.addEventListener("load", function () { box.scrollTop = box.scrollHeight; });
          im.addEventListener("click", function () { try { window.open(a.url, "_blank"); } catch (_) {} });
          bubble.appendChild(im);
        });
        // 서버가 넣는 자리표시자([사진]/[Photo])만 있으면 텍스트 줄은 생략
        var cap = (msg.body_text || "").trim();
        if (cap && cap !== "[사진]" && cap !== "[Photo]") {
          bubble.appendChild(el("div", { class: "pv-chat-img-cap", text: cap }));
        }
      } else {
        bubble.textContent = msg.body_text || "";
      }
      box.appendChild(bubble);
    });
    box.scrollTop = box.scrollHeight;
  }

  function loadMessages(box) {
    var id = getConversationId();
    if (!id) {
      renderMessages(box, []);
      return;
    }
    api("/api/cs/webchat/messages?conversationId=" + encodeURIComponent(id), { method: "GET" })
      .then(function (json) {
        if (!json.ok) return;
        var msgs = json.messages || [];
        // 새 메시지(관리자 답변 포함)가 오면 활동 시각 리셋 → 폴링 다시 빨라짐
        if (lastMsgCount >= 0 && msgs.length > lastMsgCount) pollActivityTs = Date.now();
        lastMsgCount = msgs.length;
        renderMessages(box, msgs);
      })
      .catch(function () {});
  }

  function build() {
    injectStyles();
    var root = el("div", { class: "pv-chat-root" });
    var btnImg = el("img", { class: "pv-chat-btn-img", src: config.baseUrl + config.imgBase + "/floating-button.png", alt: config.t.consult, draggable: "false" });
    var button = el("button", { class: "pv-chat-button", type: "button", "aria-label": config.t.consult }, [btnImg]);
    var panel = el("div", { class: "pv-chat-panel", role: "dialog", "aria-label": config.t.consult });
    var contact = getContact();
    function validEmail(v) { return /^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$/.test((v || "").trim()); }
    function contactReady(c) {
      if (!c || !c.name) return false;
      if (config.emailOnly) return validEmail(c.email);
      return !!c.phone && c.phone.replace(/\\D/g, "").length >= 10;
    }
    var hasSavedContact = contactReady(contact);

    var chatReturnView = "home";
    var homeScreen = el("div", { class: "pv-chat-screen pv-chat-home active" });
    var chatScreen = el("div", { class: "pv-chat-screen pv-chat-chat" });
    var listScreen = el("div", { class: "pv-chat-screen pv-chat-list" });
    var messages = el("div", { class: "pv-chat-messages" });
    var contactBox = el("div", { class: "pv-chat-contact" + (hasSavedContact ? " saved" : "") });
    var helpText = el("div", { class: "pv-chat-help", text: config.t.helpText });
    var errorText = el("div", { class: "pv-chat-error", text: "" });
    var nameInput = el("input", { class: "pv-chat-input", placeholder: config.t.namePh, value: contact.name || "", autocomplete: "name" });
    var phoneInput = el("input", { class: "pv-chat-input", placeholder: config.t.phonePh, value: contact.phone || "", inputmode: "tel", autocomplete: "tel" });
    var emailInput = el("input", { class: "pv-chat-input", placeholder: config.t.emailPh, value: contact.email || "", inputmode: "email", autocomplete: "email" });
    var saveButton = el("button", { class: "pv-chat-save", type: "button", text: config.t.startChat });
    var textarea = el("textarea", { class: "pv-chat-text", placeholder: config.t.typeMsg, rows: "1" });
    var sendFailBox = el("div", { class: "pv-chat-sendfail", text: config.t.sendFailed });
    var send = el("button", { class: "pv-chat-send", type: "button", text: config.t.send });
    var fileInput = el("input", { type: "file", accept: "image/*", style: "display:none" });
    var attachBtn = el("button", { class: "pv-chat-attach", type: "button", "aria-label": config.t.attachAria, title: config.t.attachAria });

    function avatar(className) {
      var node = el("span", { class: className, "aria-hidden": "true" });
      node.appendChild(el("img", { src: config.baseUrl + config.imgBase + "/avatar.png", alt: "", draggable: "false" }));
      return node;
    }

    function icon(name) {
      var paths = {
        home: '<path d="M3 10.5 12 3l9 7.5V21h-6v-6H9v6H3z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>',
        chat: '<path d="M4 5h16v11H8l-4 4z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>',
        gear: '<path d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z" fill="none" stroke="currentColor" stroke-width="2"/><path d="M19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.5-2.4 1a7.8 7.8 0 0 0-2.1-1.2L14 3h-4l-.4 2.6a7.8 7.8 0 0 0-2.1 1.2l-2.4-1-2 3.5 2 1.5A7 7 0 0 0 5 12c0 .4 0 .8.1 1.2l-2 1.5 2 3.5 2.4-1a7.8 7.8 0 0 0 2.1 1.2L10 21h4l.4-2.6a7.8 7.8 0 0 0 2.1-1.2l2.4 1 2-3.5-2-1.5c.1-.4.1-.8.1-1.2Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>',
        send: '<path d="M4 12 21 4l-8 17-2-7z" fill="currentColor"/>',
        clock: '<path d="M12 7v5l3 2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/>',
        megaphone: '<path d="M4 12h4l9-5v10l-9-5H4Z" fill="currentColor"/><path d="M8 12v5" fill="none" stroke="currentColor" stroke-width="2"/>',
        mail: '<path d="M3 6.5h18v11H3z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="m3.5 7.5 8.5 6 8.5-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>',
        photo: '<rect x="3" y="5" width="18" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="9" cy="10.5" r="1.7" fill="currentColor"/><path d="m5.5 16.5 4-4 3 3 2.5-2.5 3.5 3.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>'
      };
      // width/height 를 1em 으로 고정 — CSS 로 크기를 지정한 곳(nav·bot 등)은 그대로 두고,
      // 지정이 없는 곳(시계·확성기·전송 아이콘)이 기본 300px 로 거대하게 렌더되는 것을 막는다.
      return '<svg viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true" focusable="false" style="flex:0 0 auto;vertical-align:middle">' + (paths[name] || "") + '</svg>';
    }

    function nav(active) {
      var wrap = el("div", { class: "pv-chat-nav" });
      var home = el("button", { type: "button", class: active === "home" ? "active" : "" });
      home.innerHTML = icon("home") + "<span>" + config.t.navHome + "</span>";
      var chat = el("button", { type: "button", class: active === "chat" ? "active" : "" });
      chat.innerHTML = icon("chat") + "<span>" + config.t.navChat + "</span>";
      home.addEventListener("click", function () { showView("home"); });
      chat.addEventListener("click", function () { showView("list"); });
      wrap.appendChild(home);
      wrap.appendChild(chat);
      return wrap;
    }

    var closeHome = el("button", { class: "pv-chat-close", type: "button", "aria-label": config.t.closeAria, text: "×" });
    var startButton = el("button", { class: "pv-chat-primary", type: "button" });
    startButton.innerHTML = config.t.inquire + icon("send");

    var homeBody = el("div", { class: "pv-chat-home-body" });
    homeBody.appendChild(el("div", { class: "pv-chat-home-head" }, [
      avatar("pv-chat-avatar"),
      el("div", { class: "pv-chat-brand" }, [
        el("div", { class: "pv-chat-brand-name", text: config.brandName }),
        el("button", { class: "pv-chat-hours-link", type: "button", text: config.t.viewHours })
      ]),
      closeHome
    ]));
    var cardCopy = el("div", { class: "pv-chat-card-copy" });
    cardCopy.innerHTML = config.t.cardCopy;
    homeBody.appendChild(el("div", { class: "pv-chat-card" }, [
      el("div", { class: "pv-chat-card-row" }, [
        (function () { var bot = el("span", { class: "pv-chat-bot" }); bot.innerHTML = icon("chat"); return bot; })(),
        cardCopy
      ]),
      startButton,
      (function () { var time = el("div", { class: "pv-chat-card-time" }); time.innerHTML = icon("clock") + "<span>" + config.t.openFrom + "</span>"; return time; })()
    ]));
    var emailButton = el("a", {
      class: "pv-chat-email-btn",
      href: "mailto:" + config.email + "?subject=" + encodeURIComponent(config.t.mailSubject),
      "aria-label": config.t.emailUs
    });
    emailButton.innerHTML = icon("mail") + "<span>" + config.t.emailUs + "</span>";
    homeBody.appendChild(el("div", { class: "pv-chat-methods" }, [
      el("span", { text: config.t.otherWays }),
      emailButton
    ]));
    homeBody.appendChild(el("div", { class: "pv-chat-powered", text: config.t.usingChat }));
    homeScreen.appendChild(homeBody);
    homeScreen.appendChild(nav("home"));

    contactBox.appendChild(helpText);
    contactBox.appendChild(errorText);
    contactBox.appendChild(nameInput);
    if (!config.emailOnly) contactBox.appendChild(phoneInput);
    contactBox.appendChild(emailInput);
    contactBox.appendChild(saveButton);

    function topbar(title, showBack, onBack) {
      var back = el("button", { class: "pv-chat-back", type: "button", "aria-label": config.t.backAria, text: "‹" });
      var close = el("button", { class: "pv-chat-x", type: "button", "aria-label": config.t.closeAria, text: "×" });
      back.style.visibility = showBack ? "visible" : "hidden";
      back.addEventListener("click", onBack || function () { showView("home"); });
      close.addEventListener("click", closePanel);
      return el("div", { class: "pv-chat-topbar" }, [
        back,
        el("div", { class: "pv-chat-title-wrap" }, [
          avatar("pv-chat-small-avatar"),
          el("div", {}, [
            el("div", { class: "pv-chat-title", text: title }),
            el("div", { class: "pv-chat-sub", text: config.t.openFrom })
          ])
        ]),
        close
      ]);
    }

    var notice = el("div", { class: "pv-chat-notice" });
    notice.innerHTML = icon("megaphone") + "<span>" + config.t.notice + "</span>";
    chatScreen.appendChild(topbar(config.brandName, true, function () { showView(chatReturnView); }));
    chatScreen.appendChild(notice);
    chatScreen.appendChild(contactBox);
    chatScreen.appendChild(messages);
    chatScreen.appendChild(sendFailBox);
    attachBtn.innerHTML = icon("photo");
    chatScreen.appendChild(el("div", { class: "pv-chat-compose" }, [fileInput, attachBtn, textarea, send]));

    var convList = el("div", { class: "pv-chat-conv-list" });
    var newButton = el("button", { class: "pv-chat-fab-new", type: "button" });
    newButton.innerHTML = config.t.newChat + icon("send");
    listScreen.appendChild(topbar(config.t.chatsTitle, true, function () { showView("home"); }));
    listScreen.appendChild(convList);
    listScreen.appendChild(newButton);
    listScreen.appendChild(nav("chat"));

    panel.appendChild(homeScreen);
    panel.appendChild(chatScreen);
    panel.appendChild(listScreen);
    root.appendChild(panel);
    root.appendChild(button);
    document.body.appendChild(root);

    function showView(view) {
      currentView = view;
      homeScreen.classList.toggle("active", view === "home");
      chatScreen.classList.toggle("active", view === "chat");
      listScreen.classList.toggle("active", view === "list");
      if (view === "chat") loadMessages(messages);
      if (view === "list") loadConversationList();
    }

    function renderConversationCards(summaries) {
      convList.innerHTML = "";
      (summaries || []).forEach(function (s) {
        if (!s || !s.count) return; // 메시지 없는(미시작) 대화는 숨김
        var card = el("button", { class: "pv-chat-conv-card", type: "button" });
        var prefix = s.lastDirection === "out" ? config.t.replyPrefix : "";
        card.innerHTML =
          '<div class="pv-chat-conv-top"><span class="pv-chat-conv-when">' + esc(formatWhen(s.lastAt)) + '</span>'
          + '<span class="pv-chat-conv-count">' + esc(String(s.count)) + config.t.countSuffix + '</span></div>'
          + '<div class="pv-chat-conv-snippet">' + esc(prefix + (s.lastText || "")) + '</div>';
        card.addEventListener("click", function () { openConversation(s.conversationId); });
        convList.appendChild(card);
      });
      if (!convList.children.length) {
        convList.appendChild(el("div", { class: "pv-chat-empty", text: config.t.noConvs }));
      }
    }

    function loadConversationList() {
      var ids = getConversations();
      if (!ids.length) {
        renderConversationCards([]);
        return;
      }
      api("/api/cs/webchat/summary", {
        method: "POST",
        body: JSON.stringify({ conversationIds: ids })
      }).then(function (json) {
        if (json && json.ok) renderConversationCards(json.summaries || []);
      }).catch(function () {});
    }

    function openConversation(id) {
      if (!id) return;
      setConversationId(id);
      chatReturnView = "list";
      showView("chat");
    }

    function startNewConversation(returnView) {
      clearConversationId();
      chatReturnView = returnView || "home";
      renderMessages(messages, []);
      showView("chat");
      focusComposerIfContactSaved();
    }

    function openPanel(targetView) {
      isOpen = true;
      panel.classList.add("open");
      document.documentElement.classList.add("pv-chat-lock");
      button.style.display = "none";
      showView(targetView || "home");
      // 백오프 폴링 시작(활동 직후 5초 → 30초 → 4분 무응답 시 중단, 답변은 SMS로 비동기 전달).
      pollActivityTs = Date.now();
      lastMsgCount = -1;
      startPolling();
    }

    // 자기예약 setTimeout 백오프 폴링. 새 메시지/전송(pollActivityTs 리셋) 시 다시 빨라짐.
    function startPolling() {
      clearTimeout(pollTimer);
      (function schedulePoll() {
        var idle = Date.now() - pollActivityTs;
        if (idle > 240000) return;                 // 4분 무응답 → 중단(SMS 흐름에 위임)
        var delay = idle < 30000 ? 5000 : (idle < 120000 ? 15000 : 30000);
        pollTimer = setTimeout(function () {
          if (!isOpen) return;
          if (!document.hidden) {
            if (currentView === "chat") { loadMessages(messages); pingPresence("active"); }
            if (currentView === "list") loadConversationList();
          }
          schedulePoll();
        }, delay);
      })();
    }

    function closePanel() {
      isOpen = false;
      panel.classList.remove("open");
      document.documentElement.classList.remove("pv-chat-lock");
      button.style.display = "flex";
      clearTimeout(pollTimer);
      pingPresence("away");
    }

    function currentContact() {
      return {
        name: nameInput.value.trim(),
        phone: phoneInput.value.trim(),
        email: emailInput.value.trim()
      };
    }

    function showContactError(message) {
      // ⚠️ 연락처 박스가 숨겨진(.saved) 상태면 에러 문구도 입력칸도 안 보인다 —
      //    고객은 전송 버튼을 눌러도 아무 반응이 없는 것으로 느끼고 상담이 유실된다(2026-08-19 장한비 건).
      //    검증 실패 시에는 무조건 박스를 다시 펼쳐서 무엇을 채워야 하는지 보이게 한다.
      contactBox.classList.remove("saved");
      errorText.textContent = message;
      errorText.classList.add("show");
    }

    function clearContactError() {
      errorText.textContent = "";
      errorText.classList.remove("show");
    }

    function validateContact(contact) {
      if (!contact.name) {
        showContactError(config.t.errName);
        nameInput.focus();
        return false;
      }
      if (config.emailOnly) {
        if (!validEmail(contact.email)) {
          showContactError(config.t.errContact);
          emailInput.focus();
          return false;
        }
      } else if (!contact.phone || contact.phone.replace(/\\D/g, "").length < 10) {
        showContactError(config.t.errContact);
        phoneInput.focus();
        return false;
      }
      clearContactError();
      return true;
    }

    function sendMessage() {
      var text = textarea.value.trim();
      if (!text) return;
      var contact = currentContact();
      if (!validateContact(contact)) return;
      saveContact(contact);
      contactBox.classList.add("saved");
      textarea.value = "";
      sendFailBox.classList.remove("show");
      ensureSession(contact).then(function (session) {
        if (!session || !session.conversationId) throw new Error("session_failed");
        return api("/api/cs/webchat/messages", {
          method: "POST",
          body: JSON.stringify(Object.assign({}, pageMeta(), contact, {
            conversationId: session.conversationId,
            body: text,
            brand: config.brand
          }))
        });
      }).then(function (res) {
        if (!res || res.ok === false) throw new Error((res && res.error) || "send_failed");
        loadMessages(messages);
        pollActivityTs = Date.now();   // 전송 직후엔 빠른 폴링 재개(중단됐다면 재시작)
        if (isOpen) startPolling();
      }).catch(function (err) {
        // ⚠️ 실패를 조용히 삼키면 고객은 보냈다고 믿고 답을 기다린다 —
        //    실제로 CORS 차단으로 영문몰 상담이 통째로 유실됐다(2026-08-05).
        //    입력 내용을 되돌려주고 실패를 눈에 보이게 알린다.
        if (!textarea.value) textarea.value = text;
        sendFailBox.textContent = config.t.sendFailed;
        sendFailBox.classList.add("show");
        if (window.console && console.warn) console.warn("[pv-chat] 전송 실패", err);
      });
    }

    function sendImage(file) {
      if (!file) return;
      if (file.size > 12 * 1024 * 1024) {
        sendFailBox.textContent = config.t.photoTooBig;
        sendFailBox.classList.add("show");
        fileInput.value = "";
        return;
      }
      var contact = currentContact();
      if (!validateContact(contact)) { fileInput.value = ""; return; }
      saveContact(contact);
      contactBox.classList.add("saved");
      sendFailBox.classList.remove("show");
      attachBtn.disabled = true;
      ensureSession(contact).then(function (session) {
        if (!session || !session.conversationId) throw new Error("session_failed");
        var fd = new FormData();
        fd.append("file", file);
        fd.append("conversationId", session.conversationId);
        fd.append("name", contact.name);
        fd.append("phone", contact.phone || "");
        fd.append("email", contact.email || "");
        fd.append("brand", config.brand);
        fd.append("label", config.lang);
        fd.append("pageUrl", location.href);
        // FormData 는 Content-Type 을 직접 지정하면 boundary 가 빠져 깨진다 — api() 헬퍼 대신 직접 fetch.
        return fetch(config.baseUrl + "/api/cs/webchat/upload", { method: "POST", mode: "cors", body: fd })
          .then(function (res) { return res.json(); });
      }).then(function (res) {
        if (!res || res.ok === false) throw new Error((res && res.error) || "upload_failed");
        attachBtn.disabled = false;
        fileInput.value = "";
        loadMessages(messages);
        pollActivityTs = Date.now();
        if (isOpen) startPolling();
      }).catch(function (err) {
        attachBtn.disabled = false;
        fileInput.value = "";
        sendFailBox.textContent = config.t.uploadFailed;
        sendFailBox.classList.add("show");
        if (window.console && console.warn) console.warn("[pv-chat] 사진 전송 실패", err);
      });
    }

    function focusComposerIfContactSaved() {
      var saved = getContact();
      if (contactReady(saved)) {
        setTimeout(function () { textarea.focus(); }, 120);
      }
    }

    button.addEventListener("click", function () { openPanel("home"); });
    closeHome.addEventListener("click", closePanel);
    startButton.addEventListener("click", function () { startNewConversation("home"); });
    newButton.addEventListener("click", function () { startNewConversation("list"); });
    saveButton.addEventListener("click", function () {
      var contact = currentContact();
      if (!validateContact(contact)) return;
      saveContact(contact);
      contactBox.classList.add("saved");
      ensureSession(contact).then(function () { loadMessages(messages); textarea.focus(); });
    });
    nameInput.addEventListener("input", clearContactError);
    phoneInput.addEventListener("input", clearContactError);
    send.addEventListener("click", sendMessage);
    attachBtn.addEventListener("click", function () { fileInput.click(); });
    fileInput.addEventListener("change", function () {
      sendImage(fileInput.files && fileInput.files[0]);
    });
    textarea.addEventListener("keydown", function (event) {
      // 한글(IME) 조합 중 Enter는 글자 확정용이므로 무시한다.
      // 무시하지 않으면 조합 확정 Enter + 실제 Enter 두 번이 발생해
      // 마지막 글자("요" 등)가 별도 메시지로 한 번 더 전송된다.
      if (event.isComposing || event.keyCode === 229) return;
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        sendMessage();
      }
    });

    // 화면 이탈(탭 전환·최소화) / 사이트 이탈 시 away 신호 → 미확인 답변 있으면 그때 SMS 발송.
    document.addEventListener("visibilitychange", function () {
      if (!isOpen) return;
      if (document.hidden) pingPresence("away");
      else pingPresence("active");
    });
    window.addEventListener("pagehide", function () {
      if (isOpen) pingPresence("away");
    });

    // 이번 업데이트 이전부터 진행 중이던 대화도 "대화" 목록에 보이도록 1회 이관.
    var existing = getConversationId();
    if (existing) addConversation(existing);

    try {
      var params = new URLSearchParams(location.search);
      var linkedConversation = params.get("pv_chat");
      if (linkedConversation && /^pv_[a-z0-9_]{12,80}$/i.test(linkedConversation)) {
        setConversationId(linkedConversation);
        chatReturnView = "home";
        // 답변 알림 SMS 링크는 대개 **처음 상담한 기기가 아닌 폰**에서 열린다.
        // 그 기기엔 localStorage 연락처가 없는데 예전엔 여기서 무조건 숨겨버려서,
        // 답변은 읽히지만 답장은 검증 실패로 조용히 막혔다(2026-08-19 장한비 건).
        // 연락처가 실제로 준비된 경우에만 숨긴다. pv_n/pv_p 가 오면 채워준다.
        var ln = (params.get("pv_n") || "").slice(0, 40);
        var lp = (params.get("pv_p") || "").replace(/[^0-9-]/g, "").slice(0, 20);
        if (ln && !nameInput.value) nameInput.value = ln;
        if (lp && !phoneInput.value) phoneInput.value = lp;
        if (contactReady(currentContact())) contactBox.classList.add("saved");
        setTimeout(function () { openPanel("chat"); }, 250);
      } else if (params.get("pv_open") === "1") {
        // CS 문자(SMS)에 넣는 상담 링크 — 기존 대화가 없는 고객도 바로 채팅이 열리게 한다.
        // 070(아톡)으로 오는 답장은 CS 인박스에 안 들어오므로, 회신 동선을 웹챗으로 모으는 용도.
        // pv_n/pv_p 로 이름·연락처를 미리 채워 고객이 다시 입력하지 않게 함(대화는 첫 메시지 전송 시 생성 → 유령 스레드 없음).
        var pn = (params.get("pv_n") || "").slice(0, 40);
        var pp = (params.get("pv_p") || "").replace(/[^0-9-]/g, "").slice(0, 20);
        if (pn && !nameInput.value) nameInput.value = pn;
        if (pp && !phoneInput.value) phoneInput.value = pp;
        setTimeout(function () { openPanel("chat"); }, 250);
      }
    } catch (_) {}

    // 외부(푸터 버튼 등)에서 위젯을 열 수 있도록 노출.
    function openWebchat(view) {
      if (isOpen) showView(view || "home");
      else openPanel(view || "home");
    }
    window.PaulviceWebchat = { open: openWebchat };

    // 공홈 푸터의 "카카오톡 플러스 친구" 문의 링크 → 웹채팅 열기로 교체.
    // (카카오싱크 로그인 버튼은 pf.kakao.com 앵커가 아니므로 영향 없음)
    // 요소(또는 6단계 이내 조상)가 고정/플로팅이면 그 컨테이너 반환.
    function floatingAncestor(node) {
      var el = node, depth = 0;
      while (el && depth < 6) {
        try { var p = getComputedStyle(el).position; if (p === "fixed" || p === "sticky") return el; } catch (_) {}
        el = el.parentElement; depth++;
      }
      return null;
    }
    function rewireKakaoLinks() {
      var links = document.querySelectorAll('a[href*="pf.kakao.com"], a[href*="plus.kakao.com"]');
      for (var i = 0; i < links.length; i++) {
        (function (a) {
          if (a.getAttribute("data-pv-webchat") === "1") return;
          a.setAttribute("data-pv-webchat", "1");
          // 플로팅 카카오 상담 버튼 → 우리 위젯 버튼으로 대체하므로 숨김
          var floatRoot = floatingAncestor(a);
          if (floatRoot) { floatRoot.style.display = "none"; return; }
          // 푸터/링크형 → 클릭 시 우리 웹채팅 열기. 텍스트 라벨만 교체(아이콘은 보존).
          a.setAttribute("href", "javascript:void(0)");
          a.addEventListener("click", function (e) { e.preventDefault(); openWebchat("home"); });
          var txt = a.querySelectorAll(".footer__txt");
          for (var j = 0; j < txt.length; j++) {
            if (/카카오/.test(txt[j].textContent || "")) txt[j].textContent = config.t.chatCta;
          }
        })(links[i]);
      }
    }
    // 더 이상 사용하지 않는 푸터의 "PLVE 앰배서더 신청하기" 메뉴 제거.
    function removeAmbassadorLink() {
      var byHref = document.querySelectorAll('a[href*="linkd.kr/ambassador"]');
      for (var i = 0; i < byHref.length; i++) {
        var a = byHref[i];
        var li = a.closest ? a.closest("li") : null;
        (li || a).style.display = "none";
      }
      var items = document.querySelectorAll("li.footer__menu");
      for (var j = 0; j < items.length; j++) {
        if (/앰배서더|ambassador/i.test(items[j].textContent || "")) items[j].style.display = "none";
      }
    }

    // 해리엇 스킨 우측 퀵메뉴(#right_quick: 카카오상담·최근본상품·맨위/아래로) 전체 숨김.
    // 카카오가 onclick=window.open(pf.kakao) 방식이라 href 기준 rewire가 못 잡으므로 별도 처리.
    function hideStorefrontQuickMenu() {
      var rq = document.getElementById("right_quick");
      if (rq) rq.style.display = "none";
      // onclick 안에 pf.kakao 가 든 버튼(별도 위치)도 컨테이너째 숨김
      var nodes = document.querySelectorAll('[onclick*="pf.kakao.com"]');
      for (var i = 0; i < nodes.length; i++) {
        var box = nodes[i].closest ? (nodes[i].closest("li, p, div") || nodes[i]) : nodes[i];
        box.style.display = "none";
      }
    }
    function applyFooterTweaks() {
      rewireKakaoLinks();
      removeAmbassadorLink();
      hideStorefrontQuickMenu();
    }
    applyFooterTweaks();
    setTimeout(applyFooterTweaks, 600);

    // 스토어프론트 하단 고정바(카페24 상품페이지 #orderFixArea = BUY IT NOW/CART 등) 위로 버튼을 띄운다.
    // 위젯 z-index가 21억이라 그냥 두면 구매 버튼을 덮어버림(해리엇 영문몰 모바일에서 확인, 2026-08-05).
    // 스킨별 셀렉터를 박으면 다른 몰에서 어긋나므로 화면 기하로 판별 — 폴바이스·해리엇 공용 코드.
    var LIFT_MAX = 200;
    function bottomBarLift() {
      var vh = window.innerHeight || 0, vw = window.innerWidth || 0;
      if (!vh || !vw || !document.body) return 0;
      var nodes = document.body.querySelectorAll("*");
      var lift = 0;
      for (var i = 0; i < nodes.length; i++) {
        var node = nodes[i];
        if (root === node || root.contains(node)) continue;
        var cs;
        try { cs = getComputedStyle(node); } catch (_) { continue; }
        if (cs.position !== "fixed" && cs.position !== "sticky") continue;
        if (cs.display === "none" || cs.visibility === "hidden" || cs.opacity === "0") continue;
        var b = node.getBoundingClientRect();
        if (b.width < vw * 0.6) continue;                 // 화면 폭을 가로지르는 바만
        if (b.height < 40 || b.height > LIFT_MAX) continue; // 얇은 선·전체화면 오버레이 제외
        if (b.bottom < vh - 40 || b.top > vh - 10) continue; // 화면 하단에 붙어 있는 것만
        var h = Math.min(vh - b.top, LIFT_MAX);
        if (h > lift) lift = h;
      }
      return Math.round(lift);
    }
    var liftTimer = null, lastLift = -1;
    function applyLift() {
      var v = bottomBarLift();
      if (v === lastLift) return;
      lastLift = v;
      root.style.setProperty("--pv-chat-lift", v ? (v + 12) + "px" : "0px");
    }
    function scheduleLift() {
      if (liftTimer) return;
      // 바는 스크롤에 따라 나타났다 사라지므로 재계산이 필요하나, DOM 전체를 훑기에 스로틀 필수.
      liftTimer = setTimeout(function () { liftTimer = null; applyLift(); }, 250);
    }
    window.addEventListener("scroll", scheduleLift, { passive: true });
    window.addEventListener("resize", scheduleLift);
    applyLift();
    setTimeout(applyLift, 600);
    setTimeout(applyLift, 1500);
    setTimeout(applyFooterTweaks, 2000);

    // /about.html — 폴바이스 무드로 재디자인. 오프라인 매장 오해를 주던
    // "스토어"(구글맵+주소) 섹션을 제거하고 온라인 전용임을 명확히 안내한다.
    function applyAboutRedesign() {
      if (config.brand !== "paulvice") return; // 폴바이스 전용(PLVE 콘텐츠)
      if (!/\\/about(\\.html)?$/i.test(location.pathname)) return;
      var root = document.querySelector(".about");
      if (!root || root.getAttribute("data-pv-about") === "1") return;
      root.setAttribute("data-pv-about", "1");

      var css = ""
        + ".pv-about{max-width:940px;margin:0 auto;padding:72px 24px 104px;font-family:Arial,'Apple SD Gothic Neo','Noto Sans KR',sans-serif;color:#3a352f;background:#fff}.pv-about *{box-sizing:border-box}"
        + ".pv-about-hero{text-align:center}.pv-about-eyebrow{font-size:12px;letter-spacing:.24em;text-transform:uppercase;color:#a59c92;font-weight:700}"
        + ".pv-about-word{font-family:'Times New Roman','Nanum Myeongjo',serif;font-size:clamp(56px,12vw,98px);font-weight:400;letter-spacing:.14em;margin:16px 0 0;color:#2b2620;line-height:1;padding-left:.14em}"
        + ".pv-about-kr{font-size:15px;letter-spacing:.52em;color:#8c8278;margin-top:12px;padding-left:.52em}.pv-about-tag{font-family:'Times New Roman','Nanum Myeongjo',serif;font-style:italic;font-size:19px;color:#9a8f83;margin-top:20px}"
        + ".pv-about-rule{width:48px;height:1px;background:#cfc7bb;margin:44px auto}"
        + ".pv-about-story{max-width:680px;margin:0 auto;text-align:center}.pv-about-story p{font-size:16px;line-height:2;color:#4a443d;margin:0 0 18px;word-break:keep-all}.pv-about-en{font-size:14px;line-height:1.9;color:#9a8f83;font-style:italic}"
        + ".pv-about-values{display:flex;gap:18px;justify-content:center;margin:60px auto 0;max-width:780px;flex-wrap:wrap}.pv-about-value{flex:1;min-width:208px;text-align:center;padding:28px 18px;border:1px solid #ece7df;border-radius:16px;background:#faf8f5}.pv-about-value-t{font-family:'Times New Roman',serif;font-size:20px;letter-spacing:.04em;color:#2b2620}.pv-about-value-d{font-size:13px;color:#8c8278;margin-top:9px;line-height:1.6;word-break:keep-all}"
        + ".pv-about-contact{margin:68px auto 0;max-width:780px;background:#faf8f5;border:1px solid #ece7df;border-radius:22px;padding:44px 32px;text-align:center}.pv-about-title{font-family:'Times New Roman',serif;font-size:27px;letter-spacing:.08em;color:#2b2620}.pv-about-online{font-size:14px;line-height:1.75;color:#6b635a;margin:14px auto 0;max-width:480px;word-break:keep-all}.pv-about-online b{color:#8c8278}"
        + ".pv-about-grid{display:flex;gap:14px;justify-content:center;flex-wrap:wrap;margin:30px 0 6px}.pv-about-ci{flex:1;min-width:212px;background:#fff;border:1px solid #ece7df;border-radius:14px;padding:18px}.pv-about-ci span{display:block;font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#a59c92;font-weight:700}.pv-about-ci b{display:block;font-size:15px;color:#3a352f;margin-top:9px;font-weight:700;line-height:1.65}"
        + ".pv-about-cta{margin-top:28px;height:52px;padding:0 30px;border:0;border-radius:16px;background:#b1aaa2;color:#fff;font-size:15px;font-weight:800;cursor:pointer;box-shadow:0 10px 22px rgba(122,112,100,.26)}.pv-about-cta:hover{filter:brightness(.97)}"
        + "@media(max-width:640px){.pv-about{padding:48px 18px 76px}.pv-about-contact{padding:34px 20px}.pv-about-values{margin-top:44px}}";
      document.head.appendChild(el("style", { text: css }));

      var html = [
        '<section class="pv-about">',
          '<div class="pv-about-hero">',
            '<div class="pv-about-eyebrow">Watch &amp; Jewelry &middot; Official Online</div>',
            '<h1 class="pv-about-word">PLVE</h1>',
            '<div class="pv-about-kr">폴바이스</div>',
            '<div class="pv-about-tag">A style that transcends time</div>',
          '</div>',
          '<div class="pv-about-rule"></div>',
          '<div class="pv-about-story">',
            '<p>폴바이스 PLVE는 우아한 여성들의 아름다움을 간결한 디자인과 최고급 소재로 담아내는 한국산 여성 시계·주얼리 브랜드입니다. 각 제품은 현대 여성의 라이프스타일을 반영해 정교하게 제작되며, 우리는 시간을 넘어서는 스타일을 추구합니다.</p>',
            '<p class="pv-about-en">PLVE is a Korean women’s watch &amp; jewelry brand that captures the beauty of elegant women through simple designs and premium materials. Each piece is meticulously crafted to reflect the lifestyle of the modern woman. We pursue a style that transcends time.</p>',
          '</div>',
          '<div class="pv-about-values">',
            '<div class="pv-about-value"><div class="pv-about-value-t">Modern Classic</div><div class="pv-about-value-d">시대를 타지 않는 간결한 디자인</div></div>',
            '<div class="pv-about-value"><div class="pv-about-value-t">Premium Materials</div><div class="pv-about-value-d">최고급 소재의 정교한 마감</div></div>',
            '<div class="pv-about-value"><div class="pv-about-value-t">Timeless</div><div class="pv-about-value-d">시간을 넘어서는 무드의 완성</div></div>',
          '</div>',
          '<div class="pv-about-contact">',
            '<div class="pv-about-title">Contact</div>',
            '<p class="pv-about-online">폴바이스는 별도의 오프라인 매장 없이 <b>온라인 공식몰</b>로만 운영됩니다. 문의는 아래 채널로 연락 주세요.</p>',
            '<div class="pv-about-grid">',
              '<div class="pv-about-ci"><span>고객센터</span><b>070-4571-4944</b></div>',
              '<div class="pv-about-ci"><span>이메일</span><b>plvekorea@gmail.com</b></div>',
              '<div class="pv-about-ci"><span>운영시간</span><b>월–금 10:00–17:00<br>점심 12:00–13:00 · 주말·공휴일 휴무</b></div>',
            '</div>',
            '<button type="button" class="pv-about-cta">채팅 상담 문의하기</button>',
          '</div>',
        '</section>'
      ].join("");
      root.innerHTML = html;

      var cta = root.querySelector(".pv-about-cta");
      if (cta) cta.addEventListener("click", function () { openWebchat("home"); });
    }
    applyAboutRedesign();
    setTimeout(applyAboutRedesign, 600);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", build);
  else build();
})();`;
}
