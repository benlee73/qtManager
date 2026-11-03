import { expect, it, vi } from "vitest";
import type { PersonDetail, PersonInput } from "./phase3";
import { personEditAction } from "./personEditAction";
const { store } = vi.hoisted(() => ({
  store: { value: {} as Record<string, unknown> },
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: async (
    _: string,
    { request }: { request: Record<string, unknown> },
  ) => {
    store.value = { ...request };
  },
}));
const person: PersonDetail = {
  id: "synthetic",
  name: "가상모임",
  cohort: null,
  cohortNotApplicable: true,
  phone: null,
  personNote: "원래 메모",
  status: "정식 등록",
  subscriptions: [],
  distributions: [],
};
it.each([true, false])(
  "restores original cohort exemption %s through undo and the edited state through redo",
  async (exempt) => {
    const before = {
      ...person,
      cohort: exempt ? null : "00",
      cohortNotApplicable: exempt,
    };
    const after: PersonInput = {
      name: "가상수정",
      cohort: exempt ? "94" : "",
      cohortNotApplicable: !exempt,
      phone: "010-0000-0000",
      personNote: "수정 메모",
    };
    const action = personEditAction(before, after);
    await action.undo();
    expect(store.value).toMatchObject({
      personId: before.id,
      name: before.name,
      cohort: before.cohort,
      cohortNotApplicable: exempt,
      phone: null,
      personNote: "원래 메모",
    });
    await action.redo();
    expect(store.value).toMatchObject({
      personId: before.id,
      name: "가상수정",
      cohort: exempt ? "94" : null,
      cohortNotApplicable: !exempt,
      phone: "010-0000-0000",
      personNote: "수정 메모",
    });
  },
);
it("captures values when the action is recorded rather than when undo runs", async () => {
  const before = { ...person };
  const after: PersonInput = {
    name: "기록 당시",
    cohort: "",
    cohortNotApplicable: true,
    phone: "",
  };
  const action = personEditAction(before, after);
  before.cohortNotApplicable = false;
  after.cohortNotApplicable = false;
  after.name = "뒤늦은 변경";
  await action.undo();
  expect(store.value.cohortNotApplicable).toBe(true);
  await action.redo();
  expect(store.value).toMatchObject({
    name: "기록 당시",
    cohortNotApplicable: true,
  });
});
