import type { ReactNode, SVGProps } from "react";

export type IconName =
  | "gauge"
  | "cube"
  | "plug"
  | "list"
  | "terminal"
  | "settings"
  | "menu"
  | "x"
  | "chevron-down"
  | "chevron-left"
  | "chevron-right"
  | "refresh"
  | "plus"
  | "copy"
  | "trash"
  | "check"
  | "key"
  | "alert"
  | "bolt"
  | "stop"
  | "send"
  | "arrow-right"
  | "info";

const paths: Record<IconName, ReactNode> = {
  gauge: (
    <>
      <path d="M4 15a8 8 0 1 1 16 0" />
      <path d="M12 15l4.2-4.2" />
      <path d="M4 19h16" />
    </>
  ),
  cube: (
    <>
      <path d="M12 2.8 20 7v10l-8 4.2L4 17V7z" />
      <path d="M4 7l8 4.2L20 7" />
      <path d="M12 11.2V21" />
    </>
  ),
  plug: (
    <>
      <path d="M9 3v5M15 3v5" />
      <path d="M6 8h12v3a6 6 0 0 1-12 0z" />
      <path d="M12 17v4" />
    </>
  ),
  list: (
    <>
      <path d="M4 6h16M4 12h16M4 18h10" />
    </>
  ),
  terminal: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="m7 9 3 3-3 3M13 15h4" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06-2.83 2.83-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.04 1.56V21h-4v-.08A1.7 1.7 0 0 0 8.96 19.4a1.7 1.7 0 0 0-1.87.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.56-1.04H3v-4h.08A1.7 1.7 0 0 0 4.6 8.96a1.7 1.7 0 0 0-.34-1.87l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 8.96 4.6 1.7 1.7 0 0 0 10 3.04V3h4v.08a1.7 1.7 0 0 0 1.04 1.56 1.7 1.7 0 0 0 1.87-.34l.06-.06 2.83 2.83-.06.06a1.7 1.7 0 0 0-.34 1.87A1.7 1.7 0 0 0 20.96 10H21v4h-.08A1.7 1.7 0 0 0 19.4 15z" />
    </>
  ),
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  x: <path d="m6 6 12 12M18 6 6 18" />,
  "chevron-down": <path d="m6 9 6 6 6-6" />,
  "chevron-left": <path d="m15 6-6 6 6 6" />,
  "chevron-right": <path d="m9 6 6 6-6 6" />,
  refresh: (
    <>
      <path d="M20 11a8 8 0 1 0-2.3 6.1" />
      <path d="M20 4v7h-7" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  copy: (
    <>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M15 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h3" />
    </>
  ),
  trash: (
    <>
      <path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13M10 11v5M14 11v5" />
    </>
  ),
  check: <path d="m5 12 5 5 9-10" />,
  key: (
    <>
      <circle cx="8" cy="15" r="4" />
      <path d="m11 12 9-9M17 6l3 3M14 9l2 2" />
    </>
  ),
  alert: (
    <>
      <path d="M12 3 2.8 20h18.4z" />
      <path d="M12 9v5M12 17.5v.1" />
    </>
  ),
  bolt: <path d="M13 2 4 14h7l-1 8 9-12h-7z" />,
  stop: <rect x="6" y="6" width="12" height="12" rx="1.5" />,
  send: (
    <>
      <path d="m21 3-7.5 18-3.2-7.3L3 10.5z" />
      <path d="M21 3 10.3 13.7" />
    </>
  ),
  "arrow-right": <path d="M5 12h14M13 6l6 6-6 6" />,
  info: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11v5M12 8v.1" />
    </>
  ),
};

export function Icon({
  name,
  size = 16,
  ...rest
}: { name: IconName; size?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {paths[name]}
    </svg>
  );
}
