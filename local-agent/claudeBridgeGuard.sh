#!/bin/bash
# Claude 브리지 PreToolUse 가드 (Phase2 = 쓰기·실행 허용 + 확인 게이트).
# 파일수정(Edit/Write)은 허용. 발송·배포·삭제·DB쓰기·동기화실행 등 되돌릴 수 없거나
# 외부로 나가는 행동은 차단 대신 텔레그램으로 사장님께 "예/아니오" 확인을 받는다.
#   확인 헬퍼(claudeBridgeConfirm.js): 승인 exit 0 → 허용 / 거부·타임아웃 exit 1 → 차단(exit 2).
# 입력: stdin JSON { tool_name, tool_input:{command,...} }.
input=$(cat)
DIR="$(cd "$(dirname "$0")" && pwd)"
NODE="${CLAUDE_BRIDGE_NODE:-$(command -v node)}"
tool=$(printf '%s' "$input" | /usr/bin/python3 -c "import sys,json;print(json.load(sys.stdin).get('tool_name',''))" 2>/dev/null)

# 파일수정 도구는 Phase2에서 허용 (코드 작업 가능)
case "$tool" in
  Edit|Write|NotebookEdit|MultiEdit)
    exit 0 ;;
esac

if [ "$tool" = "Bash" ]; then
  cmd=$(printf '%s' "$input" | /usr/bin/python3 -c "import sys,json;print(json.load(sys.stdin).get('tool_input',{}).get('command',''))" 2>/dev/null)
  # 되돌릴 수 없거나 외부로 나가는 행동 → 텔레그램 확인 게이트
  if printf '%s' "$cmd" | grep -qiE "git +(push|commit|reset +--hard|checkout|rebase|merge)|vercel|deploy|npm +(run +)?(deploy|publish)|rm +-rf|sudo |launchctl|curl[^|]*-X *(POST|PUT|PATCH|DELETE)|curl[^|]*-d |wget |node +[^ ]*(Sync|Dispatch|Outbound|Process|register|kakao|build[Pp]ost|Invoice|csAction|Reply|dutyFree)|sendMessage|sendDocument|register(Single|Rows|Return|Outbound)|\.upsert\(|\.insert\(|\.update\(|\.delete\(|drop +table|truncate|psql"; then
    "$NODE" "$DIR/claudeBridgeConfirm.js" "$tool: $cmd"
    if [ $? -eq 0 ]; then
      exit 0
    else
      echo "BLOCKED: 사장님이 승인하지 않아 취소되었습니다(또는 응답 시간 초과). 이 작업은 수행하지 마세요." >&2
      exit 2
    fi
  fi
fi
exit 0
