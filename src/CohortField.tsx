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
  return (
    <div className="cohort-input">
      <input
        aria-label="또래"
        name={name}
        inputMode="numeric"
        maxLength={2}
        pattern="[0-9]{2}"
        placeholder="94"
        defaultValue={value ?? ""}
        disabled={exempt}
        aria-invalid={invalid}
        onChange={onChange}
        onInput={(event) => {
          event.currentTarget.value = event.currentTarget.value
            .replace(/[^0-9]/g, "")
            .slice(0, 2);
        }}
      />
      <label className="cohort-exemption">
        <input
          type="checkbox"
          name="cohortNotApplicable"
          checked={exempt}
          onChange={(event) => {
            setExempt(event.target.checked);
            onChange?.();
          }}
        />
        해당 없음
      </label>
    </div>
  );
}
