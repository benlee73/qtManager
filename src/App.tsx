import { useState } from "react";

import { type Phase0Report, runPhase0Probe } from "./phase0";
import { type Phase1Report, runPhase1Probe } from "./phase1";

type ProbeState =
  | { status: "idle" }
  | { status: "running" }
  | { status: "success"; report: Phase0Report }
  | { status: "error"; message: string };

export default function App() {
  const [probe, setProbe] = useState<ProbeState>({ status: "idle" });
  const [core, setCore] = useState<
    | { status: "idle" }
    | { status: "running" }
    | { status: "success"; report: Phase1Report }
    | { status: "error"; message: string }
  >({ status: "idle" });

  async function handleProbe() {
    setProbe({ status: "running" });
    try {
      const report = await runPhase0Probe();
      setProbe({ status: "success", report });
    } catch (error) {
      setProbe({
        status: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async function handleCoreProbe() {
    setCore({ status: "running" });
    try {
      const report = await runPhase1Probe();
      setCore({ status: "success", report });
    } catch (error) {
      setCore({
        status: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return (
    <main>
      <section className="hero" aria-labelledby="app-title">
        <p className="eyebrow">맑은샘광천교회 청년부</p>
        <h1 id="app-title">QT Manager</h1>
        <p className="summary">
          오프라인 배부 관리를 위한 데스크톱 앱의 기술 기반을 확인하고 있습니다.
        </p>
      </section>

      <section className="probe" aria-labelledby="probe-title">
        <div>
          <h2 id="probe-title">Phase 0 수직 기술 검증</h2>
          <p>
            SQLite 저장과 XLSX 형식 v1 왕복을 실제 Rust 계층에서 실행합니다.
          </p>
        </div>
        <button
          type="button"
          onClick={handleProbe}
          disabled={probe.status === "running"}
        >
          {probe.status === "running" ? "검증 중…" : "기술 검증 실행"}
        </button>

        <div className="result" role="status" aria-live="polite">
          {probe.status === "idle" && "아직 검증하지 않았습니다."}
          {probe.status === "running" && "로컬 임시 데이터로 검증 중입니다."}
          {probe.status === "success" && (
            <>
              <strong>기술 검증 통과</strong>
              <span>
                SQLite {probe.report.database} · XLSX {probe.report.xlsx} · 형식
                v{probe.report.formatVersion} · {probe.report.verifiedRows}행
              </span>
            </>
          )}
          {probe.status === "error" && (
            <>
              <strong>기술 검증 실패</strong>
              <span>{probe.message}</span>
            </>
          )}
        </div>
      </section>

      <section className="probe" aria-labelledby="core-title">
        <div>
          <h2 id="core-title">Phase 1 핵심 도메인·저장 검증</h2>
          <p>
            연간 구독 6개 호, 여러 권 기본 배부, SQLite 스키마와 담당자 변경
            이력을 검증합니다.
          </p>
        </div>
        <button
          type="button"
          data-testid="phase1-probe"
          onClick={handleCoreProbe}
          disabled={core.status === "running"}
        >
          {core.status === "running" ? "검증 중…" : "핵심 흐름 검증"}
        </button>

        <div className="result phase1-result" role="status" aria-live="polite">
          {core.status === "idle" && "아직 검증하지 않았습니다."}
          {core.status === "running" && "익명 핵심 데이터로 검증 중입니다."}
          {core.status === "success" && (
            <>
              <strong>Phase 1 핵심 검증 통과</strong>
              <span>
                DB v{core.report.schemaVersion} ·{" "}
                {core.report.subscriptionStatus} ·{" "}
                {core.report.distributedQuantity}/{core.report.targetQuantity}권{" "}
                {core.report.distributionStatus} · 마지막{" "}
                {core.report.lastIssue} · 변경 이력 {core.report.changeCount}건
              </span>
            </>
          )}
          {core.status === "error" && (
            <>
              <strong>Phase 1 핵심 검증 실패</strong>
              <span>{core.message}</span>
            </>
          )}
        </div>
      </section>
    </main>
  );
}
