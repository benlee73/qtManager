import { invoke } from "@tauri-apps/api/core";

export type ColumnMapping = {
  submittedAt: number | null;
  name: number;
  cohort: number;
  phone: number;
  startIssue: number;
  quantity: number;
};

export type ApplicationPreviewRow = {
  rowNumber: number;
  submittedAt: string | null;
  name: string | null;
  cohort: string | null;
  phone: string | null;
  issueYear: number | null;
  issueMonth: number | null;
  issueLabel: string | null;
  quantity: number | null;
  fingerprint: string | null;
  status: "ready" | "candidate" | "already_imported" | "error";
  message: string;
  candidates: {
    personId: string;
    name: string;
    cohort: string | null;
    phoneSuffix: string | null;
  }[];
};

export type ApplicationsPreview = {
  rows: ApplicationPreviewRow[];
  detectedMapping: ColumnMapping | null;
  needsMapping: boolean;
  ignoredPaymentColumn: boolean;
  readyCount: number;
  warningCount: number;
  errorCount: number;
};

export function previewApplications(
  text: string,
  defaultIssueYear: number,
  mapping?: ColumnMapping,
) {
  return invoke<ApplicationsPreview>("preview_applications_command", {
    request: {
      text,
      defaultIssueYear,
      mapping: mapping ? toZeroBased(mapping) : null,
    },
  });
}

export function importApplications(
  rows: {
    row: ApplicationPreviewRow;
    existingPersonId: string | null;
    createAsNew: boolean;
  }[],
) {
  return invoke<{
    importedCount: number;
    newPeopleCount: number;
    existingPeopleCount: number;
  }>("import_applications_command", {
    request: {
      rows: rows.map(({ row, existingPersonId, createAsNew }) => ({
        rowNumber: row.rowNumber,
        submittedAt: row.submittedAt,
        name: row.name,
        cohort: row.cohort,
        phone: row.phone,
        issueYear: row.issueYear,
        issueMonth: row.issueMonth,
        quantity: row.quantity,
        fingerprint: row.fingerprint,
        existingPersonId,
        createAsNew,
      })),
    },
  });
}

function toZeroBased(mapping: ColumnMapping): ColumnMapping {
  return {
    submittedAt: mapping.submittedAt ? mapping.submittedAt - 1 : null,
    name: mapping.name - 1,
    cohort: mapping.cohort - 1,
    phone: mapping.phone - 1,
    startIssue: mapping.startIssue - 1,
    quantity: mapping.quantity - 1,
  };
}
