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
  let currentDetail: PersonDetail | null = null;

  function publishSelection(detail: PersonDetail | null) {
    currentDetail = detail;
    onSelection({ selectedId, detail });
  }

  async function select(nextId: string | null, preserveCurrentDetail = false) {
    const requestToken = ++detailRequestToken;
    const canPreserve =
      preserveCurrentDetail && currentDetail?.id === nextId && nextId !== null;
    selectedId = nextId;
    // Keep the previous detail mounted while the next person is loading. The
    // management list is a keyboard-driven surface, so replacing it with the
    // empty state for one render makes Up/Down navigation look like a flicker
    // and can also steal focus from the selected row. A failed request still
    // clears the stale detail in the catch block below.
    if (canPreserve) {
      onSelection({ selectedId, detail: currentDetail });
    } else if (nextId !== null && currentDetail !== null) {
      onSelection({ selectedId, detail: currentDetail });
    } else {
      publishSelection(null);
    }
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
    const previousId = selectedId;
    try {
      const next = await loadManagement(query, includeArchived);
      if (requestToken !== managementRequestToken) return;

      onManagement(next);
      const nextId =
        previousId && next.people.some((person) => person.id === previousId)
          ? previousId
          : (next.people[0]?.id ?? null);
      await select(
        nextId,
        nextId === previousId && currentDetail?.id === previousId,
      );
    } catch (reason) {
      if (requestToken !== managementRequestToken) return;
      if (!currentDetail || currentDetail.id !== selectedId) {
        publishSelection(null);
      }
      onError(reason);
    }
  }

  function invalidate() {
    ++managementRequestToken;
    ++detailRequestToken;
  }

  function cancelPending() {
    ++managementRequestToken;
    ++detailRequestToken;
  }

  return { refresh, select, invalidate, cancelPending };
}
