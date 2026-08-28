tell application "System Events" to tell process "KakaoTalk"
	set out to "창 " & (count of windows) & "개" & linefeed
	repeat with w in windows
		set sr to ""
		try
			set sr to subrole of w
		end try
		set p to position of w
		set s to size of w
		set nm to ""
		try
			set nm to name of w
		end try
		if nm is missing value then set nm to "(이름없음)"
		set out to out & "· [" & nm & "] subrole=" & sr & " pos=" & (item 1 of p) & "," & (item 2 of p) & " size=" & (item 1 of s) & "x" & (item 2 of s) & linefeed
	end repeat
	return out
end tell
