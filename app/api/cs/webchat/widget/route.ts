export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const baseUrl = `${url.protocol}//${url.host}`;
  const brandName = url.searchParams.get("brandName") || "PAULVICE";
  const accent = sanitizeColor(url.searchParams.get("accent") || "#111827");

  return new Response(buildWidgetScript({ baseUrl, brandName, accent }), {
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

function buildWidgetScript(input: { baseUrl: string; brandName: string; accent: string }): string {
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
        conversationId: getConversationId()
      }))
    }).then(function (json) {
      if (json.conversationId) setConversationId(json.conversationId);
      return json;
    });
  }

  function injectStyles() {
    var css = ""
      + ".pv-chat-root{position:fixed;right:22px;bottom:22px;z-index:2147483000;font-family:Arial,'Apple SD Gothic Neo','Noto Sans KR',sans-serif;color:#161616;letter-spacing:0;-webkit-font-smoothing:antialiased}"
      + ".pv-chat-root *{box-sizing:border-box}"
      + ".pv-chat-button{position:relative;width:76px;height:76px;border:0;background:transparent;padding:0;cursor:pointer;display:block;line-height:0;transition:transform .18s ease,filter .18s ease;filter:drop-shadow(0 12px 20px rgba(0,0,0,.24)) drop-shadow(0 3px 6px rgba(0,0,0,.16))}"
      + ".pv-chat-button:hover{transform:translateY(-2px);filter:drop-shadow(0 16px 26px rgba(0,0,0,.28)) drop-shadow(0 4px 8px rgba(0,0,0,.18))}"
      + ".pv-chat-btn-img{width:100%;height:100%;object-fit:contain;display:block;pointer-events:none}"
      + ".pv-chat-panel{display:none;width:420px;max-width:calc(100vw - 32px);height:680px;max-height:calc(100vh - 84px);background:#f5f4f2;border:1px solid #d8d2c8;border-radius:12px;box-shadow:0 24px 70px rgba(17,17,17,.22);overflow:hidden}"
      + ".pv-chat-panel.open{display:flex;flex-direction:column}.pv-chat-screen{display:none;min-height:0;flex:1;flex-direction:column;background:#f5f4f2}.pv-chat-screen.active{display:flex}"
      + ".pv-chat-home{padding:0}.pv-chat-home-body{flex:1;min-height:0;overflow:auto;display:flex;flex-direction:column;gap:16px;padding:24px 18px 18px}.pv-chat-home-head{display:flex;align-items:center;gap:13px;padding:0 2px}.pv-chat-avatar{width:48px;height:48px;border-radius:999px;overflow:hidden;background:#111;flex:0 0 auto}.pv-chat-avatar img{width:100%;height:100%;object-fit:cover;display:block}.pv-chat-brand{min-width:0;flex:1}.pv-chat-brand-name{font-size:20px;font-weight:800;line-height:1.2;color:#171717}.pv-chat-hours-link{margin-top:6px;font-size:13px;color:#777;background:transparent;border:0;padding:0;cursor:pointer}.pv-chat-close{width:40px;height:40px;border:0;border-radius:999px;background:#858585;color:#fff;font-size:28px;line-height:1;cursor:pointer;display:flex;align-items:center;justify-content:center;flex:0 0 auto}"
      + ".pv-chat-card{background:#fff;border:1px solid #ebe8e3;border-radius:20px;padding:18px 16px 16px;box-shadow:0 1px 0 rgba(0,0,0,.02)}.pv-chat-card-row{display:flex;gap:12px}.pv-chat-bot{width:38px;height:38px;border-radius:999px;background:#ece8e3;color:#8c8278;display:flex;align-items:center;justify-content:center;flex:0 0 auto}.pv-chat-bot svg{width:22px;height:22px}.pv-chat-card-copy{font-size:15px;line-height:1.55;font-weight:700;color:#202020}.pv-chat-card-copy p{margin:0 0 12px}.pv-chat-primary{width:100%;height:52px;border:0;border-radius:16px;background:#b1aaa2;color:#fff;font-size:16px;font-weight:800;cursor:pointer;box-shadow:0 8px 18px rgba(122,112,100,.28);display:flex;align-items:center;justify-content:center;gap:8px}.pv-chat-card-time{display:flex;align-items:center;justify-content:center;gap:6px;margin-top:10px;font-size:13px;font-weight:700;color:#777}.pv-chat-methods{display:flex;align-items:center;justify-content:space-between;gap:12px;background:#fff;border:1px solid #ebe8e3;border-radius:18px;padding:12px 14px 12px 16px;color:#8a8a8a;font-size:14px}.pv-chat-email-btn{display:inline-flex;align-items:center;gap:7px;height:40px;padding:0 16px;border:0;border-radius:14px;background:#b1aaa2;color:#fff;font-size:14px;font-weight:800;text-decoration:none;cursor:pointer;flex:0 0 auto}.pv-chat-email-btn:hover{filter:brightness(.97)}.pv-chat-powered{margin-top:2px;text-align:center;color:#a0a0a0;font-size:12px;font-weight:700}"
      + ".pv-chat-conv-list{flex:1;min-height:0;overflow:auto;padding:14px 16px;background:#fff;display:flex;flex-direction:column;gap:10px}.pv-chat-conv-card{text-align:left;border:1px solid #e7e2da;border-radius:16px;background:#fff;padding:14px;cursor:pointer;display:flex;flex-direction:column;gap:6px;width:100%}.pv-chat-conv-card:hover{background:#faf8f5;border-color:#d8d2c8}.pv-chat-conv-top{display:flex;align-items:center;justify-content:space-between;gap:8px}.pv-chat-conv-when{font-size:12px;font-weight:700;color:#8a8a8a}.pv-chat-conv-count{font-size:11px;font-weight:700;color:#b1aaa2;flex:0 0 auto}.pv-chat-conv-snippet{font-size:14px;line-height:1.45;color:#2b2b2b;font-weight:600;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}"
      + ".pv-chat-nav{margin-top:auto;height:74px;border-top:1px solid #e7e5e0;background:#fbfbfa;display:flex;align-items:center;justify-content:space-around;flex:0 0 auto}.pv-chat-nav button{width:72px;border:0;background:transparent;color:#8a8a8a;display:flex;flex-direction:column;align-items:center;gap:5px;font-size:11px;font-weight:700;cursor:pointer}.pv-chat-nav svg{width:24px;height:24px}.pv-chat-nav button.active{color:#1f1f1f}"
      + ".pv-chat-topbar{height:76px;background:#fff;color:#171717;display:flex;align-items:center;gap:12px;padding:0 16px;border-bottom:1px solid #ece9e4;flex:0 0 auto}.pv-chat-back{width:34px;height:34px;border:0;background:transparent;color:#555;font-size:28px;line-height:1;cursor:pointer}.pv-chat-title-wrap{display:flex;align-items:center;gap:10px;min-width:0;flex:1}.pv-chat-small-avatar{width:34px;height:34px;border-radius:999px;overflow:hidden;background:#111;flex:0 0 auto}.pv-chat-small-avatar img{width:100%;height:100%;object-fit:cover;display:block}.pv-chat-title{font-size:16px;font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.pv-chat-sub{font-size:12px;color:#777;margin-top:3px}.pv-chat-x{width:34px;height:34px;border:0;background:transparent;color:#555;font-size:28px;line-height:1;cursor:pointer}"
      + ".pv-chat-notice{margin:14px 16px 10px;height:46px;border:1px solid #e7e2da;border-radius:12px;background:#fff;display:flex;align-items:center;gap:9px;padding:0 12px;color:#777;font-size:14px;white-space:nowrap;overflow:hidden}.pv-chat-notice span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis}.pv-chat-contact{margin:0 16px 12px;padding:14px;border:1px solid #e7e2da;border-radius:16px;background:#fff;display:grid;gap:10px}.pv-chat-contact.saved{display:none}.pv-chat-help{font-size:13px;line-height:1.45;color:#756c61;background:#fff7ef;border:1px solid #ead7c4;border-radius:10px;padding:10px}.pv-chat-error{display:none;font-size:13px;line-height:1.45;color:#9f1239;background:#fff1f2;border:1px solid #fecdd3;border-radius:10px;padding:9px 10px}.pv-chat-error.show{display:block}"
      + ".pv-chat-input{width:100%;border:1px solid #d8d0c4;border-radius:12px;background:#fffdf9;padding:12px 13px;font-size:16px;line-height:1.25;outline:none;color:#171717}.pv-chat-input:focus{border-color:#141414;box-shadow:0 0 0 2px rgba(20,20,20,.06)}.pv-chat-save{height:44px;border:0;border-radius:12px;background:#141414;color:#fff;font-weight:800;cursor:pointer;font-size:15px}"
      + ".pv-chat-messages{flex:1;min-height:0;overflow:auto;padding:12px 16px 16px;background:#fff;display:flex;flex-direction:column;gap:10px}.pv-chat-bubble{max-width:84%;padding:11px 13px;border-radius:14px;font-size:14px;line-height:1.5;white-space:pre-wrap;word-break:break-word}.pv-chat-bubble.in{align-self:flex-start;background:#f5f4f2;border:1px solid #e5e1d9;color:#1f2933}.pv-chat-bubble.out{align-self:flex-end;background:#141414;color:#fff}.pv-chat-empty{font-size:14px;color:#625b52;background:#f8f6f2;border:1px solid #e2dbd1;border-radius:14px;padding:14px;line-height:1.55}"
      + ".pv-chat-compose{border-top:1px solid #e1dbd1;padding:10px 12px;background:#fff;display:flex;gap:8px;flex:0 0 auto}.pv-chat-text{flex:1;min-height:46px;max-height:110px;resize:none;border:1px solid #d8d0c4;border-radius:16px;background:#f3f4f6;padding:13px 12px;font-size:16px;line-height:1.25;outline:none;color:#171717}.pv-chat-text:focus{border-color:#141414;box-shadow:0 0 0 2px rgba(20,20,20,.06)}.pv-chat-send{width:60px;border:0;border-radius:16px;background:#141414;color:#fff;font-weight:800;cursor:pointer;font-size:14px}.pv-chat-fab-new{align-self:center;margin:auto auto 28px;height:48px;padding:0 22px;border:0;border-radius:16px;background:#b1aaa2;color:#fff;font-size:16px;font-weight:800;box-shadow:0 10px 22px rgba(122,112,100,.26);cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:8px}"
      + "@media(max-width:640px){html.pv-chat-lock,html.pv-chat-lock body{overflow:hidden!important}.pv-chat-root{right:14px;bottom:14px}.pv-chat-button{width:68px;height:68px}.pv-chat-panel{position:fixed;inset:0;width:100vw;max-width:none;height:100dvh;max-height:none;border:0;border-radius:0;box-shadow:none;background:#f5f4f2}.pv-chat-home-body{padding:calc(env(safe-area-inset-top,0px) + 22px) 20px 18px}.pv-chat-topbar{height:calc(env(safe-area-inset-top,0px) + 74px);padding-top:env(safe-area-inset-top,0px)}.pv-chat-nav{height:calc(env(safe-area-inset-bottom,0px) + 76px);padding-bottom:env(safe-area-inset-bottom,0px)}.pv-chat-compose{padding-bottom:calc(env(safe-area-inset-bottom,0px) + 10px)}.pv-chat-home-head{margin-top:2px}.pv-chat-brand-name{font-size:22px}.pv-chat-card{border-radius:22px;padding:20px 16px 16px}.pv-chat-card-copy{font-size:16px}.pv-chat-primary{height:54px}.pv-chat-messages{padding-bottom:18px}}";
    document.head.appendChild(el("style", { text: css }));
  }

  function renderMessages(box, messages) {
    box.innerHTML = "";
    if (!messages || messages.length === 0) {
      box.appendChild(el("div", { class: "pv-chat-empty", text: "제품, 배송, AS 문의를 남겨주시면 확인 후 순서대로 답변드리겠습니다. 화면을 닫아도 답변 알림 문자의 링크로 이어서 확인하실 수 있습니다." }));
      return;
    }
    messages.forEach(function (msg) {
      box.appendChild(el("div", {
        class: "pv-chat-bubble " + (msg.direction === "out" ? "in" : "out"),
        text: msg.body_text || ""
      }));
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
      .then(function (json) { if (json.ok) renderMessages(box, json.messages || []); })
      .catch(function () {});
  }

  function build() {
    injectStyles();
    var root = el("div", { class: "pv-chat-root" });
    var btnImg = el("img", { class: "pv-chat-btn-img", src: config.baseUrl + "/webchat/floating-button.png", alt: config.brandName + " 상담", draggable: "false" });
    var button = el("button", { class: "pv-chat-button", type: "button", "aria-label": config.brandName + " 상담 열기" }, [btnImg]);
    var panel = el("div", { class: "pv-chat-panel", role: "dialog", "aria-label": config.brandName + " 상담" });
    var contact = getContact();
    var hasSavedContact = contact.name && contact.phone && contact.phone.replace(/\\D/g, "").length >= 10;

    var chatReturnView = "home";
    var homeScreen = el("div", { class: "pv-chat-screen pv-chat-home active" });
    var chatScreen = el("div", { class: "pv-chat-screen pv-chat-chat" });
    var listScreen = el("div", { class: "pv-chat-screen pv-chat-list" });
    var messages = el("div", { class: "pv-chat-messages" });
    var contactBox = el("div", { class: "pv-chat-contact" + (hasSavedContact ? " saved" : "") });
    var helpText = el("div", { class: "pv-chat-help", text: "답변 알림을 문자로 보내드리기 위해 이름과 연락처가 필요합니다. 화면을 떠나도 링크로 이어서 상담하실 수 있습니다." });
    var errorText = el("div", { class: "pv-chat-error", text: "" });
    var nameInput = el("input", { class: "pv-chat-input", placeholder: "이름", value: contact.name || "", autocomplete: "name" });
    var phoneInput = el("input", { class: "pv-chat-input", placeholder: "연락처", value: contact.phone || "", inputmode: "tel", autocomplete: "tel" });
    var emailInput = el("input", { class: "pv-chat-input", placeholder: "이메일(선택)", value: contact.email || "", inputmode: "email", autocomplete: "email" });
    var saveButton = el("button", { class: "pv-chat-save", type: "button", text: "상담 시작" });
    var textarea = el("textarea", { class: "pv-chat-text", placeholder: "메시지를 입력해주세요.", rows: "1" });
    var send = el("button", { class: "pv-chat-send", type: "button", text: "전송" });

    function avatar(className) {
      var node = el("span", { class: className, "aria-hidden": "true" });
      node.appendChild(el("img", { src: config.baseUrl + "/webchat/avatar.png", alt: "", draggable: "false" }));
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
        mail: '<path d="M3 6.5h18v11H3z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="m3.5 7.5 8.5 6 8.5-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>'
      };
      // width/height 를 1em 으로 고정 — CSS 로 크기를 지정한 곳(nav·bot 등)은 그대로 두고,
      // 지정이 없는 곳(시계·확성기·전송 아이콘)이 기본 300px 로 거대하게 렌더되는 것을 막는다.
      return '<svg viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true" focusable="false" style="flex:0 0 auto;vertical-align:middle">' + (paths[name] || "") + '</svg>';
    }

    function nav(active) {
      var wrap = el("div", { class: "pv-chat-nav" });
      var home = el("button", { type: "button", class: active === "home" ? "active" : "" });
      home.innerHTML = icon("home") + "<span>홈</span>";
      var chat = el("button", { type: "button", class: active === "chat" ? "active" : "" });
      chat.innerHTML = icon("chat") + "<span>대화</span>";
      home.addEventListener("click", function () { showView("home"); });
      chat.addEventListener("click", function () { showView("list"); });
      wrap.appendChild(home);
      wrap.appendChild(chat);
      return wrap;
    }

    var closeHome = el("button", { class: "pv-chat-close", type: "button", "aria-label": "상담 닫기", text: "×" });
    var startButton = el("button", { class: "pv-chat-primary", type: "button" });
    startButton.innerHTML = "문의하기 " + icon("send");

    var homeBody = el("div", { class: "pv-chat-home-body" });
    homeBody.appendChild(el("div", { class: "pv-chat-home-head" }, [
      avatar("pv-chat-avatar"),
      el("div", { class: "pv-chat-brand" }, [
        el("div", { class: "pv-chat-brand-name", text: config.brandName }),
        el("button", { class: "pv-chat-hours-link", type: "button", text: "운영시간 보기 >" })
      ]),
      closeHome
    ]));
    var cardCopy = el("div", { class: "pv-chat-card-copy" });
    cardCopy.innerHTML = '<p>폴바이스 상담 채널입니다.</p><p>제품, 배송, AS 문의를 남겨주시면 확인 후 순서대로 답변드리겠습니다.</p><p>상담 가능 시간은 월요일 - 금요일 10:00 - 18:00 입니다.</p>';
    homeBody.appendChild(el("div", { class: "pv-chat-card" }, [
      el("div", { class: "pv-chat-card-row" }, [
        (function () { var bot = el("span", { class: "pv-chat-bot" }); bot.innerHTML = icon("chat"); return bot; })(),
        cardCopy
      ]),
      startButton,
      (function () { var time = el("div", { class: "pv-chat-card-time" }); time.innerHTML = icon("clock") + "<span>오전 10:00부터 운영해요</span>"; return time; })()
    ]));
    var emailButton = el("a", {
      class: "pv-chat-email-btn",
      href: "mailto:plvekorea@gmail.com?subject=" + encodeURIComponent("[PAULVICE 문의]"),
      "aria-label": "이메일 문의"
    });
    emailButton.innerHTML = icon("mail") + "<span>이메일 문의</span>";
    homeBody.appendChild(el("div", { class: "pv-chat-methods" }, [
      el("span", { text: "다른 방법으로 문의" }),
      emailButton
    ]));
    homeBody.appendChild(el("div", { class: "pv-chat-powered", text: "PAULVICE 상담 이용중" }));
    homeScreen.appendChild(homeBody);
    homeScreen.appendChild(nav("home"));

    contactBox.appendChild(helpText);
    contactBox.appendChild(errorText);
    contactBox.appendChild(nameInput);
    contactBox.appendChild(phoneInput);
    contactBox.appendChild(emailInput);
    contactBox.appendChild(saveButton);

    function topbar(title, showBack, onBack) {
      var back = el("button", { class: "pv-chat-back", type: "button", "aria-label": "뒤로", text: "‹" });
      var close = el("button", { class: "pv-chat-x", type: "button", "aria-label": "상담 닫기", text: "×" });
      back.style.visibility = showBack ? "visible" : "hidden";
      back.addEventListener("click", onBack || function () { showView("home"); });
      close.addEventListener("click", closePanel);
      return el("div", { class: "pv-chat-topbar" }, [
        back,
        el("div", { class: "pv-chat-title-wrap" }, [
          avatar("pv-chat-small-avatar"),
          el("div", {}, [
            el("div", { class: "pv-chat-title", text: title }),
            el("div", { class: "pv-chat-sub", text: "오전 10:00부터 운영해요" })
          ])
        ]),
        close
      ]);
    }

    var notice = el("div", { class: "pv-chat-notice" });
    notice.innerHTML = icon("megaphone") + "<span>월-금 10:00 - 18:00, 점심시간 12:30 - 13:30</span>";
    chatScreen.appendChild(topbar(config.brandName, true, function () { showView(chatReturnView); }));
    chatScreen.appendChild(notice);
    chatScreen.appendChild(contactBox);
    chatScreen.appendChild(messages);
    chatScreen.appendChild(el("div", { class: "pv-chat-compose" }, [textarea, send]));

    var convList = el("div", { class: "pv-chat-conv-list" });
    var newButton = el("button", { class: "pv-chat-fab-new", type: "button" });
    newButton.innerHTML = "새 문의하기 " + icon("send");
    listScreen.appendChild(topbar("대화", true, function () { showView("home"); }));
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
        var prefix = s.lastDirection === "out" ? "답변: " : "";
        card.innerHTML =
          '<div class="pv-chat-conv-top"><span class="pv-chat-conv-when">' + esc(formatWhen(s.lastAt)) + '</span>'
          + '<span class="pv-chat-conv-count">' + esc(String(s.count)) + '개</span></div>'
          + '<div class="pv-chat-conv-snippet">' + esc(prefix + (s.lastText || "")) + '</div>';
        card.addEventListener("click", function () { openConversation(s.conversationId); });
        convList.appendChild(card);
      });
      if (!convList.children.length) {
        convList.appendChild(el("div", { class: "pv-chat-empty", text: "아직 나눈 대화가 없어요. 아래 ‘새 문의하기’로 문의를 시작해 보세요." }));
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
      clearInterval(pollTimer);
      pollTimer = setInterval(function () {
        if (!isOpen || document.hidden) return;
        if (currentView === "chat") {
          loadMessages(messages);
          // 채팅 화면을 보는 동안은 고객이 답변을 곧 확인한다는 신호.
          pingPresence("active");
        }
        if (currentView === "list") loadConversationList();
      }, 5000);
    }

    function closePanel() {
      isOpen = false;
      panel.classList.remove("open");
      document.documentElement.classList.remove("pv-chat-lock");
      button.style.display = "flex";
      clearInterval(pollTimer);
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
      errorText.textContent = message;
      errorText.classList.add("show");
    }

    function clearContactError() {
      errorText.textContent = "";
      errorText.classList.remove("show");
    }

    function validateContact(contact) {
      if (!contact.name) {
        showContactError("상담을 시작하려면 이름을 입력해 주세요.");
        nameInput.focus();
        return false;
      }
      if (!contact.phone || contact.phone.replace(/\\D/g, "").length < 10) {
        showContactError("답변 알림을 받을 수 있는 연락처를 입력해 주세요.");
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
      ensureSession(contact).then(function (session) {
        return api("/api/cs/webchat/messages", {
          method: "POST",
          body: JSON.stringify(Object.assign({}, pageMeta(), contact, {
            conversationId: session.conversationId,
            body: text
          }))
        });
      }).then(function () { loadMessages(messages); });
    }

    function focusComposerIfContactSaved() {
      var saved = getContact();
      if (saved.name && saved.phone && saved.phone.replace(/\\D/g, "").length >= 10) {
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
        contactBox.classList.add("saved");
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
    function rewireKakaoLinks() {
      var links = document.querySelectorAll('a[href*="pf.kakao.com"], a[href*="plus.kakao.com"]');
      for (var i = 0; i < links.length; i++) {
        (function (a) {
          if (a.getAttribute("data-pv-webchat") === "1") return;
          a.setAttribute("data-pv-webchat", "1");
          a.setAttribute("href", "javascript:void(0)");
          a.addEventListener("click", function (e) {
            e.preventDefault();
            openWebchat("home");
          });
          var txt = a.querySelectorAll(".footer__txt");
          var replaced = false;
          for (var j = 0; j < txt.length; j++) {
            if (/카카오/.test(txt[j].textContent || "")) { txt[j].textContent = "채팅 상담 문의하기"; replaced = true; }
          }
          if (!replaced && /카카오/.test(a.textContent || "")) a.textContent = "채팅 상담 문의하기";
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
        if (/앰배서더/.test(items[j].textContent || "")) items[j].style.display = "none";
      }
    }

    function applyFooterTweaks() {
      rewireKakaoLinks();
      removeAmbassadorLink();
    }
    applyFooterTweaks();
    setTimeout(applyFooterTweaks, 600);
    setTimeout(applyFooterTweaks, 2000);

    // /about.html — 폴바이스 무드로 재디자인. 오프라인 매장 오해를 주던
    // "스토어"(구글맵+주소) 섹션을 제거하고 온라인 전용임을 명확히 안내한다.
    function applyAboutRedesign() {
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
              '<div class="pv-about-ci"><span>운영시간</span><b>월–금 11:00–17:00<br>점심 12:00–13:00 · 주말·공휴일 휴무</b></div>',
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
