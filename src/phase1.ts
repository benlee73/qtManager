import { invoke } from "@tauri-apps/api/core";

export interface Phase1Report {
  schemaVersion: number;
  subscriptionStatus: string;
  distributionStatus: string;
  targetQuantity: number;
  distributedQuantity: number;
  lastIssue: string;
  changeCount: number;
}

export function runPhase1Probe(): Promise<Phase1Report> {
  return invoke<Phase1Report>("run_phase1_probe");
}
