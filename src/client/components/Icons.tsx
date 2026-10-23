import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement>;

const iconDefaults = {
  width: 16,
  height: 16,
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
  focusable: 'false',
} as const;

export function PlayIcon(props: IconProps) {
  return (
    <svg {...iconDefaults} {...props}>
      <path d="M5.4 3.3v9.4L12.9 8z" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function PauseIcon(props: IconProps) {
  return (
    <svg {...iconDefaults} {...props}>
      <rect x="4.4" y="3.4" width="2.5" height="9.2" rx="1" fill="currentColor" stroke="none" />
      <rect x="9.1" y="3.4" width="2.5" height="9.2" rx="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function RetryIcon(props: IconProps) {
  return (
    <svg {...iconDefaults} {...props}>
      <path d="M13.2 8a5.2 5.2 0 1 1-1.8-3.9" />
      <path d="M13.4 2.5v3.2h-3.2" />
    </svg>
  );
}

export function ResetIcon(props: IconProps) {
  return (
    <svg {...iconDefaults} {...props}>
      <path d="M3.1 6.4A5.2 5.2 0 1 1 3 9.9" />
      <path d="M2.8 2.7v3.4h3.4" />
      <path d="M6.3 8h3.4" />
    </svg>
  );
}

export function LockIcon(props: IconProps) {
  return (
    <svg {...iconDefaults} {...props}>
      <rect x="3.6" y="7" width="8.8" height="6.2" rx="1.6" />
      <path d="M5.7 7V5.5a2.3 2.3 0 0 1 4.6 0V7" />
      <path d="M8 9.4v1.5" />
    </svg>
  );
}

export function EyeIcon(props: IconProps) {
  return (
    <svg {...iconDefaults} {...props}>
      <path d="M1.7 8s2.2-4 6.3-4 6.3 4 6.3 4-2.2 4-6.3 4S1.7 8 1.7 8Z" />
      <circle cx="8" cy="8" r="1.9" />
    </svg>
  );
}

export function EyeOffIcon(props: IconProps) {
  return (
    <svg {...iconDefaults} {...props}>
      <path d="M2.4 2.4l11.2 11.2" />
      <path d="M6.4 4.4A6.8 6.8 0 0 1 8 4.2c4.1 0 6.3 3.8 6.3 3.8a11 11 0 0 1-1.9 2.4" />
      <path d="M4.3 5.8A10.6 10.6 0 0 0 1.7 8s2.2 4 6.3 4a6.6 6.6 0 0 0 2.6-.5" />
      <path d="M6.7 6.7a1.9 1.9 0 0 0 2.6 2.6" />
    </svg>
  );
}

export function AlertIcon(props: IconProps) {
  return (
    <svg {...iconDefaults} {...props}>
      <path d="M8 2.6 14 13H2L8 2.6Z" />
      <path d="M8 6.3v3.1" />
      <path d="M8 11.5h.01" />
    </svg>
  );
}

export function Spinner() {
  return <span className="spinner" aria-hidden="true" />;
}
