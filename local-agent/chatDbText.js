/**
 * chat.db 메시지 본문 읽기 — `text` 컬럼만 보면 안 되는 이유.
 *
 * 2026-08-27 무렵부터 macOS Messages 가 수신 SMS 본문을 `text` 가 아니라
 * `attributedBody`(NSAttributedString typedstream BLOB)에 넣고 `text` 는 NULL 로 둔다.
 * 실측(2026-09-10): 8/27 이후 수신 574건 중 **521건이 text=NULL**.
 * 그동안 `text` 만 읽던 자동화가 전부 조용히 눈이 멀었다 —
 * 무통장 자동 입금확인·우리카드 수집·AS 입금감시·마켓 로그인 인증코드.
 * 에러가 안 나고 "새 메시지 0건"으로 보여서 워치독에도 안 걸렸다.
 *
 * 사용: SELECT 에 text 와 attributedBody 를 함께 넣고 messageBody(row) 로 본문을 꺼낸다.
 *       SQL 에서 본문으로 거르려면 bodyLike('입금') 을 WHERE 에 붙인다.
 */

const FFFD = "�"; // utf8 로 못 읽은 아카이브 바이트

/** SQL WHERE 조각 — text 든 attributedBody 든 해당 문자열을 포함하는 행. */
function bodyLike(term) {
  const hex = Buffer.from(term, "utf8").toString("hex").toUpperCase();
  return `(text LIKE '%${term}%' OR instr(hex(attributedBody), '${hex}') > 0)`;
}

/**
 * typedstream BLOB 에서 사람이 읽는 본문만 뽑아낸다.
 *
 * ⚠️ 반드시 **바이트 단위**로 파싱한다. utf8 로 먼저 디코딩해 놓고 문자열로 자르면
 * 길이 프리픽스가 깨져서(0x81 → U+FFFD) 본문 앞에 `=\x01` 같은 쓰레기가 남는다.
 * 길이가 127 초과인 긴 SMS 에서만 재현되는 함정 — 짧은 문자로 테스트하면 안 걸린다.
 */
function fromAttributedBody(blob) {
  if (!blob) return "";
  // node:sqlite 는 BLOB 을 Uint8Array 로 준다(Buffer 아님) — String() 하면 바이트가
  // 콤마로 이어진 쓰레기가 나온다. 반드시 Buffer 로 감쌀 것.
  const buf =
    Buffer.isBuffer(blob) ? blob
      : ArrayBuffer.isView(blob) ? Buffer.from(blob.buffer, blob.byteOffset, blob.byteLength)
      : Buffer.from(String(blob), "binary");

  // 마지막 클래스명(NSString/NSMutableString) 뒤부터가 문자열 레코드다.
  let at = Math.max(buf.lastIndexOf("NSMutableString"), buf.lastIndexOf("NSString"));
  if (at < 0) at = 0;

  // `+`(0x2B) 타입마커 → 길이 → 본문 바이트.
  const plus = buf.indexOf(0x2b, at);
  if (plus < 0) return "";
  let i = plus + 1;
  let len;
  if (buf[i] === 0x81) { len = buf.readUInt16LE(i + 1); i += 3; }  // 128 이상
  else { len = buf[i]; i += 1; }
  if (!Number.isFinite(len) || len <= 0) return "";

  return buf.subarray(i, i + len).toString("utf8").replace(/[ \t]+/g, " ").trim();
}

/** 행에서 본문을 꺼낸다. text 가 있으면 그대로, 없으면 attributedBody 에서 복원. */
function messageBody(row) {
  if (!row) return "";
  if (row.text) return String(row.text);
  return fromAttributedBody(row.attributedBody);
}

module.exports = { messageBody, fromAttributedBody, bodyLike };
