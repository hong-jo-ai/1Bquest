/**
 * 뱀부 A1 LAN 연결 + 상태 읽기 테스트 (출력 명령 없음).
 * 인증: mqtts 8883, user=bblp, pass=액세스코드(BAMBU_ACCESS_CODE). 자기서명 인증서라 rejectUnauthorized=false.
 * 실행: BAMBU_ACCESS_CODE=xxxx node bambuStatus.js
 */
const mqtt = require("mqtt");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env"), override: true });

const HOST = process.env.BAMBU_IP || "192.168.0.33";
const SN = process.env.BAMBU_SN || "03900D642927283";
const CODE = process.env.BAMBU_ACCESS_CODE;
if (!CODE) { console.log("BAMBU_ACCESS_CODE 필요"); process.exit(1); }

const url = `mqtts://${HOST}:8883`;
console.log(`[bambu] 연결 시도 ${url} (user=bblp)`);
const client = mqtt.connect(url, {
  username: "bblp", password: CODE,
  rejectUnauthorized: false, reconnectPeriod: 0, connectTimeout: 8000,
});

let got = false;
const done = (code) => { try { client.end(true); } catch {} process.exit(code); };

client.on("connect", () => {
  console.log("[bambu] ✅ MQTT 인증 성공 — 연결됨");
  client.subscribe(`device/${SN}/report`, (err) => {
    if (err) { console.log("[bambu] 구독 실패:", err.message); return done(1); }
    // 전체 상태 요청
    client.publish(`device/${SN}/request`, JSON.stringify({ pushing: { sequence_id: "0", command: "pushall" } }));
    console.log("[bambu] 상태 요청(pushall) 전송 — 응답 대기...");
  });
});

client.on("message", (topic, buf) => {
  let d; try { d = JSON.parse(buf.toString()); } catch { return; }
  const p = d.print;
  if (!p) return;
  got = true;
  console.log("\n[bambu] 📋 프린터 상태:");
  if (p.nozzle_temper !== undefined) console.log(`  노즐: ${p.nozzle_temper}°C → 목표 ${p.nozzle_target_temper}°C`);
  if (p.bed_temper !== undefined)    console.log(`  베드: ${p.bed_temper}°C → 목표 ${p.bed_target_temper}°C`);
  if (p.gcode_state !== undefined)   console.log(`  상태: ${p.gcode_state}`);
  if (p.print_type !== undefined)    console.log(`  작업: ${p.print_type || "(없음)"}`);
  if (p.mc_percent !== undefined)    console.log(`  진행: ${p.mc_percent}% (남은 ${p.mc_remaining_time}분)`);
  if (p.subtask_name)                console.log(`  현재파일: ${p.subtask_name}`);
  if (p.nozzle_diameter)             console.log(`  노즐지름: ${p.nozzle_diameter}mm`);
  if (p.wifi_signal)                 console.log(`  WiFi: ${p.wifi_signal}`);
  console.log("\n[bambu] ✅ 연결·인증·상태읽기 전부 정상. (출력 명령 안 보냄)");
  done(0);
});

client.on("error", (e) => { console.log("[bambu] ❌ 연결/인증 실패:", e.message); done(1); });
setTimeout(() => { if (!got) { console.log("[bambu] ⚠️ 연결은 됐으나 상태 응답 없음(타임아웃)"); done(got ? 0 : 2); } }, 12000);
