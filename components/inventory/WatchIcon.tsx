export default function WatchIcon({ color, size = 80 }: { color: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 130" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* 러그 상단 */}
      <rect x="36" y="4" width="12" height="22" rx="4" fill={color} opacity="0.5" />
      <rect x="52" y="4" width="12" height="22" rx="4" fill={color} opacity="0.5" />
      {/* 러그 하단 */}
      <rect x="36" y="104" width="12" height="22" rx="4" fill={color} opacity="0.5" />
      <rect x="52" y="104" width="12" height="22" rx="4" fill={color} opacity="0.5" />
      {/* 케이스 */}
      <rect x="18" y="22" width="64" height="86" rx="20" fill={color} opacity="0.85" />
      {/* 다이얼 (흰 원) */}
      <rect x="26" y="30" width="48" height="70" rx="14" fill="white" opacity="0.92" />
      {/* 크라운 */}
      <rect x="83" y="57" width="8" height="16" rx="4" fill={color} opacity="0.6" />
      {/* 시침 */}
      <line x1="50" y1="65" x2="50" y2="43" stroke={color} strokeWidth="3" strokeLinecap="round" />
      {/* 분침 */}
      <line x1="50" y1="65" x2="66" y2="65" stroke={color} strokeWidth="2" strokeLinecap="round" />
      {/* 초침 */}
      <line x1="50" y1="65" x2="50" y2="83" stroke="#ef4444" strokeWidth="1.2" strokeLinecap="round" />
      {/* 중심 */}
      <circle cx="50" cy="65" r="2.5" fill={color} />
    </svg>
  );
}
