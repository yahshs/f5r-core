import { describe, expect, it } from "vitest";
import type { SmmProductRuleRow } from "../db/smmRulesRepo";
import { resolveQuantityDetailed } from "./fulfillmentWorker";

const rule = {
  quantity_type: "from_field",
  quantity_field: "اختر عدد",
} as SmmProductRuleRow;

describe("Salla order item quantity", () => {
  it("reads the selected count from the order option even when Salla changes the label", () => {
    const result = resolveQuantityDetailed(
      rule,
      {
        quantity: 1,
        options: [
          {
            id: 69805460,
            name: "العدد المطلوب",
            value: { id: 88112233, name: "5,000 متابع", price: { amount: 10 } },
          },
        ],
      },
      1,
    );
    expect(result.quantity).toBe(5000);
    expect(result.meta.rawType).toBe("salla_order_option");
  });

  it("reads nested selected values from the product order details", () => {
    const result = resolveQuantityDetailed(
      rule,
      {
        quantity: 2,
        product: {
          options: [{ title: "باقة المشاهدات", selected: { value: "2.5K مشاهدة" } }],
        },
      },
      2,
    );
    expect(result.quantity).toBe(5000);
  });

  it("never mistakes an option id or price for the selected count", () => {
    expect(() =>
      resolveQuantityDetailed(
        rule,
        {
          quantity: 1,
          options: [{ id: 69805460, name: "لون التصميم", value: { id: 991122, price: { amount: 5000 } } }],
        },
        1,
      ),
    ).toThrow("Quantity value missing");
  });
});
