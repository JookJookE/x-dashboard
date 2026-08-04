# 𝕏 Auto Poster - heisenberg.kr 리포트 자동 포스팅 시스템

[하이젠버그(heisenberg.kr)](https://heisenberg.kr/) 사이트의 최신 기술/과학 분석 리포트를 자동으로 수집하고, **Google Gemini AI**를 활용하여 트위터용 3줄 요약을 작성한 뒤, **X(Twitter) 계정에 자동으로 업로드**하는 웹 기반 포스팅 프로그램입니다.

---

## 🌟 주요 기능

1. **heisenberg.kr 최신 아티클 자동 수집**: 워드프레스 REST API를 이용해 최신 리포트 제목, 본문, 원본 링크를 실시간 파싱.
2. **Gemini AI 감각적 3줄 요약**: 트위터 글자 수 제한(280자)에 맞춰 💡핵심 포인트, 🔍요약, 🔗원문 링크, #해시태그를 자동 구성.
3. **공식 X API v2 포스팅 (안전)**: X Developer Portal 정식 키를 사용하여 **계정 제재/봇 감지 우려 없이** 안전하게 포스팅.
4. **일일 예약 자동 포스팅**: 매일 지정한 시간(예: 오전 09:00)에 새로운 아티클을 감지하여 자동 포스팅.
5. **웹 대시보드 UI (http://localhost:3000)**:
   - API 키 및 예약 시간 손쉬운 설정
   - X API 연동 일괄 테스트
   - 최신 아티클 조회 & 즉시 AI 요약 생성
   - 1-Click "X에 지금 올리기" 및 "X.com 웹에서 확인 후 올리기" 지원
   - 실시간 시스템 작업 로그 & 포스팅 히스토리 관리

---

## 🔑 X (Twitter) Developer API 키 발급 가이드

정식 자동 포스팅을 위해 X API 키가 필요합니다 (무료 Free Tier 가능):

1. **[X Developer Portal](https://developer.x.com/)** 접속 및 개발자 계정 신청.
2. **Projects & Apps**에서 새 앱 생성.
3. **User authentication settings** 설정:
   - App permissions: **Read and Write** (읽기 및 쓰기 권한 필수)
   - Type of App: **Web App, Automated App or Bot**
4. **Keys and Tokens** 탭에서 다음 4가지 값을 발급받아 복사:
   - `API Key` (App Key)
   - `API Key Secret` (App Secret)
   - `Access Token`
   - `Access Token Secret`
5. 웹 대시보드 (`http://localhost:3000`)의 **[API & 예약 설정]** 메뉴에서 위 4개 키를 입력하고 **[API 연동 테스트]**를 클릭합니다.

---

## 🚀 실행 방법

### 1. 패키지 설치 및 서버 실행

```bash
# 의존성 패키지 설치
npm install

# 서버 실행 (대시보드: http://localhost:3000)
npm start
```

### 2. 웹 대시보드 접속

브라우저에서 `http://localhost:3000`에 접속합니다.

- **API & 예약 설정**: X API Key 및 Gemini API Key를 저장하고, 원하는 일일 예약 시간(예: 09:00)을 설정한 후 **자동 포스팅 활성화** 토글을 켭니다.
- **최신 아티클 탭**: `heisenberg.kr` 리포트를 확인하고 `✨ AI 요약하기` 버튼을 누릅니다.
- **AI 요약 & 포스팅 탭**: 요약 문구를 확인/편집한 후 **[X에 지금 포스팅하기]**를 누르면 끝!

---

## 📂 프로젝트 구조

```
x-auto-poster/
├── config.js         # API 키 및 설정 파일 관리
├── history.js        # 포스팅 내역 및 시스템 로그 저장 모듈
├── scraper.js        # heisenberg.kr 워드프레스 REST API 파서
├── summarizer.js     # Google Gemini AI 트윗 요약 생성기
├── x_client.js       # twitter-api-v2 연동 및 웹 의도(Web Intent) 생성기
├── scheduler.js      # 일일 자동 포스팅 백그라운드 스케줄러
├── server.js         # Express 웹 서버 및 REST API
├── public/           # 웹 대시보드 UI (index.html, style.css, app.js)
├── data/             # 로컬 설정 및 내역 데이터 (자동 생성)
├── package.json
└── README.md
```
