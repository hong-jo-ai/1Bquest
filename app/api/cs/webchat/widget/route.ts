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
    if (id) localStorage.setItem(STORAGE_KEY, id);
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

  function monogramSvg(className) {
    return '<svg class="' + className + '" viewBox="0 0 100 100" focusable="false" aria-hidden="true"><path fill="currentColor" d="M43 8h14v14H43zM18 25h45c20 0 32 13 32 31 0 17-12 30-30 31v-14c9-1 15-8 15-17 0-10-7-18-18-18H31v26h14v13H31v15H18zM43 38h14v40l36-2 1 16H43z"/></svg>';
  }

  function injectStyles() {
    var css = ""
      + ".pv-chat-root{position:fixed;right:22px;bottom:22px;z-index:2147483000;font-family:Arial,'Apple SD Gothic Neo','Noto Sans KR',sans-serif;color:#161616;letter-spacing:0;-webkit-font-smoothing:antialiased}"
      + ".pv-chat-root *{box-sizing:border-box}"
      + ".pv-chat-button{position:relative;width:72px;height:72px;border:3px solid #fff;border-radius:999px;background:#c9152d;color:#fff;box-shadow:0 16px 38px rgba(83,14,24,.26),0 4px 12px rgba(0,0,0,.16);cursor:pointer;display:flex;align-items:center;justify-content:center;line-height:1;transition:transform .18s ease,box-shadow .18s ease,filter .18s ease}"
      + ".pv-chat-button:before{content:'';position:absolute;left:1px;bottom:1px;width:25px;height:22px;background:#c9152d;border-left:3px solid #fff;border-bottom:3px solid #fff;clip-path:polygon(0 100%,100% 48%,23% 0);transform:translate(-9px,8px);z-index:-1}"
      + ".pv-chat-button:after{content:'';position:absolute;inset:0;border-radius:999px;background:radial-gradient(circle at 32% 24%,rgba(255,255,255,.18),rgba(255,255,255,0) 42%);pointer-events:none}"
      + ".pv-chat-button:hover{transform:translateY(-2px);filter:saturate(1.04);box-shadow:0 20px 45px rgba(83,14,24,.3),0 6px 15px rgba(0,0,0,.18)}"
      + ".pv-chat-mark{position:relative;z-index:1;width:46px;height:46px;display:flex;align-items:center;justify-content:center;color:#fff}.pv-chat-logo{width:40px;height:40px;display:block;filter:drop-shadow(0 1px 1px rgba(0,0,0,.16))}"
      + ".pv-chat-panel{display:none;width:420px;max-width:calc(100vw - 32px);height:680px;max-height:calc(100vh - 84px);background:#f5f4f2;border:1px solid #d8d2c8;border-radius:12px;box-shadow:0 24px 70px rgba(17,17,17,.22);overflow:hidden}"
      + ".pv-chat-panel.open{display:flex;flex-direction:column}.pv-chat-screen{display:none;min-height:0;flex:1;flex-direction:column;background:#f5f4f2}.pv-chat-screen.active{display:flex}"
      + ".pv-chat-home{padding:24px 18px 0;gap:16px}.pv-chat-home-head{display:flex;align-items:center;gap:13px;padding:0 2px}.pv-chat-avatar{width:48px;height:48px;border-radius:999px;background:#111;color:#fff;display:flex;align-items:center;justify-content:center;flex:0 0 auto}.pv-chat-avatar svg{width:28px;height:28px}.pv-chat-brand{min-width:0;flex:1}.pv-chat-brand-name{font-size:20px;font-weight:800;line-height:1.2;color:#171717}.pv-chat-hours-link{margin-top:6px;font-size:13px;color:#777;background:transparent;border:0;padding:0;cursor:pointer}.pv-chat-close{width:40px;height:40px;border:0;border-radius:999px;background:#858585;color:#fff;font-size:28px;line-height:1;cursor:pointer;display:flex;align-items:center;justify-content:center;flex:0 0 auto}"
      + ".pv-chat-card{background:#fff;border:1px solid #ebe8e3;border-radius:20px;padding:18px 16px 16px;box-shadow:0 1px 0 rgba(0,0,0,.02)}.pv-chat-card-row{display:flex;gap:12px}.pv-chat-bot{width:38px;height:38px;border-radius:999px;background:#f3e7e7;color:#c9152d;display:flex;align-items:center;justify-content:center;flex:0 0 auto}.pv-chat-bot svg{width:22px;height:22px}.pv-chat-card-copy{font-size:15px;line-height:1.55;font-weight:700;color:#202020}.pv-chat-card-copy p{margin:0 0 12px}.pv-chat-primary{width:100%;height:52px;border:0;border-radius:16px;background:#c9152d;color:#fff;font-size:16px;font-weight:800;cursor:pointer;box-shadow:0 8px 18px rgba(201,21,45,.18)}.pv-chat-card-time{display:flex;align-items:center;justify-content:center;gap:6px;margin-top:10px;font-size:13px;font-weight:700;color:#777}.pv-chat-methods{display:flex;align-items:center;justify-content:space-between;background:#fff;border:1px solid #ebe8e3;border-radius:18px;padding:14px 16px;color:#8a8a8a;font-size:14px}.pv-chat-method-icons{display:flex;gap:8px}.pv-chat-method-icon{width:40px;height:40px;border:0;border-radius:14px;background:#f0efed;color:#777;font-size:20px;display:flex;align-items:center;justify-content:center}.pv-chat-method-icon.hot{background:#c9152d;color:#fff}.pv-chat-powered{margin-top:2px;text-align:center;color:#a0a0a0;font-size:12px;font-weight:700}"
      + ".pv-chat-nav{height:74px;border-top:1px solid #e7e5e0;background:#fbfbfa;display:flex;align-items:center;justify-content:space-around;flex:0 0 auto}.pv-chat-nav button{width:72px;border:0;background:transparent;color:#8a8a8a;display:flex;flex-direction:column;align-items:center;gap:5px;font-size:11px;font-weight:700;cursor:pointer}.pv-chat-nav svg{width:24px;height:24px}.pv-chat-nav button.active{color:#1f1f1f}"
      + ".pv-chat-topbar{height:76px;background:#fff;color:#171717;display:flex;align-items:center;gap:12px;padding:0 16px;border-bottom:1px solid #ece9e4;flex:0 0 auto}.pv-chat-back{width:34px;height:34px;border:0;background:transparent;color:#555;font-size:28px;line-height:1;cursor:pointer}.pv-chat-title-wrap{display:flex;align-items:center;gap:10px;min-width:0;flex:1}.pv-chat-small-avatar{width:34px;height:34px;border-radius:999px;background:#111;color:#fff;display:flex;align-items:center;justify-content:center;flex:0 0 auto}.pv-chat-small-avatar svg{width:20px;height:20px}.pv-chat-title{font-size:16px;font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.pv-chat-sub{font-size:12px;color:#777;margin-top:3px}.pv-chat-x{width:34px;height:34px;border:0;background:transparent;color:#555;font-size:28px;line-height:1;cursor:pointer}"
      + ".pv-chat-notice{margin:14px 16px 10px;height:46px;border:1px solid #e7e2da;border-radius:12px;background:#fff;display:flex;align-items:center;gap:9px;padding:0 12px;color:#777;font-size:14px;white-space:nowrap;overflow:hidden}.pv-chat-notice span{overflow:hidden;text-overflow:ellipsis}.pv-chat-contact{margin:0 16px 12px;padding:14px;border:1px solid #e7e2da;border-radius:16px;background:#fff;display:grid;gap:10px}.pv-chat-contact.saved{display:none}.pv-chat-help{font-size:13px;line-height:1.45;color:#756c61;background:#fff7ef;border:1px solid #ead7c4;border-radius:10px;padding:10px}.pv-chat-error{display:none;font-size:13px;line-height:1.45;color:#9f1239;background:#fff1f2;border:1px solid #fecdd3;border-radius:10px;padding:9px 10px}.pv-chat-error.show{display:block}"
      + ".pv-chat-input{width:100%;border:1px solid #d8d0c4;border-radius:12px;background:#fffdf9;padding:12px 13px;font-size:16px;line-height:1.25;outline:none;color:#171717}.pv-chat-input:focus{border-color:#141414;box-shadow:0 0 0 2px rgba(20,20,20,.06)}.pv-chat-save{height:44px;border:0;border-radius:12px;background:#141414;color:#fff;font-weight:800;cursor:pointer;font-size:15px}"
      + ".pv-chat-messages{flex:1;min-height:0;overflow:auto;padding:12px 16px 16px;background:#fff;display:flex;flex-direction:column;gap:10px}.pv-chat-bubble{max-width:84%;padding:11px 13px;border-radius:14px;font-size:14px;line-height:1.5;white-space:pre-wrap;word-break:break-word}.pv-chat-bubble.in{align-self:flex-start;background:#f5f4f2;border:1px solid #e5e1d9;color:#1f2933}.pv-chat-bubble.out{align-self:flex-end;background:#141414;color:#fff}.pv-chat-empty{font-size:14px;color:#625b52;background:#f8f6f2;border:1px solid #e2dbd1;border-radius:14px;padding:14px;line-height:1.55}"
      + ".pv-chat-compose{border-top:1px solid #e1dbd1;padding:10px 12px;background:#fff;display:flex;gap:8px;flex:0 0 auto}.pv-chat-text{flex:1;min-height:46px;max-height:110px;resize:none;border:1px solid #d8d0c4;border-radius:16px;background:#f3f4f6;padding:13px 12px;font-size:16px;line-height:1.25;outline:none;color:#171717}.pv-chat-text:focus{border-color:#141414;box-shadow:0 0 0 2px rgba(20,20,20,.06)}.pv-chat-send{width:60px;border:0;border-radius:16px;background:#141414;color:#fff;font-weight:800;cursor:pointer;font-size:14px}.pv-chat-fab-new{align-self:center;margin:auto auto 28px;height:48px;padding:0 22px;border:0;border-radius:16px;background:#c9152d;color:#fff;font-size:16px;font-weight:800;box-shadow:0 10px 22px rgba(201,21,45,.2);cursor:pointer}"
      + "@media(max-width:640px){html.pv-chat-lock,html.pv-chat-lock body{overflow:hidden!important}.pv-chat-root{right:14px;bottom:14px}.pv-chat-button{width:66px;height:66px}.pv-chat-button:before{width:23px;height:20px;transform:translate(-8px,7px)}.pv-chat-logo{width:36px;height:36px}.pv-chat-panel{position:fixed;inset:0;width:100vw;max-width:none;height:100dvh;max-height:none;border:0;border-radius:0;box-shadow:none;background:#f5f4f2}.pv-chat-home{padding:calc(env(safe-area-inset-top,0px) + 22px) 20px 0}.pv-chat-topbar{height:calc(env(safe-area-inset-top,0px) + 74px);padding-top:env(safe-area-inset-top,0px)}.pv-chat-nav{height:calc(env(safe-area-inset-bottom,0px) + 76px);padding-bottom:env(safe-area-inset-bottom,0px)}.pv-chat-compose{padding-bottom:calc(env(safe-area-inset-bottom,0px) + 10px)}.pv-chat-home-head{margin-top:2px}.pv-chat-brand-name{font-size:22px}.pv-chat-card{border-radius:22px;padding:20px 16px 16px}.pv-chat-card-copy{font-size:16px}.pv-chat-primary{height:54px}.pv-chat-messages{padding-bottom:18px}}";
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
    var mark = el("span", { class: "pv-chat-mark", "aria-hidden": "true" });
    mark.innerHTML = monogramSvg("pv-chat-logo");
    var button = el("button", { class: "pv-chat-button", type: "button", "aria-label": config.brandName + " 상담 열기" }, [mark]);
    var panel = el("div", { class: "pv-chat-panel", role: "dialog", "aria-label": config.brandName + " 상담" });
    var contact = getContact();
    var hasSavedContact = contact.name && contact.phone && contact.phone.replace(/\\D/g, "").length >= 10;

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
      node.innerHTML = monogramSvg("");
      return node;
    }

    function icon(name) {
      var paths = {
        home: '<path d="M3 10.5 12 3l9 7.5V21h-6v-6H9v6H3z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>',
        chat: '<path d="M4 5h16v11H8l-4 4z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>',
        gear: '<path d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z" fill="none" stroke="currentColor" stroke-width="2"/><path d="M19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.5-2.4 1a7.8 7.8 0 0 0-2.1-1.2L14 3h-4l-.4 2.6a7.8 7.8 0 0 0-2.1 1.2l-2.4-1-2 3.5 2 1.5A7 7 0 0 0 5 12c0 .4 0 .8.1 1.2l-2 1.5 2 3.5 2.4-1a7.8 7.8 0 0 0 2.1 1.2L10 21h4l.4-2.6a7.8 7.8 0 0 0 2.1-1.2l2.4 1 2-3.5-2-1.5c.1-.4.1-.8.1-1.2Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>',
        send: '<path d="M4 12 21 4l-8 17-2-7z" fill="currentColor"/>',
        clock: '<path d="M12 7v5l3 2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/>',
        megaphone: '<path d="M4 12h4l9-5v10l-9-5H4Z" fill="currentColor"/><path d="M8 12v5" fill="none" stroke="currentColor" stroke-width="2"/>'
      };
      return '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' + (paths[name] || "") + '</svg>';
    }

    function nav(active) {
      var wrap = el("div", { class: "pv-chat-nav" });
      var home = el("button", { type: "button", class: active === "home" ? "active" : "" });
      home.innerHTML = icon("home") + "<span>홈</span>";
      var chat = el("button", { type: "button", class: active === "chat" ? "active" : "" });
      chat.innerHTML = icon("chat") + "<span>대화</span>";
      var settings = el("button", { type: "button" });
      settings.innerHTML = icon("gear") + "<span>설정</span>";
      home.addEventListener("click", function () { showView("home"); });
      chat.addEventListener("click", function () { showView("list"); });
      settings.addEventListener("click", function () { showView("home"); });
      wrap.appendChild(home);
      wrap.appendChild(chat);
      wrap.appendChild(settings);
      return wrap;
    }

    var closeHome = el("button", { class: "pv-chat-close", type: "button", "aria-label": "상담 닫기", text: "×" });
    var startButton = el("button", { class: "pv-chat-primary", type: "button" });
    startButton.innerHTML = "문의하기 " + icon("send");

    homeScreen.appendChild(el("div", { class: "pv-chat-home-head" }, [
      avatar("pv-chat-avatar"),
      el("div", { class: "pv-chat-brand" }, [
        el("div", { class: "pv-chat-brand-name", text: config.brandName }),
        el("button", { class: "pv-chat-hours-link", type: "button", text: "운영시간 보기 >" })
      ]),
      closeHome
    ]));
    var cardCopy = el("div", { class: "pv-chat-card-copy" });
    cardCopy.innerHTML = '<p>폴바이스 상담 채널입니다.</p><p>제품, 배송, AS 문의를 남겨주시면 확인 후 순서대로 답변드리겠습니다.</p><p>상담 가능 시간은 월요일 - 금요일 10:00 - 18:00 입니다.</p>';
    homeScreen.appendChild(el("div", { class: "pv-chat-card" }, [
      el("div", { class: "pv-chat-card-row" }, [
        (function () { var bot = el("span", { class: "pv-chat-bot" }); bot.innerHTML = icon("chat"); return bot; })(),
        cardCopy
      ]),
      startButton,
      (function () { var time = el("div", { class: "pv-chat-card-time" }); time.innerHTML = icon("clock") + "<span>오전 10:00부터 운영해요</span>"; return time; })()
    ]));
    homeScreen.appendChild(el("div", { class: "pv-chat-methods" }, [
      el("span", { text: "다른 방법으로 문의" }),
      (function () {
        var icons = el("div", { class: "pv-chat-method-icons" });
        icons.appendChild(el("button", { class: "pv-chat-method-icon hot", type: "button", text: "●", "aria-label": "채팅" }));
        icons.appendChild(el("button", { class: "pv-chat-method-icon", type: "button", text: "…", "aria-label": "더보기" }));
        return icons;
      })()
    ]));
    homeScreen.appendChild(el("div", { class: "pv-chat-powered", text: "PAULVICE 상담 이용중" }));
    homeScreen.appendChild(nav("home"));

    contactBox.appendChild(helpText);
    contactBox.appendChild(errorText);
    contactBox.appendChild(nameInput);
    contactBox.appendChild(phoneInput);
    contactBox.appendChild(emailInput);
    contactBox.appendChild(saveButton);

    function topbar(title, showBack) {
      var back = el("button", { class: "pv-chat-back", type: "button", "aria-label": "뒤로", text: "‹" });
      var close = el("button", { class: "pv-chat-x", type: "button", "aria-label": "상담 닫기", text: "×" });
      back.style.visibility = showBack ? "visible" : "hidden";
      back.addEventListener("click", function () { showView("home"); });
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
    chatScreen.appendChild(topbar(config.brandName, true));
    chatScreen.appendChild(notice);
    chatScreen.appendChild(contactBox);
    chatScreen.appendChild(messages);
    chatScreen.appendChild(el("div", { class: "pv-chat-compose" }, [textarea, send]));

    var listMessages = el("div", { class: "pv-chat-messages" });
    var newButton = el("button", { class: "pv-chat-fab-new", type: "button" });
    newButton.innerHTML = "새 문의하기 " + icon("send");
    listScreen.appendChild(topbar("대화", true));
    listScreen.appendChild(listMessages);
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
      if (view === "chat") {
        loadMessages(messages);
      }
      if (view === "list") {
        loadMessages(listMessages);
      }
    }

    function openPanel(targetView) {
      isOpen = true;
      panel.classList.add("open");
      document.documentElement.classList.add("pv-chat-lock");
      button.style.display = "none";
      showView(targetView || "home");
      var saved = getContact();
      if (getConversationId()) {
        loadMessages(messages);
      } else if (saved.name && saved.phone && saved.phone.replace(/\\D/g, "").length >= 10) {
        ensureSession(saved).then(function () { loadMessages(messages); });
      }
      clearInterval(pollTimer);
      pollTimer = setInterval(function () {
        if (!isOpen) return;
        if (currentView === "chat") loadMessages(messages);
        if (currentView === "list") loadMessages(listMessages);
      }, 5000);
    }

    function closePanel() {
      isOpen = false;
      panel.classList.remove("open");
      document.documentElement.classList.remove("pv-chat-lock");
      button.style.display = "flex";
      clearInterval(pollTimer);
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
    startButton.addEventListener("click", function () { showView("chat"); focusComposerIfContactSaved(); });
    newButton.addEventListener("click", function () { showView("chat"); focusComposerIfContactSaved(); });
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
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        sendMessage();
      }
    });

    try {
      var params = new URLSearchParams(location.search);
      var linkedConversation = params.get("pv_chat");
      if (linkedConversation && /^pv_[a-z0-9_]{12,80}$/i.test(linkedConversation)) {
        setConversationId(linkedConversation);
        contactBox.classList.add("saved");
        setTimeout(function () { openPanel("chat"); }, 250);
      }
    } catch (_) {}
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", build);
  else build();
})();`;
}
