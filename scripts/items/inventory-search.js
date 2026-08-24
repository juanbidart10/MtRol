export function normalizeInventorySearchTerm(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLocaleLowerCase("es");
}

export function inventoryItemMatchesSearch(item, searchTerm) {
  const term = normalizeInventorySearchTerm(searchTerm);
  if (!term) return true;
  return normalizeInventorySearchTerm(item?.name).includes(term);
}

export function normalizeInventoryFilter(inventoryView, filter) {
  const validFilters = new Set([
    "all",
    ...(inventoryView?.categoryDefinitions ?? []).map(definition => definition.id)
  ]);
  return validFilters.has(filter) ? filter : "all";
}

export function getFilteredInventoryItems(
  inventoryView,
  { filter = "all", searchTerm = "" } = {}
) {
  const normalizedFilter = normalizeInventoryFilter(inventoryView, filter);
  const source = normalizedFilter === "all"
    ? inventoryView?.items ?? []
    : inventoryView?.categories?.[normalizedFilter] ?? [];

  return source.filter(item => inventoryItemMatchesSearch(item, searchTerm));
}

export function resolveInventoryFilterResult(
  inventoryView,
  { filter = "all", searchTerm = "" } = {}
) {
  const normalizedFilter = normalizeInventoryFilter(inventoryView, filter);
  const term = normalizeInventorySearchTerm(searchTerm);
  const filteredItems = getFilteredInventoryItems(inventoryView, {
    filter: normalizedFilter,
    searchTerm: term
  });

  if (!term || normalizedFilter === "all" || filteredItems.length > 0) {
    return { filter: normalizedFilter, items: filteredItems };
  }

  for (const definition of inventoryView?.categoryDefinitions ?? []) {
    const items = getFilteredInventoryItems(inventoryView, {
      filter: definition.id,
      searchTerm: term
    });
    if (items.length > 0) return { filter: definition.id, items };
  }

  return { filter: normalizedFilter, items: [] };
}
