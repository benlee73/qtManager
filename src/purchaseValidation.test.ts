import { describe, expect, it } from "vitest";
import { validatePurchaseInput } from "./purchaseValidation";
const input = {
  buyerName: "가상",
  purchaseCohort: "",
  purchasePhone: "",
  quantity: 1,
};
describe("한 호 신청 한국어 검증", () => {
  it("allows optional cohort and phone, leading zero cohorts and anonymous purchases", () => {
    expect(validatePurchaseInput(input, true)).toEqual({});
    expect(
      validatePurchaseInput(
        { ...input, purchaseCohort: "00", purchasePhone: "010-0000-0000" },
        true,
      ),
    ).toEqual({});
    expect(validatePurchaseInput({ ...input, buyerName: "" }, false)).toEqual(
      {},
    );
  });
  it("reports required name, incomplete cohort, invalid phone and quantity in Korean", () => {
    expect(
      validatePurchaseInput(
        {
          ...input,
          buyerName: " ",
          purchaseCohort: "1",
          purchasePhone: "111-1111-1111",
          quantity: 0,
        },
        true,
      ),
    ).toEqual({
      buyerName: "이름을 입력하세요.",
      purchaseCohort: "또래는 두 자리 숫자만 입력할 수 있습니다.",
      purchasePhone: "연락처는 010-xxxx-xxxx 형식으로 입력하세요.",
      quantity: "수량은 1권 이상 입력하세요.",
    });
  });
});
