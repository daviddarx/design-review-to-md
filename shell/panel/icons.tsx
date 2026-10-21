// 16px stroke icons for the row actions (Lucide's shapes, inlined: the shell
// bundles no icon library).
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
