// The packages a creator can sell, and the price they set for each. Shared by
// the onboarding step, the profile and its edit sheet so all three agree on
// the same types. Mirrors PACKAGE_TYPES in backend profileController.

export type PackageType = 'story' | 'reel' | 'ugc' | 'brand_collab';

export type CreatorPackage = {
  type: PackageType;
  /** Whole rupees. */
  price: number;
};

/** A package being picked; the price is null until the creator types one. */
export type PackageDraft = { type: PackageType; price: number | null };

export const MAX_PACKAGE_PRICE = 10_000_000; // ₹1 crore

export const PACKAGE_OPTIONS: { type: PackageType; name: string; desc: string }[] = [
  { type: 'story', name: 'Story Package', desc: '1 Instagram Story · 24hr visibility' },
  { type: 'reel', name: 'Reel Package', desc: '1 Reel (30-60 sec) · Edited & tagged' },
  { type: 'ugc', name: 'UGC Package', desc: '1 UGC Video · Raw + Edited' },
  { type: 'brand_collab', name: 'Brand Partnership', desc: 'Custom scope, agreed with the brand' },
];

const isPackageType = (value: unknown): value is PackageType =>
  PACKAGE_OPTIONS.some((o) => o.type === value);

const isValidPrice = (price: unknown): price is number =>
  typeof price === 'number' && Number.isInteger(price) && price > 0 && price <= MAX_PACKAGE_PRICE;

/**
 * Reads saved packages into drafts. Onboarding drafts from before prices were
 * asked for hold bare type ids; those come back selected with no price, so
 * the creator has to fill it in.
 */
export function toPackageDrafts(saved: unknown): PackageDraft[] {
  if (!Array.isArray(saved)) return [];
  const drafts: PackageDraft[] = [];
  for (const entry of saved) {
    const type = typeof entry === 'string' ? entry : entry?.type;
    if (!isPackageType(type) || drafts.some((d) => d.type === type)) continue;
    drafts.push({ type, price: isValidPrice(entry?.price) ? entry.price : null });
  }
  return drafts;
}

/** The drafts as packages to save, or null while any picked package lacks a valid price. */
export function completePackages(drafts: PackageDraft[]): CreatorPackage[] | null {
  if (drafts.length === 0 || drafts.some((d) => !isValidPrice(d.price))) return null;
  return drafts.map((d) => ({ type: d.type, price: d.price as number }));
}

/** ₹12,000 */
export const formatPrice = (price: number) => `₹${String(price).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
