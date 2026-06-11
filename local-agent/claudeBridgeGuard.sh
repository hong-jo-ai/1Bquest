#!/bin/bash
# Claude 브리지 PreToolUse 가드 (Phase1 = 읽기/조회 전용).
# 발송·배포·삭제·쓰기·외부호출 등 되돌릴 수 없거나 외부로 나가는 행동을 차단.
# 입력: stdin JSON { tool_name, tool_input:{command,...} }. 차단 시 exit 2 + stderr 사유.
input=$(cat)
tool=$(printf '%s' "$input" | /usr/bin/python3 -c "import sys,json;print(json.load(sys.stdin).get('tool_name',''))" 2>/dev/null)

# 쓰기 도구는 Phase1에서 전면 차단
case "$tool" in
  Edit|Write|NotebookEdit|MultiEdit)
    echo "BLOCKED(Phase1): 파일 수정 금지. 읽기·조회·분석만 가능. 변경이 필요하면 실행하지 말고 무엇을 바꿔야 하는지 보고만 하세요." >&2
    exit 2 ;;
esac

if [ "$tool" = "Bash" ]; then
  cmd=$(printf '%s' "$input" | /usr/bin/python3 -c "import sys,json;print(json.load(sys.stdin).get('tool_input',{}).get('command',''))" 2>/dev/null)
  # 위험/외부행동 패턴만 차단 (임시 조회파일·node -e SELECT 등 읽기작업은 허용)
  if printf '%s' "$cmd" | grep -qiE "git +(push|commit|reset|checkout|rebase|merge)|vercel|deploy|npm +(run +)?(deploy|build|start)|rm +-rf|sudo |launchctl|curl[^|]*-X *(POST|PUT|PATCH|DELETE)|curl[^|]*-d |wget |node +[^ ]*(Sync|Dispatch|Outbound|Process|register|kakao|build[Pp]ost|Invoice|csAction|Reply|dutyFree)|sendMessage|sendDocument|register(Single|Rows|Return|Outbound)|\.upsert\(|\.insert\(|\.update\(|\.delete\(|drop +table|psql"; then
    echo "BLOCKED(Phase1 안전모드): 발송·배포·삭제·DB쓰기·동기화 실행 등은 금지입니다. 읽기/조회(SELECT)만 하세요. 그런 행동이 필요하면 실행하지 말고 '무엇을 할지'만 보고하세요." >&2
    exit 2
  fi
fi
exit 0
