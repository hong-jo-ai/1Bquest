/**
 * SEED-128 골든 벡터 검증 (우체국 매뉴얼 p.2 예시).
 * 실행: node local-agent/postParcel/seed128.test.js
 */
const assert = require("assert");
const { getEncryptData } = require("./seed128");

// 매뉴얼 제공 벡터 (UTF-8)
const got = getEncryptData("1234567890abcdefghijkl", "123abc가나다");
const want = "8522ad534acc61cb88090b7e62c5183b";

assert.strictEqual(got, want, `SEED-128 mismatch:\n  got : ${got}\n  want: ${want}`);
console.log("✅ SEED-128 golden vector OK:", got);

// 16바이트 경계 패딩 한 블록 확인 (회귀용)
const enc2 = getEncryptData("1234567890abcdefghijkl", "custNo=0001234567&reqType=1");
assert.match(enc2, /^[0-9a-f]+$/);
assert.strictEqual(enc2.length % 32, 0, "암호문은 16바이트(32 hex) 블록 배수여야 함");
console.log("✅ regData 암호화 형식 OK (len", enc2.length, "hex)");
