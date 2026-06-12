export function LogoMark({ size = 32, color = '#007aff' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none">
      <rect width="64" height="64" rx="14" fill={color} />
      <rect x="14" y="20" width="36" height="5" rx="2.5" fill="white" />
      <rect x="14" y="30" width="26" height="5" rx="2.5" fill="white" opacity=".7" />
      <rect x="14" y="40" width="18" height="5" rx="2.5" fill="white" opacity=".4" />
    </svg>
  )
}
