// Never associate repeated products by position or take the first match.
function productKey(item: any) {
  return String(item?.product_id ?? item?.product?.id ?? item?.salla_product_id ?? "");
}
function skuKey(item: any) {
  return String(item?.sku ?? item?.product?.sku ?? item?.salla_sku ?? "");
}
export function matchSallaItem(item: any, candidates: any[], siblings: any[] = [item]) {
  const id = String(item?.id ?? "");
  const orderItemId = String(item?.item_id ?? "");
  // invoice.items.id identifies an invoice line; item_id identifies its order
  // item. Orders API items expose that latter identifier as id.
  const exact = candidates.filter((entry) => {
    const entryId = String(entry?.id ?? "");
    const entryOrderItemId = String(entry?.item_id ?? "");
    if (orderItemId && entryOrderItemId) return orderItemId === entryOrderItemId;
    if (orderItemId && orderItemId === entryId) return true;
    if (entryOrderItemId && entryOrderItemId === id) return true;
    return !!id && id === entryId;
  });
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return null;
  const sameProduct = (entry: any) =>
    (productKey(item) && productKey(entry) === productKey(item)) ||
    (skuKey(item) && skuKey(entry) === skuKey(item));
  const matches = candidates.filter(sameProduct);
  return matches.length === 1 && siblings.filter(sameProduct).length === 1 ? matches[0] : null;
}

export function mergeSallaOrderItems(base: any[], details: any[]) {
  if (!base.length) return details;
  return base.map((item) => {
    const detail = matchSallaItem(item, details, base);
    // Keep line identity; a replay must not create a second order item.
    return detail ? { ...item, ...detail, id: item.id ?? detail.id,
      // The original invoice description contains submitted buyer inputs;
      // the order API may return no description or catalogue prose instead.
      description: item.description || detail.description,
      product: { ...item.product, ...detail.product } } : item;
  });
}
