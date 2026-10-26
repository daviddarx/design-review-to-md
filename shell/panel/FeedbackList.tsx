import type { Op } from "../../model/ops.ts"
import type { PinRecord, Status } from "../../model/types.ts"
import type { FlatRow, PinTarget } from "./listModel.ts"
import { pinRecordPath } from "./listModel.ts"
import { RowItem } from "./RowItem.tsx"

type FeedbackListProps = {
  rows: FlatRow[]
  review: string
  records: Record<string, PinRecord | null>
  shownPinsOwner: string | null // the row whose pins Show pins keeps on screen
  onLoadRecord(path: string): Promise<PinRecord | null>
  onOp(rowId: string, op: Op): Promise<boolean>
  reopenStatus(rowId: string): Status // where Devalidate puts a done row
  onEditFeedback(n: number): void
  onTogglePins(rowId: string, target: PinTarget): void
  onOpenSource(rowId: string, target: PinTarget): void
  onPeekPins(ownerRowId: string, records: PinRecord[] | null): void
}

// The flat rows as one list.
export function FeedbackList({
  rows,
  records,
  shownPinsOwner,
  onLoadRecord,
  onOp,
  reopenStatus,
  ...rest
}: FeedbackListProps) {
  const byId = new Map(rows.map((r) => [r.rowId, r]))
  return (
    <ul className="dr-list" aria-label="Feedback">
      {rows.map((row) => {
        const ownerId = row.pins.length ? row.rowId : row.inheritedPinFrom
        const ownerPins = ownerId ? (byId.get(ownerId)?.pins ?? []) : []
        const owner = ownerId && ownerPins.length ? { rowId: ownerId, pins: ownerPins } : undefined
        const paths = owner
          ? owner.pins.map((pin, i) => pinRecordPath(pin, owner.rowId, i, row.folder))
          : []
        return (
          <RowItem
            key={row.rowId}
            row={row}
            owner={owner}
            recordPaths={paths}
            records={paths.map((path) => records[path])}
            pinsShown={Boolean(owner && owner.rowId === shownPinsOwner)}
            onLoadRecords={() => Promise.all(paths.map(onLoadRecord))}
            onOp={(op) => onOp(row.rowId, op)}
            reopenTo={reopenStatus(row.rowId)}
            {...rest}
          />
        )
      })}
    </ul>
  )
}
