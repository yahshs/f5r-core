// Never associate repeated products by position or take the first match.
function productKey(item: any) {
  return String(item?.product_id ?? item?.product?.id ?? item?.salla_product_id ?? "");
}
function skuKey(item: any) {
  return String(item?.sku ?? item?.product?.sku ?? item?.salla_sku ?? "");
}
export function matchSallaItem(item: any, candidates: any[], siblings: any[] = [item]) {
  const id = String(item?.id ?? "");
  const exact = id ? candidates.filter((entry) => String(entry?.id ?? "") === id) : [];
  if (exact.length === 1) return exact[0];
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
      product: { ...item.product, ...detail.product } } : item;
  });
}
