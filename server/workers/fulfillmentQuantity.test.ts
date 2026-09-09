import { describe, expect, it } from "vitest";
import type { SmmProductRuleRow } from "../db/smmRulesRepo";
import { resolveQuantityDetailed } from "./fulfillmentWorker";

const rule = {
  quantity_type: "from_field",
  quantity_field: "اختر عدد",
} as SmmProductRuleRow;

describe("Salla order item quantity", () => {
  it.each([
    ["١٬٠٠٠", 1000], ["25,000", 25000], ["2.5K", 2500], ["1.5M", 1500000],
    ["10 ألف", 10000], ["500 لايك", 500], ["100 + 50 لايك", 150],
  ])("retains supported count format %s", (value, expected) => {
    expect(resolveQuantityDetailed(rule, { options: [{ name: "اختر عدد", value }] }, 1).quantity).toBe(expected);
  });
  it("does not read a price from an exact matching option without a selected count", () => {
    expect(() => resolveQuantityDetailed(rule, {
      quantity: 1,
      options: [{ name: "اختر عدد", value: { id: 987, price: { amount: 5000 } } }],
    }, 1)).toThrow("Quantity value missing");
  });

  it("does not square the native line quantity when quantity is explicitly mapped", () => {
    expect(resolveQuantityDetailed({ ...rule, quantity_field: "quantity" }, { quantity: 500 }, 500).quantity).toBe(500);
  });

  it("rejects conflicting selected quantities instead of choosing the largest", () => {
    expect(() => resolveQuantityDetailed(rule, {
      quantity: 1,
      options: [{ name: "اختر عدد", value: [{ name: "1000" }, { name: "5000" }] }],
    }, 1)).toThrow(/Quantity .*ambiguous/);
  });
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

  it("reads a flattened custom quantity field from the complete order item", () => {
    const result = resolveQuantityDetailed(
      rule,
      {
        quantity: 1,
        services: {
          inputs: { "اختر العدد المطلوب": { selected: { name: "10 آلاف" } } },
        },
      },
      1,
    );
    expect(result.quantity).toBe(10000);
  });

  it("reads the selected count when Salla nests the option label separately", () => {
    const result = resolveQuantityDetailed(
      rule,
      {
        quantity: 1,
        custom_fields: [
          {
            option: { id: 715001, name: "اختر عدد" },
            selected_options: [{ id: 815001, name: "1,000 لايك" }],
          },
        ],
      },
      1,
    );

    expect(result.quantity).toBe(1000);
    expect(result.meta.rawType).toBe("salla_order_option");
  });

  it("uses a real native Salla line quantity but never falls back to one", () => {
    expect(resolveQuantityDetailed(rule, { quantity: 500 }, 500).quantity).toBe(500);
    expect(() => resolveQuantityDetailed(rule, { quantity: 1 }, 1)).toThrow("Quantity value missing");
  });
});
