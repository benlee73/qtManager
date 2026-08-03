import type { PeopleManagement, PersonDetail } from "./phase3";

export type ManagementSelection = {
  selectedId: string | null;
  detail: PersonDetail | null;
};

type ManagementLoaderDependencies = {
  loadManagement: (
    query: string,
    includeArchived: boolean,
  ) => Promise<PeopleManagement>;
  loadDetail: (personId: string) => Promise<PersonDetail>;
  onManagement: (management: PeopleManagement) => void;
  onSelection: (selection: ManagementSelection) => void;
  onError: (reason: unknown) => void;
};

export function createManagementLoader({
  loadManagement,
  loadDetail,
  onManagement,
  onSelection,
  onError,
}: ManagementLoaderDependencies) {
  let managementRequestToken = 0;
  let detailRequestToken = 0;
  let selectedId: string | null = null;

  function publishSelection(detail: PersonDetail | null) {
    onSelection({ selectedId, detail });
  }

  async function select(nextId: string | null) {
    const requestToken = ++detailRequestToken;
    selectedId = nextId;
    publishSelection(null);
    if (!nextId) return;

    try {
      const nextDetail = await loadDetail(nextId);
      if (requestToken !== detailRequestToken || selectedId !== nextId) {
        return;
      }
      if (nextDetail.id !== nextId) {
        throw new Error(`신청자 상세 응답이 현재 선택(${nextId})과 다릅니다.`);
      }
      publishSelection(nextDetail);
    } catch (reason) {
      if (requestToken !== detailRequestToken || selectedId !== nextId) {
        return;
      }
      publishSelection(null);
      onError(reason);
    }
  }

  async function refresh(query: string, includeArchived: boolean) {
    const requestToken = ++managementRequestToken;
    ++detailRequestToken;
    publishSelection(null);
    try {
      const next = await loadManagement(query, includeArchived);
      if (requestToken !== managementRequestToken) return;

      onManagement(next);
      const nextId =
        selectedId && next.people.some((person) => person.id === selectedId)
          ? selectedId
          : (next.people[0]?.id ?? null);
      await select(nextId);
    } catch (reason) {
      if (requestToken !== managementRequestToken) return;
      publishSelection(null);
      onError(reason);
    }
  }

  function invalidate() {
    ++managementRequestToken;
    ++detailRequestToken;
    publishSelection(null);
  }

  function cancelPending() {
    ++managementRequestToken;
    ++detailRequestToken;
  }

  return { refresh, select, invalidate, cancelPending };
}
