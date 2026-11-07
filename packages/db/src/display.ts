export type Locale = "bn" | "en";

/** The store's name in `locale`, falling back to the other language if that one is blank. */
export function storeDisplayName(store: { nameBn: string; nameEn: string }, locale: Locale): string {
  const [first, second] = locale === "en" ? [store.nameEn, store.nameBn] : [store.nameBn, store.nameEn];
  return first.trim() || second.trim();
}
