export const salesSummary = {
  today: {
    revenue: 4_850_000,
    orders: 7,
    avgOrder: 692_857,
  },
  week: {
    revenue: 31_200_000,
    orders: 48,
    avgOrder: 650_000,
  },
  month: {
    revenue: 128_750_000,
    orders: 197,
    avgOrder: 653_553,
  },
};

export const topProducts = [
  { rank: 1, name: "폴바이스 클래식 오토매틱 블랙", sku: "PW-CA-001-BK", sold: 42, revenue: 37_800_000, image: "⌚" },
  { rank: 2, name: "폴바이스 슬림 쿼츠 화이트", sku: "PW-SQ-002-WH", sold: 38, revenue: 19_000_000, image: "⌚" },
  { rank: 3, name: "폴바이스 크로노그래프 네이비", sku: "PW-CH-003-NV", sold: 31, revenue: 43_400_000, image: "⌚" },
  { rank: 4, name: "폴바이스 미니멀 골드", sku: "PW-MN-004-GD", sold: 27, revenue: 24_300_000, image: "⌚" },
  { rank: 5, name: "폴바이스 다이버 블루", sku: "PW-DV-005-BL", sold: 24, revenue: 33_600_000, image: "⌚" },
  { rank: 6, name: "폴바이스 레이디 로즈골드", sku: "PW-LD-006-RG", sold: 19, revenue: 15_200_000, image: "⌚" },
  { rank: 7, name: "폴바이스 파일럿 스틸", sku: "PW-PT-007-ST", sold: 16, revenue: 22_400_000, image: "⌚" },
  { rank: 8, name: "폴바이스 드레스 실버", sku: "PW-DR-008-SV", sold: 13, revenue: 11_700_000, image: "⌚" },
  { rank: 9, name: "폴바이스 스포츠 블랙", sku: "PW-SP-009-BK", sold: 11, revenue: 8_800_000, image: "⌚" },
  { rank: 10, name: "폴바이스 헤리티지 브라운", sku: "PW-HT-010-BR", sold: 9, revenue: 12_600_000, image: "⌚" },
];

export const hourlyOrders = [
  { hour: "00시", orders: 0, revenue: 0 },
  { hour: "01시", orders: 0, revenue: 0 },
  { hour: "02시", orders: 0, revenue: 0 },
  { hour: "03시", orders: 0, revenue: 0 },
  { hour: "04시", orders: 0, revenue: 0 },
  { hour: "05시", orders: 1, revenue: 890_000 },
  { hour: "06시", orders: 0, revenue: 0 },
  { hour: "07시", orders: 1, revenue: 500_000 },
  { hour: "08시", orders: 2, revenue: 1_400_000 },
  { hour: "09시", orders: 3, revenue: 2_700_000 },
  { hour: "10시", orders: 5, revenue: 3_500_000 },
  { hour: "11시", orders: 8, revenue: 6_400_000 },
  { hour: "12시", orders: 11, revenue: 8_800_000 },
  { hour: "13시", orders: 9, revenue: 7_200_000 },
  { hour: "14시", orders: 7, revenue: 5_600_000 },
  { hour: "15시", orders: 10, revenue: 8_100_000 },
  { hour: "16시", orders: 12, revenue: 9_600_000 },
  { hour: "17시", orders: 14, revenue: 11_200_000 },
  { hour: "18시", orders: 16, revenue: 12_800_000 },
  { hour: "19시", orders: 13, revenue: 10_400_000 },
  { hour: "20시", orders: 9, revenue: 7_200_000 },
  { hour: "21시", orders: 7, revenue: 5_600_000 },
  { hour: "22시", orders: 4, revenue: 3_200_000 },
  { hour: "23시", orders: 2, revenue: 1_600_000 },
];

export const inventory = [
  { name: "폴바이스 클래식 오토매틱 블랙", sku: "PW-CA-001-BK", stock: 3, threshold: 5, status: "critical" },
  { name: "폴바이스 크로노그래프 네이비", sku: "PW-CH-003-NV", stock: 4, threshold: 5, status: "critical" },
  { name: "폴바이스 다이버 블루", sku: "PW-DV-005-BL", stock: 7, threshold: 10, status: "warning" },
  { name: "폴바이스 미니멀 골드", sku: "PW-MN-004-GD", stock: 9, threshold: 10, status: "warning" },
  { name: "폴바이스 슬림 쿼츠 화이트", sku: "PW-SQ-002-WH", stock: 0, threshold: 5, status: "soldout" },
  { name: "폴바이스 레이디 로즈골드", sku: "PW-LD-006-RG", stock: 15, threshold: 10, status: "ok" },
  { name: "폴바이스 파일럿 스틸", sku: "PW-PT-007-ST", stock: 22, threshold: 10, status: "ok" },
  { name: "폴바이스 드레스 실버", sku: "PW-DR-008-SV", stock: 18, threshold: 10, status: "ok" },
  { name: "폴바이스 스포츠 블랙", sku: "PW-SP-009-BK", stock: 30, threshold: 10, status: "ok" },
  { name: "폴바이스 헤리티지 브라운", sku: "PW-HT-010-BR", stock: 25, threshold: 10, status: "ok" },
];

export const weeklyRevenue = [
  { day: "월", revenue: 18_200_000, orders: 28 },
  { day: "화", revenue: 22_400_000, orders: 34 },
  { day: "수", revenue: 19_800_000, orders: 30 },
  { day: "목", revenue: 25_600_000, orders: 39 },
  { day: "금", revenue: 31_500_000, orders: 48 },
  { day: "토", revenue: 42_300_000, orders: 65 },
  { day: "일", revenue: 38_700_000, orders: 59 },
];
