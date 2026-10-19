import { useEffect, useRef } from "react";

import {
  ALL_PERSON_FILTERS,
  REMAINING_PERSON_FILTERS,
  filterSelectionDescription,
  filterTriggerLabel,
  PERSON_FILTER_LABELS,
  type PersonFilter,
} from "./distributionView";

export function PersonFilterMenu({
  filters,
  open,
  onChange,
  onOpenChange,
}: {
  filters: ReadonlySet<PersonFilter>;
  open: boolean;
  onChange: (filters: PersonFilter[]) => void;
  onOpenChange: (open: boolean) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) onOpenChange(false);
    };
    const closeWithEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onOpenChange(false);
    };
    window.addEventListener("pointerdown", closeOutside);
    window.addEventListener("keydown", closeWithEscape);
    return () => {
      window.removeEventListener("pointerdown", closeOutside);
      window.removeEventListener("keydown", closeWithEscape);
    };
  }, [onOpenChange, open]);

  function toggle(filter: PersonFilter) {
    const next = new Set(filters);
    if (next.has(filter)) next.delete(filter);
    else next.add(filter);
    onChange(ALL_PERSON_FILTERS.filter((candidate) => next.has(candidate)));
  }

  return (
    <div
      className="person-filter-menu"
      ref={rootRef}
      data-open={open || undefined}
    >
      <button
        className="filter-trigger"
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        title={filterSelectionDescription(filters) || "선택한 상태 없음"}
        onClick={() => onOpenChange(!open)}
      >
        {filterTriggerLabel(filters)}
      </button>
      {open && (
        <div className="filter-popover" role="menu" aria-label="신청자 필터">
          <div className="filter-presets">
            <button
              type="button"
              onClick={() => onChange([...REMAINING_PERSON_FILTERS])}
            >
              남은 배부
            </button>
            <button
              type="button"
              onClick={() => onChange([...ALL_PERSON_FILTERS])}
            >
              전체
            </button>
          </div>
          {ALL_PERSON_FILTERS.map((filter) => (
            <label key={filter}>
              <input
                type="checkbox"
                checked={filters.has(filter)}
                onChange={() => toggle(filter)}
              />
              <span>{PERSON_FILTER_LABELS[filter]}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
