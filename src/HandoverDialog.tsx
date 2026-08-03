import { useEffect, useMemo, useState } from "react";

import {
  type ImportPreview,
  type PersonResolution,
  type RestorePoint,
  applyStateImport,
  chooseExportPath,
  chooseImportPath,
  exportState,
  latestRestorePoint,
  previewStateImport,
  undoStateImport,
} from "./handover";

export function HandoverDialog({
  onClose,
  onChanged,
}: {
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const [sourcePath, setSourcePath] = useState("");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [mode, setMode] = useState<"replace" | "merge">("merge");
  const [resolutions, setResolutions] = useState<
    Record<string, "keep" | "link">
  >({});
  const [restore, setRestore] = useState<RestorePoint | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    void latestRestorePoint()
      .then(setRestore)
      .catch(() => undefined);
  }, []);

  const allResolved = useMemo(
    () =>
      mode === "replace" ||
      !preview?.personConflicts.some(
        (conflict) => !resolutions[conflict.incomingPersonId],
      ),
    [mode, preview, resolutions],
  );

  async function run(work: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }

  async function selectImport() {
    const path = await chooseImportPath();
    if (!path) return;
    setSourcePath(path);
    setPreview(await previewStateImport(path));
    setResolutions({});
    setNotice("");
  }

  async function applyImport() {
    if (!preview) return;
    const personResolutions: PersonResolution[] = preview.personConflicts.map(
      (conflict) =>
        resolutions[conflict.incomingPersonId] === "link"
          ? {
              link_to_existing: {
                incoming_person_id: conflict.incomingPersonId,
                existing_person_id: conflict.existingPersonId,
              },
            }
          : {
              keep_separate: {
                incoming_person_id: conflict.incomingPersonId,
              },
            },
    );
    const counts = await applyStateImport(sourcePath, mode, personResolutions);
    setPreview(null);
    setSourcePath("");
    setNotice(
      `${mode === "replace" ? "교체" : "병합"}를 완료했습니다. 신청자 ${counts.people}명, 구독 ${counts.subscriptions}건을 확인했습니다.`,
    );
    setRestore(await latestRestorePoint());
    await onChanged();
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section
        className="dialog wide handover-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="handover-title"
      >
        <div className="dialog-heading">
          <h2 id="handover-title">데이터 백업·복원</h2>
          <button type="button" aria-label="닫기" onClick={onClose}>
            ×
          </button>
        </div>
        <p className="dialog-description">
          신청자, 구독, 배부와 기록을 XLSX 한 파일로 백업하거나 다른 기기에서
          복원합니다.
        </p>

        <div className="privacy-warning" data-testid="privacy-warning">
          <strong>개인정보 주의</strong>
          <span>
            파일에는 이름과 연락처가 포함됩니다. 안전하게 전달·보관하고
            백업·복원 후 불필요한 사본은 삭제하세요. 파일은 암호화되지 않습니다.
          </span>
        </div>

        <div className="handover-actions">
          <button
            className="secondary-button"
            data-testid="export-state"
            type="button"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const path = await chooseExportPath();
                if (!path) return;
                const counts = await exportState(path);
                setNotice(
                  `내보내기를 완료했습니다. 신청자 ${counts.people}명 · 구독 ${counts.subscriptions}건`,
                );
              })
            }
          >
            전체 상태 내보내기
          </button>
          <button
            className="primary-button"
            data-testid="choose-state-import"
            type="button"
            disabled={busy}
            onClick={() => void run(selectImport)}
          >
            XLSX 가져오기
          </button>
        </div>

        {preview && (
          <section
            className="import-preview"
            data-testid="state-import-preview"
          >
            <div className="preview-metadata">
              <strong>가져오기 미리보기</strong>
              <span>형식 v{preview.formatVersion}</span>
              <span>앱 v{preview.appVersion}</span>
              <time>{displayDate(preview.createdAt)}</time>
            </div>
            <div className="preview-counts">
              <span>신청자 {preview.counts.people}명</span>
              <span>구독 {preview.counts.subscriptions}건</span>
              <span>배부 {preview.counts.distributions}건</span>
              <span>
                기록 {preview.counts.checkItems + preview.counts.pinnedNotes}건
              </span>
            </div>
            <div className="merge-counts">
              추가 {preview.addCount} · 최신값 적용 {preview.updateCount} ·
              현재값 유지 {preview.keepCount}
            </div>
            {preview.clockSkewWarning && (
              <p className="clock-warning">
                이 파일의 생성 시각이 현재 PC보다 24시간 이상 미래입니다. 두
                PC의 시계를 확인하세요.
              </p>
            )}
            <fieldset className="import-mode">
              <legend>현재 데이터 처리 방법</legend>
              <label>
                <input
                  type="radio"
                  name="import-mode"
                  checked={mode === "merge"}
                  onChange={() => setMode("merge")}
                />
                병합 — 양쪽 고유 기록을 보존하고 같은 ID는 최신 수정값 적용
              </label>
              <label>
                <input
                  type="radio"
                  name="import-mode"
                  checked={mode === "replace"}
                  onChange={() => setMode("replace")}
                />
                교체 — 현재 상태를 백업한 뒤 가져온 파일 기준으로 설정
              </label>
            </fieldset>

            {mode === "merge" &&
              preview.personConflicts.map((conflict) => (
                <article
                  className="person-conflict"
                  key={conflict.incomingPersonId}
                >
                  <strong>같은 신청자일 수 있습니다</strong>
                  <div>
                    <span>
                      가져옴: {conflict.incomingCohort ?? "--"}{" "}
                      {conflict.incomingName} · {conflict.incomingPhone}
                    </span>
                    <span>
                      현재: {conflict.existingCohort ?? "--"}{" "}
                      {conflict.existingName} · {conflict.existingPhone}
                    </span>
                  </div>
                  <select
                    aria-label={`${conflict.incomingName} 동일인 처리`}
                    value={resolutions[conflict.incomingPersonId] ?? ""}
                    onChange={(event) =>
                      setResolutions((current) => ({
                        ...current,
                        [conflict.incomingPersonId]: event.target.value as
                          | "keep"
                          | "link",
                      }))
                    }
                  >
                    <option value="">처리 방법 선택</option>
                    <option value="link">현재 신청자와 연결</option>
                    <option value="keep">별도 신청자로 유지</option>
                  </select>
                </article>
              ))}
            <button
              className="primary-button submit"
              data-testid="apply-state-import"
              type="button"
              disabled={busy || !allResolved}
              onClick={() => void run(applyImport)}
            >
              {mode === "replace"
                ? "백업 후 현재 데이터 교체"
                : "백업 후 데이터 병합"}
            </button>
          </section>
        )}

        {restore && !preview && (
          <section className="restore-card" data-testid="restore-point">
            <div>
              <strong>직전 가져오기 되돌리기</strong>
              <span>
                {restore.sourceFileName} · {displayDate(restore.createdAt)}
              </span>
            </div>
            <button
              className="secondary-button"
              data-testid="undo-state-import"
              type="button"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await undoStateImport();
                  setRestore(null);
                  setNotice("가져오기 전 상태로 복구했습니다.");
                  await onChanged();
                })
              }
            >
              가져오기 되돌리기
            </button>
          </section>
        )}

        {(notice || error) && (
          <p
            className={error ? "inline-error" : "inline-success"}
            role="status"
          >
            {error || notice}
          </p>
        )}
      </section>
    </div>
  );
}

function displayDate(value: string) {
  return value.replace("T", " ").slice(0, 16);
}

function errorMessage(reason: unknown) {
  return reason instanceof Error ? reason.message : String(reason);
}
