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

  function injectStyles() {
    var css = ""
      + ".pv-chat-root{position:fixed;right:22px;bottom:22px;z-index:2147483000;font-family:Arial,'Apple SD Gothic Neo','Noto Sans KR',sans-serif;color:#161616;letter-spacing:0}"
      + ".pv-chat-button{position:relative;width:76px;height:66px;border:1px solid rgba(255,255,255,.55);border-radius:50% 50% 48% 50%;background:linear-gradient(145deg,#d51f37 0%,#a30f23 64%,#82091a 100%);color:#fff;box-shadow:0 18px 44px rgba(75,13,20,.28),0 5px 14px rgba(0,0,0,.18),inset 0 1px 0 rgba(255,255,255,.22);cursor:pointer;display:flex;align-items:center;justify-content:center;line-height:1;transition:transform .18s ease,box-shadow .18s ease,filter .18s ease}"
      + ".pv-chat-button:before{content:'';position:absolute;left:6px;bottom:-5px;width:20px;height:20px;background:linear-gradient(145deg,#b91429 0%,#8d0a1c 100%);border-left:1px solid rgba(255,255,255,.35);border-bottom:1px solid rgba(255,255,255,.28);border-radius:0 0 0 18px;transform:rotate(-23deg);box-shadow:0 8px 15px rgba(75,13,20,.2)}"
      + ".pv-chat-button:after{content:'';position:absolute;inset:6px 8px 8px 8px;border-radius:999px;background:radial-gradient(circle at 34% 24%,rgba(255,255,255,.28),rgba(255,255,255,0) 38%);pointer-events:none}"
      + ".pv-chat-button:hover{transform:translateY(-2px);filter:saturate(1.04);box-shadow:0 22px 50px rgba(75,13,20,.32),0 7px 17px rgba(0,0,0,.2),inset 0 1px 0 rgba(255,255,255,.24)}"
      + ".pv-chat-mark{position:relative;z-index:1;width:44px;height:44px;border:1.6px solid rgba(255,255,255,.9);border-radius:999px;display:flex;align-items:center;justify-content:center;font-family:Georgia,'Times New Roman',serif;font-size:17px;font-weight:700;letter-spacing:.5px;text-shadow:0 1px 2px rgba(0,0,0,.18);box-shadow:inset 0 0 0 1px rgba(255,255,255,.22)}"
      + ".pv-chat-mark:before{content:'';position:absolute;inset:4px;border:1px solid rgba(232,204,148,.72);border-radius:999px}.pv-chat-mark span{position:relative;z-index:1}"
      + ".pv-chat-panel{display:none;width:374px;max-width:calc(100vw - 32px);height:590px;max-height:calc(100vh - 104px);background:#fbfaf7;border:1px solid #d8d2c8;border-radius:8px;box-shadow:0 24px 70px rgba(17,17,17,.22);overflow:hidden}"
      + ".pv-chat-panel.open{display:flex;flex-direction:column}"
      + ".pv-chat-head{height:72px;background:#141414;color:#fff;display:flex;align-items:center;justify-content:space-between;padding:0 18px;border-bottom:1px solid rgba(255,255,255,.08)}"
      + ".pv-chat-kicker{font-size:10px;color:#b9b1a5;margin-bottom:5px}.pv-chat-title{font-size:16px;font-weight:700}.pv-chat-sub{font-size:11px;color:#d7d0c6;margin-top:3px}.pv-chat-close{width:30px;height:30px;border:1px solid rgba(255,255,255,.16);border-radius:999px;background:transparent;color:#fff;font-size:20px;line-height:1;cursor:pointer}"
      + ".pv-chat-contact{padding:16px 16px 14px;border-bottom:1px solid #e6dfd5;background:#f6f2ea;display:grid;gap:9px}.pv-chat-contact.saved{display:none}"
      + ".pv-chat-help{font-size:11px;line-height:1.45;color:#756c61;background:#fffaf2;border:1px solid #e3d8c8;border-radius:6px;padding:9px 10px}"
      + ".pv-chat-error{display:none;font-size:11px;line-height:1.45;color:#9f1239;background:#fff1f2;border:1px solid #fecdd3;border-radius:6px;padding:8px 10px}.pv-chat-error.show{display:block}"
      + ".pv-chat-input{width:100%;box-sizing:border-box;border:1px solid #d8d0c4;border-radius:6px;background:#fffdf9;padding:10px 11px;font-size:13px;outline:none;color:#171717}.pv-chat-input:focus{border-color:#141414;box-shadow:0 0 0 2px rgba(20,20,20,.06)}"
      + ".pv-chat-save{height:38px;border:0;border-radius:6px;background:#141414;color:#fff;font-weight:700;cursor:pointer;font-size:13px;box-shadow:inset 0 1px 0 rgba(255,255,255,.12)}"
      + ".pv-chat-messages{flex:1;overflow:auto;padding:16px;background:#fbfaf7;display:flex;flex-direction:column;gap:10px}"
      + ".pv-chat-bubble{max-width:82%;padding:10px 12px;border-radius:8px;font-size:13px;line-height:1.5;white-space:pre-wrap;word-break:break-word}.pv-chat-bubble.in{align-self:flex-start;background:#fffdf9;border:1px solid #ded6ca;color:#1f2933}.pv-chat-bubble.out{align-self:flex-end;background:#141414;color:#fff}"
      + ".pv-chat-empty{font-size:12px;color:#625b52;background:#fffdf9;border:1px solid #e2dbd1;border-radius:8px;padding:13px;line-height:1.55}"
      + ".pv-chat-compose{border-top:1px solid #e1dbd1;padding:11px;background:#fffdf9;display:flex;gap:8px}.pv-chat-text{flex:1;min-height:42px;max-height:92px;resize:none;border:1px solid #d8d0c4;border-radius:8px;background:#fff;padding:10px 11px;font-size:13px;outline:none;color:#171717}.pv-chat-text:focus{border-color:#141414;box-shadow:0 0 0 2px rgba(20,20,20,.06)}.pv-chat-send{width:58px;border:0;border-radius:8px;background:#141414;color:#fff;font-weight:700;cursor:pointer;font-size:13px}"
      + "@media(max-width:480px){.pv-chat-root{right:14px;bottom:14px}.pv-chat-panel{width:calc(100vw - 24px);height:calc(100vh - 84px);border-radius:8px}.pv-chat-head{height:68px;padding:0 16px}.pv-chat-contact{padding:14px}.pv-chat-messages{padding:14px}.pv-chat-button{width:68px;height:58px}.pv-chat-mark{width:38px;height:38px;font-size:15px}}";
    document.head.appendChild(el("style", { text: css }));
  }

  function renderMessages(box, messages) {
    box.innerHTML = "";
    if (!messages || messages.length === 0) {
      box.appendChild(el("div", { class: "pv-chat-empty", text: "제품, 배송, AS 문의를 남겨주시면 확인 후 순서대로 답변드리겠습니다. 영업시간 외 문의는 답변이 늦을 수 있습니다." }));
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
    if (!id) return;
    api("/api/cs/webchat/messages?conversationId=" + encodeURIComponent(id), { method: "GET" })
      .then(function (json) { if (json.ok) renderMessages(box, json.messages || []); })
      .catch(function () {});
  }

  function build() {
    injectStyles();
    var root = el("div", { class: "pv-chat-root" });
    var button = el("button", { class: "pv-chat-button", type: "button", "aria-label": config.brandName + " 상담 열기" }, [
      el("span", { class: "pv-chat-mark", "aria-hidden": "true" }, [
        el("span", { text: "PL" })
      ])
    ]);
    var panel = el("div", { class: "pv-chat-panel" });
    var messages = el("div", { class: "pv-chat-messages" });
    var contact = getContact();
    var hasSavedContact = contact.name && contact.phone && contact.phone.replace(/\\D/g, "").length >= 10;
    var contactBox = el("div", { class: "pv-chat-contact" + (hasSavedContact ? " saved" : "") });
    var helpText = el("div", { class: "pv-chat-help", text: "답변 알림을 문자로 보내드리기 위해 이름과 연락처가 필요합니다. 화면을 떠나도 링크로 이어서 상담하실 수 있습니다." });
    var errorText = el("div", { class: "pv-chat-error", text: "" });
    var nameInput = el("input", { class: "pv-chat-input", placeholder: "이름", value: contact.name || "" });
    var phoneInput = el("input", { class: "pv-chat-input", placeholder: "연락처", value: contact.phone || "" });
    var emailInput = el("input", { class: "pv-chat-input", placeholder: "이메일(선택)", value: contact.email || "" });
    var saveButton = el("button", { class: "pv-chat-save", type: "button", text: "상담 시작" });
    var textarea = el("textarea", { class: "pv-chat-text", placeholder: "문의 내용을 입력하세요" });
    var send = el("button", { class: "pv-chat-send", type: "button", text: "전송" });

    contactBox.appendChild(helpText);
    contactBox.appendChild(errorText);
    contactBox.appendChild(nameInput);
    contactBox.appendChild(phoneInput);
    contactBox.appendChild(emailInput);
    contactBox.appendChild(saveButton);

    panel.appendChild(el("div", { class: "pv-chat-head" }, [
      el("div", {}, [
        el("div", { class: "pv-chat-kicker", text: "PRIVATE CLIENT SERVICE" }),
        el("div", { class: "pv-chat-title", text: config.brandName + " 상담" }),
        el("div", { class: "pv-chat-sub", text: "상담 내역은 고객 응대를 위해 안전하게 저장됩니다." })
      ]),
      el("button", { class: "pv-chat-close", type: "button", text: "×" })
    ]));
    panel.appendChild(contactBox);
    panel.appendChild(messages);
    panel.appendChild(el("div", { class: "pv-chat-compose" }, [textarea, send]));
    root.appendChild(panel);
    root.appendChild(button);
    document.body.appendChild(root);

    function openPanel() {
      isOpen = true;
      panel.classList.add("open");
      button.style.display = "none";
      var contact = getContact();
      if (getConversationId()) {
        loadMessages(messages);
      } else if (contact.name && contact.phone && contact.phone.replace(/\\D/g, "").length >= 10) {
        ensureSession(contact).then(function () { loadMessages(messages); });
      }
      clearInterval(pollTimer);
      pollTimer = setInterval(function () { if (isOpen) loadMessages(messages); }, 5000);
    }

    function closePanel() {
      isOpen = false;
      panel.classList.remove("open");
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

    button.addEventListener("click", openPanel);
    panel.querySelector(".pv-chat-close").addEventListener("click", closePanel);
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
        setTimeout(openPanel, 250);
      }
    } catch (_) {}
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", build);
  else build();
})();`;
}
