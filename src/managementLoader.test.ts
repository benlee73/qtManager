import { describe, expect, it } from "vitest";

import {
  createManagementLoader,
  type ManagementSelection,
} from "./managementLoader";
import type { PeopleManagement, PersonDetail, PersonSummary } from "./phase3";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function person(id: string): PersonSummary {
  return {
    id,
    name: `가상 신청자 ${id}`,
    cohort: "00",
    phone: null,
    status: "정식 등록",
    personNote: null,
    subscriptionCount: 0,
    latestLastIssue: null,
  };
}

function management(...ids: string[]): PeopleManagement {
  return {
    people: ids.map(person),
    draftCount: 0,
    archivedCount: 0,
  };
}

function detail(id: string): PersonDetail {
  return {
    ...person(id),
    subscriptions: [],
    distributions: [],
    checkItems: [],
  };
}

function setup() {
  const detailRequests = new Map<
    string,
    ReturnType<typeof deferred<PersonDetail>>
  >();
  const managementRequests = new Map<
    string,
    ReturnType<typeof deferred<PeopleManagement>>
  >();
  const selections: ManagementSelection[] = [];
  const managementSnapshots: PeopleManagement[] = [];
  const errors: unknown[] = [];
  const loader = createManagementLoader({
    loadManagement: (query) => {
      const request = deferred<PeopleManagement>();
      managementRequests.set(query, request);
      return request.promise;
    },
    loadDetail: (id) => {
      const request = deferred<PersonDetail>();
      detailRequests.set(id, request);
      return request.promise;
    },
    onManagement: (next) => managementSnapshots.push(next),
    onSelection: (next) => selections.push(next),
    onError: (reason) => errors.push(reason),
  });
  return {
    loader,
    detailRequests,
    managementRequests,
    selections,
    managementSnapshots,
    errors,
  };
}

describe("management loader selection/detail consistency", () => {
  it("clears the previous detail immediately and keeps it empty when the current selection fails", async () => {
    const { loader, detailRequests, selections, errors } = setup();

    const selectA = loader.select("person-a");
    detailRequests.get("person-a")!.resolve(detail("person-a"));
    await selectA;

    const selectB = loader.select("person-b");
    expect(selections.at(-1)).toEqual({
      selectedId: "person-b",
      detail: null,
    });

    const failure = new Error("상세 조회 실패");
    detailRequests.get("person-b")!.reject(failure);
    await selectB;

    expect(selections.at(-1)).toEqual({
      selectedId: "person-b",
      detail: null,
    });
    expect(errors).toEqual([failure]);
  });

  it("discards the late A response after selection changes from A to B", async () => {
    const { loader, detailRequests, selections, errors } = setup();

    const selectA = loader.select("person-a");
    const selectB = loader.select("person-b");
    detailRequests.get("person-b")!.resolve(detail("person-b"));
    await selectB;
    detailRequests.get("person-a")!.resolve(detail("person-a"));
    await selectA;

    expect(selections).toEqual([
      { selectedId: "person-a", detail: null },
      { selectedId: "person-b", detail: null },
      { selectedId: "person-b", detail: detail("person-b") },
    ]);
    expect(errors).toEqual([]);
  });

  it("discards an older search response instead of restoring its selection/detail pair", async () => {
    const {
      loader,
      detailRequests,
      managementRequests,
      selections,
      managementSnapshots,
    } = setup();

    const oldSearch = loader.refresh("old", false);
    const newSearch = loader.refresh("new", false);
    managementRequests.get("new")!.resolve(management("person-b"));
    await Promise.resolve();
    detailRequests.get("person-b")!.resolve(detail("person-b"));
    await newSearch;
    managementRequests.get("old")!.resolve(management("person-a"));
    await oldSearch;

    expect(managementSnapshots).toEqual([management("person-b")]);
    expect(selections.at(-1)).toEqual({
      selectedId: "person-b",
      detail: detail("person-b"),
    });
  });

  it("rejects a detail payload whose person does not match the current selection", async () => {
    const { loader, detailRequests, selections, errors } = setup();

    const selection = loader.select("person-b");
    detailRequests.get("person-b")!.resolve(detail("person-a"));
    await selection;

    expect(selections.at(-1)).toEqual({
      selectedId: "person-b",
      detail: null,
    });
    expect(errors).toHaveLength(1);
    expect(String(errors[0])).toContain("person-b");
  });
});
