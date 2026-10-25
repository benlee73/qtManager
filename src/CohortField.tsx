import { useState } from "react";

export function CohortField({
  name = "cohort",
  value,
  notApplicable = false,
  onChange,
  invalid = false,
}: {
  name?: string;
  value?: string | null;
  notApplicable?: boolean;
  onChange?: () => void;
  invalid?: boolean;
}) {
  const [exempt, setExempt] = useState(notApplicable);
  const [cohort, setCohort] = useState(notApplicable ? "" : (value ?? ""));
  return (
    <div className="cohort-input">
      <input
        aria-label="또래"
        name={name}
        inputMode="numeric"
        maxLength={2}
        pattern="[0-9]{2}"
        placeholder="94"
        value={cohort}
        disabled={exempt}
        aria-invalid={invalid}
        onChange={(event) => {
          setCohort(
            event.currentTarget.value.replace(/[^0-9]/g, "").slice(0, 2),
          );
          onChange?.();
        }}
      />
      <label className="cohort-exemption">
        <input
          type="checkbox"
          name="cohortNotApplicable"
          checked={exempt}
          onChange={(event) => {
            setExempt(event.target.checked);
            if (event.target.checked) setCohort("");
            onChange?.();
          }}
        />
        해당 없음
      </label>
    </div>
  );
}
