import { useEffect, useRef } from "react";

import {
  ALL_PERSON_FILTERS,
  DEFAULT_PERSON_FILTERS,
  type PersonFilter,
} from "./distributionView";

const labels: Record<PersonFilter, string> = {
  undistributed: "미배부",
  partial: "일부 배부",
  completed: "배부 완료",
  expired: "구독 만료",
};

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
        onClick={() => onOpenChange(!open)}
      >
        필터 <b>{filters.size}</b>
      </button>
      {open && (
        <div className="filter-popover" role="menu" aria-label="신청자 필터">
          <div className="filter-presets">
            <button
              type="button"
              onClick={() => onChange([...DEFAULT_PERSON_FILTERS])}
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
              <span>{labels[filter]}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
