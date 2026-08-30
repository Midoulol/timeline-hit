// Map context-menu actions to the pure ops in src/shared/ops.ts.
import type { SubtitleRow } from "../../../shared/types";
import {
  insertBefore,
  insertAfter,
  insertBeforeVideoTime,
  insertAfterVideoTime,
  mergeRows,
  splitRow,
  swapRows,
  timeConsecutiveByStart,
  timeConsecutiveByEnd,
  deleteRows,
  copyRowData,
  pasteAfter,
  pasteColumn,
} from "../../../shared/ops";
import type { OpResult } from "../../../shared/ops";

export interface OpContext {
  index: number;
  currentMs: number;
  positions: number[];
  clipboard: Partial<SubtitleRow> | null;
  setClipboard: (row: Partial<SubtitleRow> | null) => void;
  updateRow: (id: number, patch: Partial<SubtitleRow>) => void;
}

export function runOp(
  name: string,
  rows: SubtitleRow[],
  o: OpContext,
  applyOp: (r: OpResult) => void,
): void {
  const sel = o.positions.length ? o.positions : [o.index];
  switch (name) {
    case "insertBefore":
      return applyOp(insertBefore(rows, o.index));
    case "insertAfter":
      return applyOp(insertAfter(rows, o.index));
    case "insertBeforeVideoTime":
      return applyOp(insertBeforeVideoTime(rows, o.currentMs));
    case "insertAfterVideoTime":
      return applyOp(insertAfterVideoTime(rows, o.currentMs));
    case "merge":
      return applyOp(mergeRows(rows, sel));
    case "split":
      return applyOp(splitRow(rows, o.index, o.currentMs));
    case "swap":
      return applyOp(swapRows(rows, sel[0], sel[1] ?? sel[0]));
    case "consecutiveStart":
      return applyOp(timeConsecutiveByStart(rows, Math.min(...sel), Math.max(...sel)));
    case "consecutiveEnd":
      return applyOp(timeConsecutiveByEnd(rows, Math.min(...sel), Math.max(...sel)));
    case "copy": {
      const data = copyRowData(rows[o.index]);
      if (data) o.setClipboard(data);
      return;
    }
    case "paste":
      if (o.clipboard) return applyOp(pasteAfter(rows, o.index, o.clipboard));
      return;
    case "pasteStart":
      if (o.clipboard) return applyOp(pasteColumn(rows, o.index, "startMs", o.clipboard.startMs));
      return;
    case "pasteEnd":
      if (o.clipboard) return applyOp(pasteColumn(rows, o.index, "endMs", o.clipboard.endMs));
      return;
    case "pasteStyle":
      if (o.clipboard) return applyOp(pasteColumn(rows, o.index, "style", o.clipboard.style));
      return;
    case "pasteCharacter":
      if (o.clipboard) return applyOp(pasteColumn(rows, o.index, "character", o.clipboard.character));
      return;
    case "pasteText":
      if (o.clipboard) return applyOp(pasteColumn(rows, o.index, "text", o.clipboard.text));
      return;
    case "toggleFlag": {
      const r = rows[o.index];
      if (r) return o.updateRow(r.id, { flagged: !r.flagged });
      return;
    }
    case "delete":
      return applyOp(deleteRows(rows, sel));
    default:
      return;
  }
}
