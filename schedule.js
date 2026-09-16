// ============================================================
// 제주 재활용품 요일별 배출제 - 배출 품목 설정
// 이 파일만 수정하면 배출 요일 규정을 손쉽게 업데이트할 수 있습니다.
// 마지막 확인: 2026년 언론 보도(제주시 관계자 인터뷰) 기준입니다.
// 제도가 개편 중이므로(상시배출 시범 운영 논의) 실제 배포 전
// 제주특별자치도 홈페이지(https://www.jeju.go.kr/nature/environment/reform.htm)에서
// 한 번 더 확인하시길 권장드려요.
// ============================================================

window.SCHEDULE_CONFIG = {
  lastVerified: "2026년 8월 (언론 보도 기준)",
  officialUrl: "https://www.jeju.go.kr/nature/environment/reform.htm",
  // 배출 가능 시간
  hours: {
    general: "오후 3시 ~ 다음날 오전 4시",
    food: "24시간 언제든지 배출 가능"
  },
  // 매일 배출 가능한 품목 (요일 무관)
  daily: [
    { key: "general", label: "일반쓰레기 (흰색 종량제봉투)", icon: "🗑️" },
    { key: "food", label: "음식물쓰레기 (전용 용기, 교통카드 필요)", icon: "🍚" }
  ],
  // 요일별 재활용품 배출 품목 (0=일요일 ~ 6=토요일, JS Date.getDay() 기준)
  weekly: {
    0: [{ label: "스티로폼", icon: "📦" }, { label: "플라스틱류", icon: "🧴" }, { label: "비닐류", icon: "🛍️" }],
    1: [{ label: "플라스틱류", icon: "🧴" }],
    2: [{ label: "종이류", icon: "📄" }, { label: "병류", icon: "🍾" }, { label: "불연성 쓰레기", icon: "🪨" }],
    3: [{ label: "캔 · 고철류", icon: "🥫" }],
    4: [{ label: "스티로폼", icon: "📦" }, { label: "비닐류", icon: "🛍️" }],
    5: [{ label: "플라스틱류", icon: "🧴" }],
    6: [{ label: "종이류", icon: "📄" }, { label: "병류", icon: "🍾" }, { label: "불연성 쓰레기", icon: "🪨" }]
  },
  dayNames: ["일요일", "월요일", "화요일", "수요일", "목요일", "금요일", "토요일"],
  dayNamesShort: ["일", "월", "화", "수", "목", "금", "토"]
};
