import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";

export type StateCounts = {
  people: number;
  subscriptions: number;
  distributions: number;
  purchases: number;
  checkItems: number;
  pinnedNotes: number;
  changes: number;
};

export type PersonConflict = {
  incomingPersonId: string;
  incomingName: string;
  incomingCohort: string | null;
  incomingPhone: string | null;
  existingPersonId: string;
  existingName: string;
  existingCohort: string | null;
  existingPhone: string | null;
};

export type ImportPreview = {
  formatVersion: number;
  appVersion: string;
  createdAt: string;
  counts: StateCounts;
  addCount: number;
  updateCount: number;
  keepCount: number;
  personConflicts: PersonConflict[];
  clockSkewWarning: boolean;
};

export type RestorePoint = {
  id: string;
  sourceFileName: string;
  createdAt: string;
  snapshotPath: string;
};

export type PersonResolution =
  | { keep_separate: { incoming_person_id: string } }
  | {
      link_to_existing: {
        incoming_person_id: string;
        existing_person_id: string;
      };
    };

export async function chooseExportPath() {
  return save({
    title: "전체 상태 XLSX 내보내기",
    defaultPath: defaultExportName(new Date()),
    filters: [{ name: "Excel 통합 문서", extensions: ["xlsx"] }],
  });
}

export async function chooseImportPath() {
  const selected = await open({
    title: "전체 상태 XLSX 가져오기",
    multiple: false,
    directory: false,
    filters: [{ name: "Excel 통합 문서", extensions: ["xlsx"] }],
  });
  return typeof selected === "string" ? selected : null;
}

export function exportState(path: string) {
  return invoke<StateCounts>("export_state_command", { path });
}

export function previewStateImport(path: string) {
  return invoke<ImportPreview>("preview_state_import_command", { path });
}

export function applyStateImport(
  sourcePath: string,
  mode: "replace" | "merge",
  personResolutions: PersonResolution[],
) {
  return invoke<StateCounts>("apply_state_import_command", {
    sourcePath,
    sourceFileName: fileName(sourcePath),
    mode,
    personResolutions,
  });
}

export function latestRestorePoint() {
  return invoke<RestorePoint | null>("latest_restore_point_command");
}

export function undoStateImport() {
  return invoke<RestorePoint>("undo_state_import_command");
}

export function defaultExportName(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year} 청년부 QT배부현황_${year}${month}${day}.xlsx`;
}

function fileName(path: string) {
  return path.split(/[\\/]/).pop() || "인수인계.xlsx";
}
