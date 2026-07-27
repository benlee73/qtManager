import { useEffect, useState } from "react";

import {
  type ApplicationPreviewRow,
  type ApplicationsPreview,
  type ColumnMapping,
  importApplications,
  previewApplications,
} from "./applicationImport";

const DEFAULT_MAPPING: ColumnMapping = {
  submittedAt: 1,
  name: 2,
  cohort: 3,
  phone: 4,
  startIssue: 5,
  quantity: 6,
};

export function ApplicationImportDialog({
  issueYear,
  onClose,
  onDirectRegister,
  onImported,
}: {
  issueYear: number;
  onClose: () => void;
  onDirectRegister: () => void;
  onImported: (message: string) => Promise<void>;
}) {
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<ApplicationsPreview | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping>(DEFAULT_MAPPING);
  const [useMapping, setUseMapping] = useState(false);
  const [selected, setSelected] = useState<Record<number, boolean>>({});
  const [decisions, setDecisions] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!text.trim()) {
      setPreview(null);
      return;
    }
    const timeout = window.setTimeout(() => {
      void runPreview();
    }, 180);
    return () => window.clearTimeout(timeout);
    // 열 매핑을 적용할 때만 수동으로 다시 미리보기하므로 입력 중에는 텍스트만 추적한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  async function runPreview(forceMapping = useMapping) {
    setBusy(true);
    setError("");
    try {
      const next = await previewApplications(
        text,
        issueYear,
        forceMapping ? mapping : undefined,
      );
      setPreview(next);
      setSelected(
        Object.fromEntries(
          next.rows.map((row) => [row.rowNumber, row.status === "ready"]),
        ),
      );
      setDecisions({});
      if (next.detectedMapping) setMapping(next.detectedMapping);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    if (!preview) return;
    const rows = preview.rows
      .filter((row) => selected[row.rowNumber])
      .map((row) => ({
        row,
        existingPersonId:
          decisions[row.rowNumber] && decisions[row.rowNumber] !== "__new__"
            ? decisions[row.rowNumber]
            : null,
        createAsNew:
          row.status === "ready" || decisions[row.rowNumber] === "__new__",
      }));
    if (
      rows.some(
        ({ row }) => row.status === "candidate" && !decisions[row.rowNumber],
      )
    ) {
      setError("기존 신청자 후보가 있는 행의 처리 방법을 선택해 주세요.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = await importApplications(rows);
      await onImported(
        `${result.importedCount}건을 추가했습니다. (신규 ${result.newPeopleCount}명, 기존 연결 ${result.existingPeopleCount}명)`,
      );
      onClose();
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }

  const selectedCount = Object.values(selected).filter(Boolean).length;
  return (
    <div className="modal-backdrop" role="presentation">
      <section
        className="dialog import-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="application-import-title"
      >
        <div className="dialog-heading">
          <h2 id="application-import-title">Google 응답 붙여넣기</h2>
          <button type="button" aria-label="닫기" onClick={onClose}>
            ×
          </button>
        </div>
        <p className="dialog-description">
          Google 응답 시트에서 행을 복사해 붙여넣으세요. 제출 시각이 없는 행은
          현재 선택한 {issueYear}년 호로 해석하며, 입금 여부는 저장하지
          않습니다.
        </p>
        <label className="field">
          응답 행
          <textarea
            data-testid="application-paste-input"
            autoFocus
            rows={6}
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder={
              "2026. 2. 1 오후 7:48:08\t홍길동\t95\t010-1234-5678\t1-2월호\t1"
            }
          />
        </label>

        {preview?.needsMapping && (
          <ColumnMappingForm
            mapping={mapping}
            onChange={setMapping}
            onDirectRegister={onDirectRegister}
            onApply={() => {
              setUseMapping(true);
              void runPreview(true);
            }}
          />
        )}

        {preview && !preview.needsMapping && (
          <>
            <div className="import-summary" role="status">
              <span>바로 추가 {preview.readyCount}건</span>
              <span>확인 필요 {preview.warningCount}건</span>
              <span>오류 {preview.errorCount}건</span>
            </div>
            {preview.ignoredPaymentColumn && (
              <p className="payment-notice">
                입금 여부 열은 확인하지 않고 가져오기에서 제외합니다.
              </p>
            )}
            <div className="import-preview" data-testid="application-preview">
              {preview.rows.map((row) => (
                <PreviewRow
                  key={row.rowNumber}
                  row={row}
                  checked={Boolean(selected[row.rowNumber])}
                  decision={decisions[row.rowNumber] ?? ""}
                  onChecked={(checked) =>
                    setSelected((current) => ({
                      ...current,
                      [row.rowNumber]: checked,
                    }))
                  }
                  onDecision={(decision) => {
                    setDecisions((current) => ({
                      ...current,
                      [row.rowNumber]: decision,
                    }));
                    setSelected((current) => ({
                      ...current,
                      [row.rowNumber]: Boolean(decision),
                    }));
                  }}
                />
              ))}
            </div>
          </>
        )}
        {error && <p className="form-error">{error}</p>}
        <button
          className="primary-button submit"
          data-testid="import-applications"
          type="button"
          disabled={
            busy || !preview || preview.needsMapping || selectedCount === 0
          }
          onClick={() => void submit()}
        >
          {busy ? "확인 중…" : `선택한 ${selectedCount}건 추가`}
        </button>
      </section>
    </div>
  );
}

function PreviewRow({
  row,
  checked,
  decision,
  onChecked,
  onDecision,
}: {
  row: ApplicationPreviewRow;
  checked: boolean;
  decision: string;
  onChecked: (checked: boolean) => void;
  onDecision: (decision: string) => void;
}) {
  const selectable = row.status === "ready" || row.status === "candidate";
  return (
    <article className={`import-row ${row.status}`} data-status={row.status}>
      <input
        type="checkbox"
        aria-label={`${row.rowNumber}행 선택`}
        disabled={!selectable}
        checked={checked}
        onChange={(event) => onChecked(event.target.checked)}
      />
      <div>
        <strong>
          {row.rowNumber}행 · {row.cohort ?? "--"} {row.name ?? "이름 없음"}
        </strong>
        <p>
          {row.issueLabel ?? "시작 호 없음"} · {row.quantity ?? 0}권 ·{" "}
          {row.phone ?? "연락처 없음"}
        </p>
        <small>{row.message}</small>
        {row.status === "candidate" && (
          <select
            data-testid={`candidate-decision-${row.rowNumber}`}
            aria-label={`${row.rowNumber}행 처리 방법`}
            value={decision}
            onChange={(event) => onDecision(event.target.value)}
          >
            <option value="">처리 방법 선택</option>
            {row.candidates.map((candidate) => (
              <option key={candidate.personId} value={candidate.personId}>
                기존 {candidate.cohort ?? "--"} {candidate.name} · 끝번호{" "}
                {candidate.phone ?? "없음"}
              </option>
            ))}
            <option value="__new__">동명이인으로 새 신청자 추가</option>
          </select>
        )}
      </div>
    </article>
  );
}

function ColumnMappingForm({
  mapping,
  onChange,
  onDirectRegister,
  onApply,
}: {
  mapping: ColumnMapping;
  onChange: (mapping: ColumnMapping) => void;
  onDirectRegister: () => void;
  onApply: () => void;
}) {
  const fields: [keyof ColumnMapping, string][] = [
    ["submittedAt", "제출 시각(선택)"],
    ["name", "성함"],
    ["cohort", "또래"],
    ["phone", "연락처"],
    ["startIssue", "구독 시작 시점"],
    ["quantity", "수량"],
  ];
  return (
    <div className="mapping-panel">
      <strong>열 순서를 자동으로 찾지 못했습니다.</strong>
      <p>붙여넣은 첫 번째 열을 1로 하여 각 열 번호를 지정하세요.</p>
      <div>
        {fields.map(([key, label]) => (
          <label key={key}>
            {label}
            <input
              type="number"
              min={key === "submittedAt" ? 0 : 1}
              value={mapping[key] ?? 0}
              onChange={(event) =>
                onChange({
                  ...mapping,
                  [key]:
                    key === "submittedAt" && Number(event.target.value) === 0
                      ? null
                      : Number(event.target.value),
                })
              }
            />
          </label>
        ))}
      </div>
      <div className="mapping-actions">
        <button className="secondary-button" type="button" onClick={onApply}>
          열 지정 적용
        </button>
        <button
          className="quiet-button"
          type="button"
          onClick={onDirectRegister}
        >
          QT 신청자 직접 추가
        </button>
      </div>
    </div>
  );
}

function errorMessage(reason: unknown) {
  return reason instanceof Error ? reason.message : String(reason);
}
