-- 열려 있는 카카오톡 채팅방 창을 전부 순회하며 대화 내용을 CSV 로 내보낸다.
--
-- 전제:
--   · 내보낼 방들의 "창"이 카카오톡에 열려 있어야 한다 (카톡은 종료 시 창 복원 지원).
--   · 저장 패널은 늘 "다운로드"로 열린다(실측: 기억 안 함). 그대로 저장하고
--     실행 후 래퍼가 ~/Downloads → ~/KakaoExports 로 옮긴다.
--   · SSH 컨텍스트(sshd)에 손쉬운 사용 + 화면 기록 권한. tmux 에서는 ssh localhost 로 실행.
--
-- 커스텀 UI 라 설정 창 안의 탭/버튼은 AX 가 안 보여서 창 기준 상대좌표 클릭을 쓴다.
-- 설정 창은 항상 580x480 이라 상대좌표가 안정적이다. 저장 패널부터는 표준 AX.
on lclick(px, py)
	do shell script "/usr/bin/osascript -l JavaScript /Users/mac/sungjo_ai/paulwise-dashboard/local-agent/kakao/lclick.js " & px & " " & py
end lclick

on findSettings()
	-- 설정 창은 탭에 따라 높이가 변한다(480~610 실측). 너비 580 + 채팅방이 아닌 것으로 판별.
	tell application "System Events" to tell process "KakaoTalk"
		repeat with w in windows
			try
				set s to size of w
				set nm to missing value
				try
					set nm to name of w
				end try
				if (item 1 of s) is 580 and (nm is missing value or nm is "Window" or nm is "채팅방 설정") then return w
			end try
		end repeat
	end tell
	return missing value
end findSettings

on closeSettings()
	tell application "System Events" to tell process "KakaoTalk"
		set w to my findSettings()
		if w is not missing value then
			try
				click button 1 of w -- 빨간 닫기 버튼 (표준)
			end try
		end if
	end tell
end closeSettings

set results to {}

tell application "System Events" to tell process "KakaoTalk"
	set frontmost to true
	delay 0.5

	-- 잔여 설정 창이 있으면 닫고 시작
	my closeSettings()
	delay 0.5

	-- 채팅방 창 이름 수집 (메인 "카카오톡" 과 설정 창 제외)
	set roomNames to {}
	repeat with w in windows
		try
			set nm to name of w
			set s to size of w
			if nm is not "카카오톡" and nm is not missing value and nm is not "Window" and nm is not "채팅방 설정" and (item 1 of s) is not 580 then
				set end of roomNames to nm
			end if
		end try
	end repeat
	if (count of roomNames) is 0 then return "열린 채팅방 창 없음"

	repeat with roomName in roomNames
		set roomName to roomName as text
		try
			perform action "AXRaise" of window roomName
			delay 0.6
			keystroke "," using {option down, command down}
			delay 1.2

			set sw to my findSettings()
			if sw is missing value then
				set end of results to roomName & ": 설정 창 안 열림"
			else
				-- "대화 내용 관리" 탭 클릭 (탭 리스트 위치는 높이와 무관)
				set p to position of sw
				my lclick((item 1 of p) + 55, (item 2 of p) + 125)
				delay 0.8
				-- 탭 전환으로 창 높이가 바뀔 수 있어 위치를 다시 읽는다
				set sw to my findSettings()
				set p to position of sw
				my lclick((item 1 of p) + 220, (item 2 of p) + 281)
				delay 1.5

				-- 저장 시트: 파일명 필드가 있는 표준 패널
				set saved to false
				repeat with try_i from 1 to 10
					try
						set sh to sheet 1 of sw
						set dummy to value of text field 1 of sh
						set folderNow to value of pop up button 1 of sh
						if folderNow is not "KakaoExports" and folderNow is not "다운로드" then
							-- 예상 밖 폴더면 저장하지 않는다 (엉뚱한 곳에 쓰지 않기)
							click button "취소" of sh
							set end of results to roomName & ": 폴더가 " & folderNow & " 라 중단"
							exit repeat
						end if
						click button "저장" of sh
						set saved to true
						exit repeat
					on error
						delay 0.5
					end try
				end repeat

				if saved then
					delay 2.5
					-- 카톡은 파일을 정상 저장하고도 "내보내기 중 오류" 창을 띄운다(실측 2026-08-28).
					-- 그래서 여기서 성공/실패를 판정하지 않고 창만 닫는다. 진짜 판정은
					-- 래퍼(kakaoExport.js)가 파일이 실제로 생겼는지로 한다.
					repeat with dismiss_i from 1 to 3
						try
							click button "확인" of sheet 1 of sw
							delay 0.6
						on error
							exit repeat
						end try
					end repeat
					set end of results to roomName & ": 저장 시도함"
				end if

				my closeSettings()
				delay 0.5
			end if
		on error errMsg
			set end of results to roomName & ": 실패 — " & errMsg
			my closeSettings()
		end try
	end repeat
end tell

set AppleScript's text item delimiters to linefeed
return results as text
