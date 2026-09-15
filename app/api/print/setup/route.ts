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
L "에이전트 시작 · 프린터=$Printer"
while ($true) {
  try {
    $r = Invoke-RestMethod -Uri "$Base/api/print/jobs" -Headers @{ "x-print-token" = $Token } -TimeoutSec 30
    foreach ($j in $r.jobs) {
      $target = if ($j.printer) { $j.printer } else { $Printer }
      $pdf = Join-Path $Dir ("job_" + $j.id + ".pdf")
      try {
        Invoke-WebRequest -Uri $j.url -OutFile $pdf -TimeoutSec 60
        $p = Start-Process -FilePath $Sumatra -ArgumentList @("-print-to", ('"' + $target + '"'), "-silent", "-print-settings", '"noscale"', ('"' + $pdf + '"')) -PassThru -Wait -WindowStyle Hidden
        if ($p.ExitCode -ne 0) { throw "SumatraPDF exit $($p.ExitCode)" }
        Invoke-RestMethod -Method Post -Uri "$Base/api/print/jobs/$($j.id)/ack" -Headers @{ "x-print-token" = $Token } -ContentType "application/json" -Body (@{ status = "printed"; printer = $target } | ConvertTo-Json) | Out-Null
        L "인쇄 완료 $($j.id) $($j.label) → $target"
      } catch {
        $msg = $_.Exception.Message
        Invoke-RestMethod -Method Post -Uri "$Base/api/print/jobs/$($j.id)/ack" -Headers @{ "x-print-token" = $Token } -ContentType "application/json" -Body (@{ status = "error"; error = $msg; printer = $target } | ConvertTo-Json) | Out-Null
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
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument ('-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $Agent + '"')
$trigger = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -StartWhenAvailable
Register-ScheduledTask -TaskName "PaulvicePrintAgent" -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null
Start-ScheduledTask -TaskName "PaulvicePrintAgent"
Write-Host "4/4 설치 완료. 에이전트가 백그라운드에서 20초마다 인쇄 대기열을 확인합니다."
Write-Host ("로그: " + (Join-Path $Dir "agent.log"))
`;
}

export async function GET(req: Request) {
  if (!checkPrintAgent(req)) return new Response("unauthorized", { status: 401 });
  const url = new URL(req.url);
  const base = (process.env.PRINT_AGENT_BASE_URL || `${url.protocol}//${url.host}`).replace(/\/$/, "");
  const token = printAgentToken();
  const body = url.searchParams.get("agent") ? agentScript(base, token) : setupScript(base, token);
  // UTF-8 BOM — 한글이 들어간 PowerShell 스크립트를 Windows 가 올바로 읽게
  return new Response("﻿" + body, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
}
