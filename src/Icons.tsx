export function ChevronLeftIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m15 18-6-6 6-6" />
    </svg>
  );
}

export function ChevronRightIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

export function UndoIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M9 7 4 12l5 5" />
      <path d="M4 12h10a6 6 0 0 1 6 6" />
    </svg>
  );
}

export function RedoIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m15 7 5 5-5 5" />
      <path d="M20 12H10a6 6 0 0 0-6 6" />
    </svg>
  );
}

export function BookLogo() {
  return (
    <span className="book-logo" aria-hidden="true">
      <b>QT</b>
      <svg viewBox="0 0 40 22">
        <path d="M20 20C15 15 9 14 2 15V2c7-1 13 1 18 5m0 13c5-5 11-6 18-5V2c-7-1-13 1-18 5v13Z" />
        <path d="M20 7v13" />
      </svg>
    </span>
  );
}
