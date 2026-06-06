# Mori Obsidian Memory

모리의 장기 기억은 서버가 Obsidian Vault의 Markdown 파일을 읽어 system context에 주입한다.
로컬 개발 환경에서는 Markdown Vault를 우선 사용하고, 배포 환경처럼 파일 Vault에 쓸 수 없는 경우에는 Supabase `kv_store`에 같은 기억을 저장한다.

기본 Vault 경로:

```text
/Users/mac/sungjo_ai/MORI Memory
```

다른 경로를 쓰려면 서버 환경변수에 설정한다.

```text
MORI_OBSIDIAN_VAULT=/path/to/vault
```

## 폴더

```text
00_Inbox/
10_Profile/
20_Brand_Rules/
30_Products/
40_Decisions/
50_Playbooks/
60_Prompts/
```

## 문서 형식

```md
---
type: owner_preference
status: active
updated_at: 2026-06-06
source: manual
---

# 대표님 운영 선호

- 1인 운영이라 손이 많이 가는 제안은 싫어한다.
- 모리는 애매하게 맞장구치지 말고 1차 의견을 분명히 내야 한다.
```

`status: active` 문서만 모리가 읽는다. 임시로 빼고 싶은 기억은 `status: archived`로 바꾼다.

지원하는 주요 `type`:

- `owner_preference`
- `brand_rule`
- `product_memory`
- `decision_log`
- `playbook`
- `prompt`

## 동작

`lib/mori/obsidianMemory.ts`가 Vault의 Markdown을 읽고, `lib/mori/context.ts`가 실시간 대시보드 상태 뒤에 장기 기억 블록을 붙인다. 실시간 수치와 장기 기억이 충돌하면 모리는 실시간 수치를 우선하고, 장기 기억은 판단 기준으로 사용한다.

## 모리에게 기억 저장시키기

모리에게 명시적으로 말하면 `save_memory` 도구가 Markdown 파일을 만든다.

예:

```text
모리, 앞으로 광고는 MADS 추천 없이는 예산 변경 제안하지 말라고 기억해둬.
```

저장 위치는 `type`에 따라 정해진다.

- `owner_preference` → `10_Profile/`
- `brand_rule` → `20_Brand_Rules/`
- `product_memory` → `30_Products/`
- `decision_log` → `40_Decisions/`
- `playbook` → `50_Playbooks/`
- `prompt` → `60_Prompts/`
- `memory` 또는 미분류 → `00_Inbox/`

모리가 저장한 파일도 `status: active`면 다음 대화부터 장기 기억으로 읽힌다.

배포 서버에서는 `/Users/mac/...` 로컬 경로에 접근할 수 없으므로 `save_memory`가 실패하지 않도록 `kv_store` fallback을 사용한다. 이 경우 저장 메시지에 `(DB)`가 붙고, 다음 대화부터 장기 기억으로 함께 읽힌다.
