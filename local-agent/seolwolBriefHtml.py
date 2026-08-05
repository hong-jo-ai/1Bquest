#!/usr/bin/env python3
"""
설월 촬영 의뢰서 → 사진작가에게 그대로 보낼 수 있는 단일 HTML 파일.

- docs/seolwol-photo-brief-studio.md 를 HTML로 변환
- 표에 등장하는 `cutNN_*.png` 파일명을 refs/studio 의 레퍼런스 썸네일로 치환(base64 인라인)
  → 외부 파일 의존 없음. 메일 첨부 1개로 끝. 브라우저에서 인쇄하면 PDF.

사용: python3 local-agent/seolwolBriefHtml.py
출력: downloads/seolwol-detail/설월_촬영의뢰서.html
"""

import base64
import html
import io
import os
import re

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "docs", "seolwol-photo-brief-studio.md")
REFS = os.path.join(ROOT, "downloads", "seolwol-detail", "refs", "studio")
OUT = os.path.join(ROOT, "downloads", "seolwol-detail", "설월_촬영의뢰서.html")

THUMB_W = 560


def thumb(name):
    """레퍼런스 파일명 → base64 data URI (없으면 None)."""
    path = os.path.join(REFS, name)
    if not os.path.exists(path):
        return None
    im = Image.open(path).convert("RGB")
    if im.width > THUMB_W:
        im = im.resize((THUMB_W, round(im.height * THUMB_W / im.width)), Image.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=82, optimize=True)
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()


def inline(text):
    """굵게 · 코드 · 취소선 인라인 변환 (이스케이프 후)."""
    t = html.escape(text)
    t = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", t)
    t = re.sub(r"~~(.+?)~~", r"<s>\1</s>", t)

    def code(m):
        name = m.group(1)
        if re.fullmatch(r"cut[\w-]+\.png", name):
            src = thumb(name)
            if src:
                return f'<figure class="ref"><img src="{src}" alt="{name}"><figcaption>{name}</figcaption></figure>'
        return f"<code>{name}</code>"

    t = re.sub(r"`([^`]+)`", code, t)
    return t


def convert(md):
    out, i, lines = [], 0, md.split("\n")
    while i < len(lines):
        ln = lines[i]

        # 표
        if ln.startswith("|") and i + 1 < len(lines) and re.match(r"^\|[\s:|-]+\|$", lines[i + 1]):
            head = [c.strip() for c in ln.strip("|").split("|")]
            i += 2
            rows = []
            while i < len(lines) and lines[i].startswith("|"):
                rows.append([c.strip() for c in lines[i].strip("|").split("|")])
                i += 1
            th = "".join(f"<th>{inline(c)}</th>" for c in head)
            body = "".join(
                "<tr>" + "".join(f"<td>{inline(c)}</td>" for c in r) + "</tr>" for r in rows
            )
            out.append(f"<table><thead><tr>{th}</tr></thead><tbody>{body}</tbody></table>")
            continue

        # 인용
        if ln.startswith(">"):
            block = []
            while i < len(lines) and lines[i].startswith(">"):
                block.append(lines[i].lstrip(">").strip())
                i += 1
            out.append("<blockquote>" + "<br>".join(inline(b) for b in block if b) + "</blockquote>")
            continue

        # 제목
        m = re.match(r"^(#{1,4})\s+(.*)$", ln)
        if m:
            lvl = len(m.group(1))
            out.append(f"<h{lvl}>{inline(m.group(2))}</h{lvl}>")
            i += 1
            continue

        if ln.strip() == "---":
            out.append("<hr>")
            i += 1
            continue

        # 목록
        if re.match(r"^\s*[-*]\s+", ln) or re.match(r"^\s*\d+\.\s+", ln):
            ordered = bool(re.match(r"^\s*\d+\.\s+", ln))
            items = []
            while i < len(lines) and (
                re.match(r"^\s*[-*]\s+", lines[i]) or re.match(r"^\s*\d+\.\s+", lines[i])
            ):
                items.append(re.sub(r"^\s*(?:[-*]|\d+\.)\s+", "", lines[i]))
                i += 1
            tag = "ol" if ordered else "ul"
            out.append(f"<{tag}>" + "".join(f"<li>{inline(x)}</li>" for x in items) + f"</{tag}>")
            continue

        if ln.strip():
            out.append(f"<p>{inline(ln)}</p>")
        i += 1
    return "\n".join(out)


CSS = """
:root{color-scheme:light}
body{font-family:'Apple SD Gothic Neo','Malgun Gothic',sans-serif;max-width:900px;margin:0 auto;
  padding:48px 28px 90px;color:#1c2029;line-height:1.85;word-break:keep-all;background:#fff;font-size:15px;}
h1{font-size:27px;letter-spacing:-.02em;margin:0 0 6px;border-bottom:2px solid #2c3c63;padding-bottom:14px;}
h2{font-size:20px;margin:52px 0 14px;color:#2c3c63;}
h3{font-size:16.5px;margin:32px 0 10px;}
h4{font-size:15px;margin:24px 0 8px;color:#5a6a8c;}
p{margin:10px 0;}
hr{border:0;border-top:1px solid #e6e9f0;margin:40px 0;}
blockquote{margin:16px 0;padding:14px 18px;background:#f4f6f9;border-left:3px solid #2c3c63;
  border-radius:0 3px 3px 0;font-size:14.5px;}
table{border-collapse:collapse;width:100%;margin:18px 0;font-size:14px;}
th,td{border:1px solid #e0e4ec;padding:11px 12px;text-align:left;vertical-align:top;}
th{background:#eef1f6;font-weight:600;color:#2c3c63;white-space:nowrap;}
thead:has(th:empty){display:none;}  /* 헤더 없는 사양표의 빈 머리줄 숨김 */
td:first-child{white-space:nowrap;font-weight:600;}
code{background:#eef1f6;padding:2px 6px;border-radius:3px;font-size:13px;}
ul,ol{margin:10px 0;padding-left:22px;}
li{margin:5px 0;}
b{color:#0f1626;}
figure.ref{margin:0;width:260px;}
figure.ref img{width:100%;display:block;border:1px solid #dfe3ea;border-radius:3px;}
figure.ref figcaption{font-size:11px;color:#8a919d;margin-top:5px;}
@media print{body{padding:0;font-size:11pt;} h2{page-break-after:avoid;} table{page-break-inside:avoid;}}
@media (max-width:640px){td:first-child{white-space:normal;} figure.ref{width:100%;}}
"""

md = open(SRC, encoding="utf-8").read()
body = convert(md)
open(OUT, "w", encoding="utf-8").write(
    f"""<!doctype html><html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>HARRIOT SEOLWOL 설월 — 제품 촬영 의뢰서</title>
<style>{CSS}</style></head><body>{body}</body></html>"""
)
print(f"✓ {OUT}  ({os.path.getsize(OUT)/1024/1024:.1f}MB)")
