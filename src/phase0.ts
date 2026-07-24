import { invoke } from "@tauri-apps/api/core";

export interface Phase0Report {
  database: string;
  xlsx: string;
  formatVersion: number;
  verifiedRows: number;
}

export function runPhase0Probe(): Promise<Phase0Report> {
  return invoke<Phase0Report>("run_phase0_probe");
}
