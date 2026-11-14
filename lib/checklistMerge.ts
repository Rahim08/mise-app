// Слияние одной отметки пункта в items_state прогона (см. app/api/people/checklist-item).
export type ChecklistItemState = { done: boolean; photo_url?: string | null; result?: string | null; note?: string | null; label?: string; weight?: number }

export function mergeChecklistItem(state: any[] | null, size: number, idx: number, item: ChecklistItemState): { state: ChecklistItemState[]; allDone: boolean } {
  const next: ChecklistItemState[] = Array.isArray(state) ? state.map(s => (s && typeof s === 'object' ? s : { done: false })) : []
  while (next.length < Math.max(size, idx + 1)) next.push({ done: false })
  next[idx] = item
  return { state: next, allDone: next.length > 0 && next.every(s => s.done === true) }
}

