import { describe, expect, it } from "vitest";
import { resolveTarget } from "./fulfillmentWorker";
import { buildTargetJson, extractOrder } from "./sallaWebhookWorker";

const linkRule = {
  target_field: "link",
  normalize_url: 1,
  service_name: "TikTok views",
} as any;

describe("Salla invoice payload extraction", () => {
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

  it("recovers a link from existing stored item JSON without extraction metadata", () => {
    const link = "https://www.instagram.com/p/example/";
    const stored = { selections: [{ submitted: { answer: link } }] };
    expect(resolveTarget(linkRule, stored)).toBe(link);
  });
});
