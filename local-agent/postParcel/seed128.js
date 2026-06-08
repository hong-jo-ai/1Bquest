/**
 * Pure-JS SEED-128 (ECB) — 우체국 계약소포 OpenAPI 보안키 암호화.
 *
 * 우체국 매뉴얼: regData = "key=val&key=val..." 평문(UTF-8)을 보안키로 SEED-128(ECB)
 * 암호화한 뒤 소문자 hex 로 인코딩하여 전송. (제로패딩, IV 없음)
 *
 * Node 24/OpenSSL 3.5 는 SEED 를 기본 제공하지 않으므로(legacy provider) KISA 레퍼런스를
 * 그대로 포팅. 우체국 매뉴얼의 골든 테스트벡터로 검증됨:
 *   getEncryptData("1234567890abcdefghijkl", "123abc가나다")
 *     === "8522ad534acc61cb88090b7e62c5183b"   (UTF-8)
 * (검증: postParcel/seed128.test.js)
 *
 * ENDIAN=BIG (Java 기본 / PHP 샘플 ENDIAN=true) → EndianChange 미적용.
 */
const { SS0, SS1, SS2, SS3, KC } = require("./seedTables");

const u32 = (x) => x >>> 0;
// SEED G(=ss) 함수: 4개 S-box XOR
const G = (x) =>
  u32(SS0[x & 0xff] ^ SS1[(x >>> 8) & 0xff] ^ SS2[(x >>> 16) & 0xff] ^ SS3[(x >>> 24) & 0xff]);

// 16바이트 사용자키 → 32개 라운드키
function seedRoundKey(userKey16) {
  let A = u32((userKey16[0] << 24) | (userKey16[1] << 16) | (userKey16[2] << 8) | userKey16[3]);
  let B = u32((userKey16[4] << 24) | (userKey16[5] << 16) | (userKey16[6] << 8) | userKey16[7]);
  let C = u32((userKey16[8] << 24) | (userKey16[9] << 16) | (userKey16[10] << 8) | userKey16[11]);
  let D = u32((userKey16[12] << 24) | (userKey16[13] << 16) | (userKey16[14] << 8) | userKey16[15]);
  const rk = new Array(32);
  rk[0] = G(u32(A + C - KC[0]));
  rk[1] = G(u32(B - D + KC[0]));
  let idx = 2;
  for (let z = 1; z <= 15; z++) {
    if (z % 2 === 1) {
      // EncRoundKeyUpdate0: A,B 갱신
      const t = A;
      A = u32(((A >>> 8) & 0x00ffffff) ^ u32(B << 24));
      B = u32(((B >>> 8) & 0x00ffffff) ^ u32(t << 24));
    } else {
      // EncRoundKeyUpdate1: C,D 갱신
      const t = C;
      C = u32(u32(C << 8) ^ ((D >>> 24) & 0xff));
      D = u32(u32(D << 8) ^ ((t >>> 24) & 0xff));
    }
    rk[idx++] = G(u32(A + C - KC[z]));
    rk[idx++] = G(u32(B + KC[z] - D));
  }
  return rk;
}

// SEED F-함수 (오른쪽 절반 + 라운드키 → 왼쪽 절반에 XOR할 값)
function F(R0, R1, K0, K1) {
  let T0 = u32(R0 ^ K0);
  let T1 = u32(R1 ^ K1);
  T1 = u32(T1 ^ T0);
  T1 = G(T1);
  T0 = u32(T0 + T1);
  T0 = G(T0);
  T1 = u32(T1 + T0);
  T1 = G(T1);
  T0 = u32(T0 + T1);
  return [T0, T1];
}

function seedEncryptBlock(block16, rk) {
  let L0 = u32((block16[0] << 24) | (block16[1] << 16) | (block16[2] << 8) | block16[3]);
  let L1 = u32((block16[4] << 24) | (block16[5] << 16) | (block16[6] << 8) | block16[7]);
  let R0 = u32((block16[8] << 24) | (block16[9] << 16) | (block16[10] << 8) | block16[11]);
  let R1 = u32((block16[12] << 24) | (block16[13] << 16) | (block16[14] << 8) | block16[15]);
  let n = 0;
  for (let round = 0; round < 16; round++) {
    const K0 = rk[n++], K1 = rk[n++];
    if (round % 2 === 0) {
      const [f0, f1] = F(R0, R1, K0, K1);
      L0 = u32(L0 ^ f0); L1 = u32(L1 ^ f1);
    } else {
      const [f0, f1] = F(L0, L1, K0, K1);
      R0 = u32(R0 ^ f0); R1 = u32(R1 ^ f1);
    }
  }
  // 출력 순서: R0 R1 L0 L1 (16라운드 후 좌우 교환)
  const out = Buffer.alloc(16);
  out.writeUInt32BE(R0, 0); out.writeUInt32BE(R1, 4);
  out.writeUInt32BE(L0, 8); out.writeUInt32BE(L1, 12);
  return out;
}

/**
 * 평문을 보안키로 SEED-128(ECB, 제로패딩) 암호화하여 소문자 hex 반환.
 * @param {string} seedKey 보안키 (UTF-8; 앞 16바이트만 키로 사용)
 * @param {string} plain   평문 ("k=v&k=v..."; UTF-8 인코딩)
 * @returns {string} 암호문 hex
 */
function getEncryptData(seedKey, plain) {
  const keyBytes = Buffer.from(String(seedKey), "utf8");
  const key16 = Buffer.alloc(16);
  keyBytes.copy(key16, 0, 0, 16);
  const rk = seedRoundKey(key16);
  const data = Buffer.from(String(plain), "utf8");
  const padLen = Math.ceil(data.length / 16) * 16 || 16;
  const padded = Buffer.alloc(padLen, 0); // 제로패딩
  data.copy(padded);
  const chunks = [];
  for (let i = 0; i < padded.length; i += 16) {
    chunks.push(seedEncryptBlock(padded.subarray(i, i + 16), rk));
  }
  return Buffer.concat(chunks).toString("hex");
}

module.exports = { getEncryptData, seedRoundKey, seedEncryptBlock };
