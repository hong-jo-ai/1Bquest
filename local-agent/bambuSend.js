/**
 * 뱀부 A1 LAN 출력 — 3mf를 FTPS 업로드 후 MQTT로 출력 시작 + 상태 모니터링.
 * ⚠️ 실제 출력을 시작함. 베드 비움 + 필라멘트 로드 + 사람 옆에서 첫 레이어 확인 전제.
 *
 * 실행: BAMBU_ACCESS_CODE=xxxx node bambuSend.js <file.3mf> [원격파일명.3mf]
 */
const mqtt = require("mqtt");
const ftp = require("basic-ftp");
const fs = require("fs"), path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env"), override: true });

const HOST = process.env.BAMBU_IP || "192.168.0.33";
const SN = process.env.BAMBU_SN || "03900D642927283";
const CODE = process.env.BAMBU_ACCESS_CODE;
const FILE = process.argv[2];
const REMOTE = process.argv[3] || ("pw_" + path.basename(FILE || "print.3mf").replace(/[^\w.\-]/g, "_"));
const log = (m) => console.log(`[bambu] ${m}`);

if (!CODE) { log("BAMBU_ACCESS_CODE 필요"); process.exit(1); }
if (!FILE || !fs.existsSync(FILE)) { log(`3mf 파일 필요: node bambuSend.js <file.3mf>`); process.exit(1); }

async function upload() {
  const c = new ftp.Client(15000);
  // 뱀부는 implicit FTPS(990) + 자기서명 인증서
  await c.access({ host: HOST, port: 990, user: "bblp", password: CODE, secure: "implicit", secureOptions: { rejectUnauthorized: false } });
  log(`FTPS 연결됨 → 업로드: ${REMOTE} (${(fs.statSync(FILE).size/1024).toFixed(0)}KB)`);
  await c.uploadFrom(FILE, REMOTE);
  log("✅ 업로드 완료");
  c.close();
}

function gcodeMd5() {
  try { return require("child_process").execSync(`unzip -p "${FILE}" Metadata/plate_1.gcode.md5`, { encoding: "utf8" }).trim(); }
  catch { return ""; }
}

function printCmd(client) {
  const cmd = {
    print: {
      sequence_id: "1",
      command: "project_file",
      param: "Metadata/plate_1.gcode",
      url: `file:///mnt/sdcard/${REMOTE}`,   // SD 마운트 경로(FTP 루트=SD)
      md5: gcodeMd5(),
      subtask_name: REMOTE.replace(/\.3mf$/i, ""),
      project_id: "0", profile_id: "0", task_id: "0", subtask_id: "0",
      bed_type: "auto",
      timelapse: false,
      bed_leveling: true,               // 첫 출력이라 자동 레벨링 ON
      flow_cali: false,
      vibration_cali: true,
      layer_inspect: false,
      use_ams: true,                    // AMS 장착됨 → 사용
      ams_mapping: [0],                 // 단일 필라멘트 → AMS 슬롯 0
    },
  };
  client.publish(`device/${SN}/request`, JSON.stringify(cmd));
  log(`📤 출력 명령 전송(project_file, md5=${cmd.print.md5.slice(0,8)}…). 프린터 준비→레벨링→출력.`);
}

(async () => {
  try { await upload(); }
  catch (e) { log(`❌ 업로드 실패: ${e.message}`); process.exit(1); }

  const client = mqtt.connect(`mqtts://${HOST}:8883`, {
    username: "bblp", password: CODE, rejectUnauthorized: false, reconnectPeriod: 0, connectTimeout: 8000,
  });
  let sent = false, lastState = "";
  client.on("connect", () => {
    log("MQTT 연결됨");
    client.subscribe(`device/${SN}/report`, () => {
      printCmd(client); sent = true;
      // 명령 후 상태 적극 폴링(pushall)으로 시작 여부 즉시 확인
      const poll = () => client.publish(`device/${SN}/request`, JSON.stringify({ pushing: { sequence_id: "2", command: "pushall" } }));
      setTimeout(poll, 2500); setInterval(poll, 5000);
    });
  });
  client.on("message", (t, buf) => {
    let d; try { d = JSON.parse(buf.toString()); } catch { return; }
    const p = d.print; if (!p) return;
    if (p.gcode_state && p.gcode_state !== lastState) {
      lastState = p.gcode_state;
      log(`상태 변화 → ${p.gcode_state}${p.mc_percent!==undefined?` (${p.mc_percent}%)`:""}${p.subtask_name?` [${p.subtask_name}]`:""}`);
    }
    if (p.print_error && p.print_error !== 0) log(`⚠️ print_error=${p.print_error}`);
    if (["RUNNING","PREPARE"].includes(p.gcode_state)) {
      log("🟢 출력 시작됨! 첫 레이어 베드 안착을 직접 확인하세요. (모니터링 종료)");
      setTimeout(() => { client.end(true); process.exit(0); }, 1500);
    }
  });
  client.on("error", (e) => { log(`❌ MQTT 오류: ${e.message}`); process.exit(1); });
  setTimeout(() => { if (sent) { log("명령은 보냈는데 RUNNING 확인 전 타임아웃 — A1 화면에서 상태 확인해주세요."); } client.end(true); process.exit(0); }, 30000);
})();
