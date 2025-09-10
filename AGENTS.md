# AGENTS.md — Codex 개발 가이드

이 문서는 Codex(오픈소스 에이전틱 코딩 인터페이스)를 사용해 이 저장소를 개발/유지보수할 때 따라야 할 원칙과 작업 흐름을 정리합니다. 이 레포는 Chrome MV3 확장 프로그램으로, 페이지의 이미지를 수집하고 사용자가 선택한 이미지들을 번호를 붙여 순차적으로 다운로드합니다.

## 목표와 우선순위
- 정확성: 사용자 요구를 오해 없이, 과하지 않게 정확히 반영
- 안전성: 권한/보안 제약을 준수, 파괴적 변경 회피
- 최소 변경: 요구사항 범위 내에서 주변 코드 영향 최소화
- 일관성: 기존 코드 스타일, UI 텍스트(한국어), 구조와 맞춤

## 코드 구조(요약)
- `manifest.json`: MV3 매니페스트, 권한(`downloads`, `activeTab`, `storage`, `scripting`), 팝업 및 백그라운드 등록
- `background.js`: 순차 다운로드, 파일명/확장자/하위 폴더 처리, 메시지(`DOWNLOAD_IMAGES`) 수신, 다운로드 상태 대기
- `content.js`: 이미지 수집(IMG + CSS background, `COLLECT_IMAGES` 응답). 팝업에서 동적으로 주입(`chrome.scripting.executeScript`)
- `popup.html`: UI 레이아웃(자동 로드, 썸네일 클릭 선택, 저장 위치/프리셋, 재시도/반전, 다운로드 버튼)
- `popup.js`: 팝업 로직(동적 주입, 자동 수집, 선택 상태 관리, 프리셋 저장/삭제, 백그라운드 호출)
- `README.md`: 사용자 안내서(설치/사용/권한/제한/프리셋)

## 구현 원칙
- 요구사항 우선: 사용자가 요청한 변경에 국한하여 수정하고, 관련 문서만 업데이트
- MV3 제약 준수: 백그라운드는 Service Worker. 이벤트 기반으로 동작, 장시간 동기 블로킹 금지
- 네이밍/텍스트: 한국어 UI 유지, label/aria 적절히 사용(접근성 고려)
- 확장성: 기본값 명확, 실패 시 합리적 폴백과 사용자 안내
- 불필요한 리팩토링 금지: 범위를 벗어나는 광범위 변경 피하기

## 메시징/흐름 계약
- Content ↔ Popup ↔ Background 간 메시지 타입
  - `COLLECT_IMAGES`(popup → content): `{ includeBackground: boolean }`
  - 응답(content → popup): `{ urls: string[], skippedBlobCount: number }`
  - `DOWNLOAD_IMAGES`(popup → background): `{ urls: string[], baseName: string, subfolder?: string }`
  - 응답(background → popup): `{ ok: boolean, count?: number, error?: string }`
- 순차 다운로드 규칙
  - 파일명: `sanitizeBaseName(baseName)` + `-{index}` + 확장자 추정(`getExtension()`)
  - 폴더: `sanitizeFolderName(subfolder)`이 비어있지 않으면 `subfolder/파일명`
  - 다음 항목 전, 이전 다운로드 완료/중단 상태 확인(`downloads.search` + `onChanged` + timeout)

## 현재 UX 스펙(핵심)
- 팝업 오픈 시 자동 로드(IMG + CSS background), 초기 선택은 “전체 해제”
- 썸네일 카드 클릭으로 선택/해제, 키보드 토글 지원(Enter/Space), 선택 수 배지, 1개 이상 선택 시 다운로드 활성화
- 접두사 기본값은 하이픈 없는 UUID v4(32자)
- 저장 위치: 직접 저장 vs. 하위 폴더 저장(입력은 기본 비어있음)
- 폴더 프리셋: `chrome.storage.local`에 보관, 선택/추가/삭제 지원
- 재시도/선택 반전 버튼 제공

## 권한/보안
- `downloads`: 파일 저장
- `activeTab`: 현재 탭 일시적 접근(팝업 오픈 시)
- `storage`: 프리셋 저장/로드
- `scripting`: content 스크립트 동적 주입(allFrames)
- 특수 페이지(`chrome://*`, Chrome 웹 스토어 등`)는 동작 제한 가능
- `blob:` URL은 다운로드 API 제약으로 제외(현재 스펙)

## 개발 워크플로(Codex CLI)
- Preamble: 연속된 관련 작업을 1~2문장으로 알리고 명령 실행
- Plan: 다단계/모호 작업은 `update_plan`으로 공유(간단 작업은 생략)
- 파일 편집: 항상 `apply_patch` 사용, 변경 최소화
- 셸 사용: 파일/텍스트 검색은 `rg`, 파일 읽기는 250라인 이내 청크
- 승인/샌드박스: 네트워크/쓰기 제한 인지, 필요 시 승인 모드 활용
- 커밋: 사용자가 요청할 때만, 간결한 메시지(예: `feat: …`, `fix: …`)
- 검증: 자동 테스트 없음 → 수동 체크리스트로 검증. 포맷터 추가는 설정 존재 시에만

## 수동 테스트 체크리스트
1. 설치: `chrome://extensions` → 개발자 모드 → 폴더 로드 → 팝업 고정
2. 팝업 열기: 자동으로 썸네일 목록 로드, 초기 선택=0 확인
3. 선택 UI: 카드 클릭/키보드 토글, 카운터/버튼 활성화 반영 확인
4. 다운로드: 3~5장 선택 후 저장, 파일명 `접두사-1.ext …`와 순서 확인(충돌 시 uniquify)
5. 확장자: PNG/JPG/WEBP/SVG 등 혼합 시 확장자 보존/추정 확인
6. 하위 폴더
   - 미선택: `Downloads/접두사-1.ext` 등 루트 저장
   - 선택+폴더명 입력: `Downloads/폴더명/접두사-1.ext` 경로 확인
   - 폴더명이 빈 경우: 루트 저장 안내 문구 출력 확인
7. 프리셋: 추가 → 선택 → 삭제 → 팝업 재열기 후 지속성 확인
8. CSS background: 가시 요소에서 수집되는지 확인(성능 이슈 없는지)
9. 제외 항목: `blob:` URL 제외 및 카운트 표기 확인
10. 제약 페이지: Chrome 웹 스토어 등에서 동작 제한 메시지 확인

## 변경 가이드(예시)
- 새 옵션 추가: `popup.html/js` UI → `background.js` 파라미터/검증 → `README.md` 반영
- 다운로드 정책 변경: `background.js` 중심, content/popup 계약 영향 검토
- 수집 로직 변경: `content.js` 중심, 성능/정확도/중복 처리 주의

## 문서/파일 참조 규칙(CLI 렌더러 호환)
- 파일 경로는 인라인 코드로 표기: `src/app.ts:42` 형식(라인 범위 금지)
- 외부 URL/URI 스킴은 사용하지 않음(`file://`, `vscode://` 등 금지)

## 릴리스 체크리스트
- `manifest.json` 의 `version` 증가
- `README.md` 변경사항 반영, 스크린샷 갱신(있다면)
- 변경 로그 작성(필요 시)

## 향후 개선 아이디어
- 이미지 타입/크기/해상도 필터, 최소 크기 옵션
- 선택 항목 드래그로 순서 재배치
- 파일명 자리수 패딩 옵션(`-001`, `-002` …)
- 실패 항목 재시도 및 실패 레포트 UI
- 국제화(i18n) 구조화

이 문서는 레포와 함께 진화합니다. 스펙 변경 시 본 문서를 업데이트하세요.
