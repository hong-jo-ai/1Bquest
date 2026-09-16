import { checkPrintAgent, printAgentToken } from "@/lib/print/token";

export const dynamic = "force-dynamic";

/**
 * GET /api/print/setup?k=<token>  → 윈도우 노트북 1회 설치 스크립트(PowerShell).
 * GET /api/print/setup?k=<token>&agent=1 → 에이전트 본체(print-agent.ps1). 갱신 시 노트북이 매 기동마다 다시 받는다.
 *
 * 노트북(desktop-n7m99lt, Tailscale)엔 인바운드 포트가 없어 밀어넣을 수 없다 → 노트북이 당겨가는 구조.
 * 설치: PowerShell 에서 `irm "<이 URL>" | iex` 한 줄.
 */
function agentScript(base: string, token: string): string {
  return `# Paulvice 라벨 인쇄 에이전트 — 대시보드 큐를 폴링해 PDF 라벨을 라벨프린터로 조용히 인쇄한다.
$ErrorActionPreference = "Continue"
$Base = "${base}"
$Token = "${token}"
$Dir = Join-Path $env:LOCALAPPDATA "PaulvicePrint"
$Sumatra = Join-Path $Dir "SumatraPDF.exe"
$Cfg = Join-Path $Dir "config.json"
$Log = Join-Path $Dir "agent.log"
function L($m) { $line = "[" + (Get-Date -Format "yyyy-MM-dd HH:mm:ss") + "] " + $m; Add-Content -Path $Log -Value $line -Encoding UTF8; Write-Host $line }
$conf = Get-Content $Cfg -Raw | ConvertFrom-Json
$Printer = $conf.printer
$AgentVer = "2"
$H = @{ "x-print-token" = $Token }
function Ack($id, $body) { try { Invoke-RestMethod -Method Post -Uri "$Base/api/print/jobs/$id/ack" -Headers $H -ContentType "application/json; charset=utf-8" -Body ([System.Text.Encoding]::UTF8.GetBytes(($body | ConvertTo-Json -Depth 4))) -TimeoutSec 30 | Out-Null } catch { L "ack 실패 $id : $($_.Exception.Message)" } }
L "에이전트 v$AgentVer 시작 · 프린터=$Printer"
while ($true) {
  try {
    $r = Invoke-RestMethod -Uri "$Base/api/print/jobs?v=$AgentVer&host=$env:COMPUTERNAME" -Headers $H -TimeoutSec 30
    # 원격 제어: 재시작 요청이면 최신 스크립트를 받아 새 프로세스로 띄우고 종료
    if ($r.control -and $r.control.restart) {
      L "재시작 요청 수신 → 스크립트 갱신 후 재기동"
      $me = $MyInvocation.MyCommand.Path
      try { Invoke-WebRequest -Uri "$Base/api/print/setup?k=$Token&agent=1" -OutFile ($me + ".new") -TimeoutSec 60; Move-Item ($me + ".new") $me -Force } catch { L "갱신 실패: $($_.Exception.Message)" }
      Start-Process -FilePath "powershell.exe" -ArgumentList @("-NoProfile","-ExecutionPolicy","Bypass","-WindowStyle","Hidden","-File",('"' + $me + '"')) -WindowStyle Hidden
      exit 0
    }
    foreach ($j in $r.jobs) {
      if ($j.kind -eq "cmd") {
        # 원격 명령(진단·설정용). 출력은 ack 로 돌려보낸다.
        try { $out = (Invoke-Expression $j.cmd 2>&1 | Out-String); Ack $j.id @{ status = "printed"; output = $out.Substring(0, [Math]::Min($out.Length, 20000)) }; L "cmd 완료 $($j.id)" }
        catch { Ack $j.id @{ status = "error"; error = $_.Exception.Message }; L "cmd 실패 $($j.id): $($_.Exception.Message)" }
        continue
      }
      $target = if ($j.printer) { $j.printer } else { $Printer }
      $pdf = Join-Path $Dir ("job_" + $j.id + ".pdf")
      try {
        Invoke-WebRequest -Uri $j.url -OutFile $pdf -TimeoutSec 60
        # -exit-when-done 이 없으면 SumatraPDF 가 인쇄 후 떠 있어 -Wait 가 영원히 멈춘다(2026-09-15 첫 테스트에서 정지).
        $p = Start-Process -FilePath $Sumatra -ArgumentList @("-print-to", ('"' + $target + '"'), "-silent", "-exit-when-done", "-print-settings", '"noscale"', ('"' + $pdf + '"')) -PassThru -WindowStyle Hidden
        if (-not $p.WaitForExit(120000)) { try { $p.Kill() } catch {}; throw "SumatraPDF 120초 초과 — 강제 종료" }
        if ($p.ExitCode -ne 0) { throw "SumatraPDF exit $($p.ExitCode)" }
        Ack $j.id @{ status = "printed"; printer = $target }
        L "인쇄 완료 $($j.id) $($j.label) → $target"
      } catch {
        $msg = $_.Exception.Message
        Ack $j.id @{ status = "error"; error = $msg; printer = $target }
        L "인쇄 실패 $($j.id): $msg"
      } finally { Remove-Item $pdf -ErrorAction SilentlyContinue }
    }
  } catch { L "폴링 오류: $($_.Exception.Message)" }
  Start-Sleep -Seconds 20
}
`;
}

function setupScript(base: string, token: string): string {
  return `# Paulvice 라벨 인쇄 에이전트 1회 설치 (Windows PowerShell)
$ErrorActionPreference = "Stop"
$Base = "${base}"
$Token = "${token}"
$Dir = Join-Path $env:LOCALAPPDATA "PaulvicePrint"
New-Item -ItemType Directory -Force -Path $Dir | Out-Null
Write-Host "1/4 SumatraPDF(무설치 PDF 인쇄기) 내려받기..."
$Sumatra = Join-Path $Dir "SumatraPDF.exe"
if (-not (Test-Path $Sumatra)) { Invoke-WebRequest -Uri "https://www.sumatrapdfreader.org/dl/rel/3.5.2/SumatraPDF-3.5.2-64.exe" -OutFile $Sumatra }
Write-Host "2/4 프린터 선택"
$printers = Get-Printer | Select-Object -ExpandProperty Name
$i = 0; foreach ($p in $printers) { Write-Host ("  [" + $i + "] " + $p); $i++ }
$guess = ($printers | Where-Object { $_ -match "PS100|PS-100|Label|라벨|송장" } | Select-Object -First 1)
$defaultIdx = if ($guess) { [array]::IndexOf($printers, $guess) } else { 0 }
$sel = Read-Host ("라벨프린터 번호 입력 (Enter = " + $defaultIdx + " " + $printers[$defaultIdx] + ")")
if ([string]::IsNullOrWhiteSpace($sel)) { $sel = $defaultIdx }
$Printer = $printers[[int]$sel]
@{ printer = $Printer; base = $Base } | ConvertTo-Json | Set-Content -Path (Join-Path $Dir "config.json") -Encoding UTF8
Write-Host ("   선택: " + $Printer)
Write-Host "3/4 에이전트 스크립트 저장 + 로그인 시 자동 시작 등록"
$Agent = Join-Path $Dir "print-agent.ps1"
Invoke-WebRequest -Uri ("$Base/api/print/setup?k=" + $Token + "&agent=1") -OutFile $Agent
# 관리자 권한 없이도 되게: 시작프로그램 폴더에 창 없이 띄우는 실행기(.vbs)를 둔다.
# (예약작업 Register-ScheduledTask 는 이 노트북에서 '액세스 거부' — 2026-09-15 실측)
$Launcher = Join-Path $Dir "start-agent.vbs"
# VBScript 문자열 안의 따옴표는 "" 로 이스케이프 — 첫 배포는 """ 로 써서 구문오류 → 에이전트가 아예 안 떴다(2026-09-15)
$vbs = 'CreateObject("WScript.Shell").Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""' + $Agent + '""", 0, False'
Set-Content -Path $Launcher -Value $vbs -Encoding ASCII
$Startup = [Environment]::GetFolderPath("Startup")
Copy-Item $Launcher (Join-Path $Startup "PaulvicePrintAgent.vbs") -Force
# 이미 돌고 있는 에이전트가 있으면 정리하고 지금 바로 시작(런처를 거치지 않고 직접 — 런처는 로그인 시 자동시작용)
Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe'" | Where-Object { $_.CommandLine -like "*print-agent.ps1*" } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Get-Process -Name "SumatraPDF" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Process -FilePath "powershell.exe" -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-File", ('"' + $Agent + '"')) -WindowStyle Hidden
Start-Sleep -Seconds 3
$running = Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe'" | Where-Object { $_.CommandLine -like "*print-agent.ps1*" }
if ($running) { Write-Host "   에이전트 실행 중 (PID $($running.ProcessId))" } else {
  Write-Host "   에이전트가 바로 종료됨 — 원인을 확인합니다..."
  # ⚠️ 문법 오류면 스크립트가 한 줄도 실행되지 않아 agent.log 에 아무것도 안 남는다.
  #    2026-09-16 에 인코딩 깨짐(BOM 없음 → CP949 해석)으로 정확히 이 상태가 됐는데,
  #    "바로 종료됨" 한 줄뿐이라 원인을 찾는 데 오래 걸렸다. 저장 직후 파싱해서 바로 알려준다.
  $perr = $null
  try { [void][System.Management.Automation.Language.Parser]::ParseFile($Agent, [ref]$null, [ref]$perr) } catch {}
  if ($perr -and $perr.Count -gt 0) {
    Write-Host ("   [문법 오류] " + $perr[0].Message)
    Write-Host ("   위치: " + $perr[0].Extent.StartLineNumber + "행 — 스크립트 인코딩 문제일 수 있습니다(설치를 다시 실행해 보세요).")
  } else {
    Write-Host "   문법은 정상입니다 — agent.log 를 확인하세요."
  }
}
Write-Host "4/4 설치 완료. 에이전트가 백그라운드에서 20초마다 인쇄 대기열을 확인합니다(로그인 시 자동 시작)."
Write-Host ("로그: " + (Join-Path $Dir "agent.log"))
`;
}

export async function GET(req: Request) {
  if (!checkPrintAgent(req)) return new Response("unauthorized", { status: 401 });
  const url = new URL(req.url);
  const base = (process.env.PRINT_AGENT_BASE_URL || `${url.protocol}//${url.host}`).replace(/\/$/, "");
  const token = printAgentToken();
  const isAgent = !!url.searchParams.get("agent");
  const body = isAgent ? agentScript(base, token) : setupScript(base, token);
  // 🔴 두 응답의 BOM 요구가 **정반대**다. 하나로 통일하면 반드시 한쪽이 깨진다.
  //  · 설치 스크립트: `irm | iex` 로 **파이프 실행**된다. BOM 이 있으면 첫 줄을 (U+FEFF 가 앞에 붙은) "#…" 명령으로
  //    오인해 CommandNotFound 를 낸다(2026-09-15 실측) → BOM 금지. (U+FEFF 가 첫 글자로 붙는 탓)
  //  · 에이전트 스크립트: `-OutFile` 로 **파일 저장 후 -File 로 실행**된다. BOM 이 없으면
  //    Windows PowerShell 5.1 이 .ps1 을 시스템 코드페이지(한국어=CP949)로 읽어 UTF-8 한글이
  //    깨지고, 깨진 바이트가 따옴표 짝을 무너뜨려 **ParserError 로 아예 뜨지 못한다** → BOM 필수.
  //    2026-09-16 실측: `AmpersandNotAllowed` — 50행 `L "폴링 오류: …"` 의 한글이 깨져 문자열이
  //    안 닫히자 23행 URL 의 `&agent=1` 이 문자열 밖으로 노출됐다. 시작 로그조차 없어 진단이 오래 걸렸다.
  //    (어제까지 멀쩡했던 건 그 버전에 재시작 블록이 없어 우연히 파싱이 통과했기 때문이다.)
  // ⚠️ 리터럴 BOM 을 소스에 박지 말 것 — 눈에 안 보여서 편집·복사 중 조용히 사라진다(이번 버그와 같은 계열).
  const payload = isAgent ? String.fromCharCode(0xfeff) + body : body;
  return new Response(payload, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
}
