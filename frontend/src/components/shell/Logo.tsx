/** CUTLINE mark: two nodes whose connecting relation is cut by a blood-red slash. */
export function LogoMark({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden>
      <rect x="0.75" y="0.75" width="18.5" height="18.5" rx="2" stroke="#403939" strokeWidth="1.5" fill="#0e0d0d" />
      <circle cx="5.6" cy="10" r="1.9" stroke="#ece6dc" strokeWidth="1.4" />
      <circle cx="14.4" cy="10" r="1.9" stroke="#ece6dc" strokeWidth="1.4" />
      <path d="M7.5 10h1.3M11.2 10h1.3" stroke="#716b65" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M9.1 13.4l1.8-6.8" stroke="#e3182f" strokeWidth="1.7" strokeLinecap="square" />
    </svg>
  );
}
