import { describe, expect, it } from "vitest";
import { resolveTarget } from "./fulfillmentWorker";
import { buildTargetJson, extractOrder, extractOrderId, mergeOrderDetailsIntoPayload } from "./sallaWebhookWorker";

const linkRule = {
  target_field: "link",
  normalize_url: 1,
  service_name: "TikTok views",
} as any;

describe("Salla invoice payload extraction", () => {
  it("does not let a stale root order mask freshly fetched order items", () => {
    const enriched = mergeOrderDetailsIntoPayload({ order: { id: 81234, items: [{ id: 55, quantity: 1 }] }, data: { order_id: 81234 } },
      { id: 81234, reference_id: 21234, items: [{ id: 55, options: [{ name: "اختر عدد", value: "5000" }] }] });
    expect(extractOrder(enriched).items[0].options[0].value).toBe("5000");
    expect(extractOrderId(enriched)).toBe("21234");
  });
  it("extracts a deeply nested customer link from an invoice item", () => {
    const link = "https://www.tiktok.com/@f5r/video/123";
    const item = {
      id: "item-1",
      product: { id: "product-1" },
      selections: [{ option: { title: "رابط المقطع" }, submitted: { answer: link } }],
    };

    const stored = JSON.parse(buildTargetJson(item));
    expect(stored._f5r.salla_target_url).toBe(link);
    expect(resolveTarget(linkRule, stored)).toBe(link);
  });

  it("reads items and order id from the nested invoice shape", () => {
    const payload = {
      event: "invoice.created",
      data: {
        invoice: {
          order_id: "order-900",
          items: [{ id: "item-1", product_id: "product-1" }],
        },
      },
    };

    const extracted = extractOrder(payload);
    expect(extracted.orderId).toBe("order-900");
    expect(extracted.items).toHaveLength(1);
  });

  it("prefers enriched order items over shortened invoice items", () => {
    const payload = {
      event: "invoice.created",
      data: {
        order_id: "order-901",
        items: [
          {
            id: "short-item",
            product_id: "product-1",
            quantity: 1,
          },
        ],
        order: {
          id: "order-901",
          items: [
            {
              id: "full-item",
              product_id: "product-1",
              quantity: 1,
              options: [{ name: "اختر عدد", value: { name: "5000" } }],
            },
          ],
        },
      },
    };

    const extracted = extractOrder(payload);
    expect(extracted.items).toHaveLength(1);
    expect(extracted.items[0].id).toBe("full-item");
    expect(extracted.items[0].options[0].value.name).toBe("5000");
  });

  it("prefers the merchant-visible Salla order reference over internal ids", () => {
    const payload = {
      event: "invoice.created",
      data: {
        id: 873456789,
        order_id: 812345678,
        order_reference_id: 241770081,
        items: [{ id: "item-1", product_id: "product-1" }],
      },
    };

    expect(extractOrder(payload).orderId).toBe("241770081");
    expect(extractOrderId(payload)).toBe("241770081");
  });

  it("recovers a link from existing stored item JSON without extraction metadata", () => {
    const link = "https://www.instagram.com/p/example/";
    const stored = { selections: [{ submitted: { answer: link } }] };
    expect(resolveTarget(linkRule, stored)).toBe(link);
  });
});
