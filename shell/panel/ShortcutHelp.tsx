const GROUPS: { title: string; keys: [string, string][] }[] = [
  {
    title: "Review",
    keys: [
      ["⌃R", "Review mode"],
      ["⌃P", "Pin & add"],
    ],
  },
  {
    title: "Picker",
    keys: [
      ["↑ / ↓", "Parent / child"],
      ["Click", "Select"],
      ["Esc", "Cancel"],
    ],
  },
  {
    title: "Drawer",
    keys: [
      ["Enter", "New sibling"],
      ["Tab / ⇧Tab", "Indent / outdent"],
      ["⌘Enter / ⌘S", "Save"],
      ["Esc", "Close"],
    ],
  },
]

// Keyboard icon; hovering or focusing it shows every shortcut of the tool.
export function ShortcutHelp() {
  return (
    <span className="dr-help">
      <button type="button" className="dr-icon-button" aria-label="Keyboard shortcuts">
        <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
          <rect
            x="2.5"
            y="6"
            width="19"
            height="12"
            rx="2"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          />
          <path
            d="M6 9.5h1M9 9.5h1M12 9.5h1M15 9.5h1M18 9.5h0M6 12h1M9 12h1M12 12h1M15 12h3M8 14.75h8"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      </button>
      <span className="dr-help-tip" role="tooltip">
        {GROUPS.map((g) => (
          <span key={g.title} className="dr-help-group">
            <span className="dr-help-title">{g.title}</span>
            {g.keys.map(([key, label]) => (
              <span key={label} className="dr-help-row">
                <kbd>{key}</kbd>
                <span>{label}</span>
              </span>
            ))}
          </span>
        ))}
      </span>
    </span>
  )
}
