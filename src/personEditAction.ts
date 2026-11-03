import type { ReversibleAction } from "./actionHistory";
import { type PersonDetail, type PersonInput, updatePerson } from "./phase3";

export function personEditAction(
  person: PersonDetail,
  input: PersonInput,
): ReversibleAction {
  const personId = person.id;
  const previous: PersonInput = {
    name: person.name,
    cohort: person.cohort ?? "",
    cohortNotApplicable: person.cohortNotApplicable ?? false,
    phone: person.phone ?? "",
    personNote: person.personNote ?? "",
  };
  const next = { ...input };
  return {
    description: `${person.name} 정보 수정`,
    undo: () => updatePerson(personId, { ...previous, confirmDuplicate: true }),
    redo: () => updatePerson(personId, { ...next, confirmDuplicate: true }),
  };
}
