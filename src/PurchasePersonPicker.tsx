import { useRef, useState } from "react";
import type { PersonSummary } from "./phase3";
import { listIndexAfterKey } from "./keyboardNavigation";
import { purchasePersonLabel } from "./purchasePeople";

export function PurchasePersonPicker({
  query,
  matches,
  selected,
  loading,
  failed,
  newPerson,
  onQuery,
  onSelect,
  onNew,
  inputName = "buyerName",
  label = "구매자 이름 또는 또래",
  placeholder = "이름·또래 검색 (비워두면 익명)",
  error,
  required,
}: {
  inputName?: string;
  label?: string;
  placeholder?: string;
  error?: string;
  required?: boolean;
  query: string;
  matches: PersonSummary[];
  selected: PersonSummary | null;
  loading: boolean;
  failed: boolean;
  newPerson: boolean;
  onQuery: (query: string) => void;
  onSelect: (person: PersonSummary | null) => void;
  onNew: () => void;
}) {
  const [activeIndex, setActiveIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const optionRefs = useRef<Map<number, HTMLButtonElement>>(new Map());
  const showResults =
    !selected && !newPerson && !loading && !failed && Boolean(query.trim());
  const choose = (index: number) => {
    if (index === matches.length) onNew();
    else if (matches[index]) onSelect(matches[index]);
    setActiveIndex(-1);
  };
  return (
    <>
      <label className="field">
        <span>{label}</span>
        <input
          ref={inputRef}
          name={inputName}
          value={query}
          autoFocus
          required={required ?? newPerson}
          placeholder={placeholder}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${inputName}-error` : undefined}
          data-testid="purchase-person-search"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={showResults}
          aria-controls={showResults ? "purchase-options" : undefined}
          aria-activedescendant={
            showResults && activeIndex >= 0
              ? `purchase-option-${activeIndex}`
              : undefined
          }
          onChange={(event) => {
            setActiveIndex(-1);
            onQuery(event.currentTarget.value);
          }}
          onKeyDown={(event) => {
            if (
              event.nativeEvent.isComposing ||
              event.nativeEvent.keyCode === 229
            ) {
              if (event.key === "Enter") event.preventDefault();
              return;
            }
            if (!showResults) return;
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              const next = listIndexAfterKey(
                matches.length + 1,
                activeIndex,
                event.key === "ArrowDown" ? "down" : "up",
              )!;
              setActiveIndex(next);
              optionRefs.current
                .get(next)
                ?.scrollIntoView({ block: "nearest" });
            } else if (event.key === "Enter") {
              // Searching must not implicitly submit a purchase or link the first match.
              event.preventDefault();
              if (activeIndex >= 0) choose(activeIndex);
            }
          }}
        />
        {error && (
          <span
            id={`${inputName}-error`}
            className="form-error"
            role="alert"
            data-testid={
              inputName === "name" ? "draft-form-error" : "purchase-name-error"
            }
          >
            {error}
          </span>
        )}
      </label>
      {selected ? (
        <div className="purchase-person-selected">
          <span>
            연결할 신청자: <strong>{purchasePersonLabel(selected)}</strong>
          </span>
          <button
            type="button"
            className="text-button"
            onClick={() => {
              setActiveIndex(-1);
              onSelect(null);
              inputRef.current?.focus();
            }}
          >
            선택 해제
          </button>
        </div>
      ) : newPerson ? (
        <div
          className="purchase-person-selected"
          data-testid="new-person-selected"
        >
          <span>
            신규 인원: <strong>{query}</strong>
          </span>
          <button
            type="button"
            className="text-button"
            onClick={() => {
              setActiveIndex(-1);
              onQuery(query);
              inputRef.current?.focus();
              inputRef.current?.select();
            }}
          >
            다시 검색
          </button>
        </div>
      ) : (
        <>
          {failed && (
            <p className="form-error">
              신청자 목록을 불러오지 못했습니다. 창을 닫고 다시 시도해 주세요.
            </p>
          )}
          {loading && (
            <p className="purchase-person-hint">신청자 목록을 불러오는 중…</p>
          )}
          {showResults && (
            <div
              id="purchase-options"
              className="purchase-person-results"
              role="listbox"
              aria-label="구매자 검색 결과"
            >
              {[...matches, null].map((person, index) => (
                <button
                  key={person?.id ?? "new"}
                  id={`purchase-option-${index}`}
                  ref={(element) => {
                    if (element) optionRefs.current.set(index, element);
                    else optionRefs.current.delete(index);
                  }}
                  type="button"
                  tabIndex={-1}
                  role="option"
                  aria-selected={
                    activeIndex >= 0
                      ? activeIndex === index
                      : !person && newPerson
                  }
                  className="purchase-person-result"
                  data-testid={
                    person
                      ? "purchase-person-result"
                      : "purchase-new-person-toggle"
                  }
                  onPointerDown={(event) => {
                    // Keep the search input focused until click, including IME composition
                    // completion in WebKit. Touch scrolling keeps its native focus behavior.
                    if (event.pointerType === "mouse" && event.button === 0)
                      event.preventDefault();
                  }}
                  onClick={() => choose(index)}
                >
                  {person ? (
                    <>
                      <span className="purchase-person-cohort">
                        {person.cohort ?? "--"}
                      </span>
                      <span>{person.name}</span>
                    </>
                  ) : (
                    <span>＋ 신규 인원으로 추가</span>
                  )}
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </>
  );
}
