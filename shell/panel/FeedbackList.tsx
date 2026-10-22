import type { KeyboardEvent as ReactKeyboardEvent } from "react"
import type { Op } from "../../model/ops.ts"
import type { PinRecord } from "../../model/types.ts"
import type { FlatRow, PinTarget } from "./listModel.ts"
import { pinRecordPath } from "./listModel.ts"
import { isTyping, RowItem } from "./RowItem.tsx"

type FeedbackListProps = {
  rows: FlatRow[]
  review: string
  records: Record<string, PinRecord | null>
  onLoadRecord(path: string): Promise<PinRecord | null>
  onOp(rowId: string, op: Op): Promise<boolean>
  onEditFeedback(n: number): void
  onGoToPin(rowId: string, target: PinTarget): void
  onRestoreState(rowId: string, target: PinTarget): void
  onOpenSource(rowId: string, target: PinTarget): void
  onHoverPin(ownerRowId: string, record: PinRecord | null): void
}

// The flat rows as one list; ↑/↓ move focus between rows, from a row or
// from any button inside one.
export function FeedbackList({ rows, records, onLoadRecord, onOp, ...rest }: FeedbackListProps) {
  const byId = new Map(rows.map((r) => [r.rowId, r]))

  const onKeyDown = (e: ReactKeyboardEvent<HTMLUListElement>) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return
    if (isTyping(e.target) || e.altKey || e.ctrlKey || e.metaKey) return
    const items = [...e.currentTarget.querySelectorAll<HTMLElement>(":scope > [data-row-id]")]
    const current = (e.target as HTMLElement).closest<HTMLElement>("[data-row-id]")
    const i = current ? items.indexOf(current) : -1
    const next = items[e.key === "ArrowDown" ? i + 1 : i <= 0 ? 0 : i - 1]
    if (!next) return
    e.preventDefault()
    next.focus()
  }

  return (
    <ul className="dr-list" aria-label="Feedback" onKeyDown={onKeyDown}>
      {rows.map((row) => {
        const ownerId = row.pin ? row.rowId : row.inheritedPinFrom
        const ownerPin = ownerId ? byId.get(ownerId)?.pin : undefined
        const owner = ownerId && ownerPin ? { rowId: ownerId, pin: ownerPin } : undefined
        const path = owner ? pinRecordPath(owner.pin, owner.rowId, row.folder) : ""
        return (
          <RowItem
            key={row.rowId}
            row={row}
            owner={owner}
            record={owner ? records[path] : undefined}
            onLoadRecord={() => onLoadRecord(path)}
            onOp={(op) => onOp(row.rowId, op)}
            {...rest}
          />
        )
      })}
    </ul>
  )
}
