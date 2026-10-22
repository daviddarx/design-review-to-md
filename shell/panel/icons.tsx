// 16px stroke icons for the list's and the drawer's row actions (Lucide's
// shapes, inlined: the shell bundles no icon library).
const PATHS = {
  edit: "M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z",
  validate: "M20 6 9 17l-5-5",
  refine: "M9 17 4 12l5-5 M20 18v-2a4 4 0 0 0-4-4H4",
  history: "M12 7v5l3 2 M3 12a9 9 0 1 0 3-6.7L3 8 M3 3v5h5",
  pin: "M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 0 1 16 0Z M12 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z",
  screenshot:
    "M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z M9 11a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z M21 15l-3-3a2 2 0 0 0-3 0l-9 9",
  restore: "M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8 M3 3v5h5",
  source: "m16 18 6-6-6-6 M8 6l-6 6 6 6",
  addRow: "M12 5v14 M5 12h14",
  attach:
    "m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48",
  remove: "M3 6h18 M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6 M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2",
} as const

export type IconName = keyof typeof PATHS

export function Icon({ name }: { name: IconName }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={PATHS[name]} />
    </svg>
  )
}

// An icon action; its name shows in a tooltip on hover or keyboard focus.
export function ActionButton({
  icon,
  label,
  tip = label,
  pressed,
  count,
  onClick,
}: {
  icon: IconName
  label: string
  tip?: string
  pressed?: boolean
  count?: number // a red pill on the icon, from 1 up
  onClick(): void
}) {
  return (
    <button
      type="button"
      className="dr-action"
      aria-label={label}
      aria-pressed={pressed}
      data-tip={tip}
      onClick={onClick}
    >
      <Icon name={icon} />
      {count ? <span className="dr-action-count">{count}</span> : null}
    </button>
  )
}
