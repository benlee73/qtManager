import { useEffect, useRef, type ReactNode } from "react";

export function ActionMenu({
  id,
  label,
  openMenu,
  onOpenMenu,
  className = "",
  children,
}: {
  id: string;
  label: string;
  openMenu: string | null;
  onOpenMenu: (id: string | null) => void;
  className?: string;
  children: ReactNode;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const open = openMenu === id;

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: Event) => {
      if (!rootRef.current?.contains(event.target as Node)) onOpenMenu(null);
    };
    const closeWithEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onOpenMenu(null);
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
    };
    window.addEventListener("pointerdown", closeOutside);
    // Some embedded WebView drivers (and keyboard/screen-reader activation)
    // deliver a click without a pointerdown. Keep the outside-click contract
    // consistent across native and automated input paths.
    window.addEventListener("click", closeOutside);
    window.addEventListener("keydown", closeWithEscape);
    return () => {
      window.removeEventListener("pointerdown", closeOutside);
      window.removeEventListener("click", closeOutside);
      window.removeEventListener("keydown", closeWithEscape);
    };
  }, [onOpenMenu, open]);

  return (
    <div
      ref={rootRef}
      className={`more-menu ${className}`}
      data-open={open || undefined}
    >
      <button
        className="menu-trigger"
        type="button"
        aria-label={label}
        aria-expanded={open}
        onClick={(event) => {
          event.stopPropagation();
          onOpenMenu(open ? null : id);
        }}
      >
        •••
      </button>
      {open && (
        <div
          className="menu-popover"
          onClick={(event) => {
            event.stopPropagation();
            onOpenMenu(null);
          }}
          role="menu"
        >
          {children}
        </div>
      )}
    </div>
  );
}
