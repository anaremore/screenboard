export function BrandMark({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="currentColor" />
      <path d="M9 13V10.5A1.5 1.5 0 0 1 10.5 9H13m6 0h2.5a1.5 1.5 0 0 1 1.5 1.5V13m0 6v2.5a1.5 1.5 0 0 1-1.5 1.5H19m-6 0h-2.5A1.5 1.5 0 0 1 9 21.5V19" stroke="white" strokeWidth="2" strokeLinecap="round" />
      <rect x="12" y="12" width="8" height="8" rx="1.5" fill="white" />
    </svg>
  );
}
