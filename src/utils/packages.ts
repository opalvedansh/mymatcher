// The packages a creator can sell, and the price they set for each. Shared by
// the onboarding step, the profile and its edit sheet so all three agree on
// the same types. Mirrors PACKAGE_TYPES and cleanPackages in backend
// profileController.

export type PackageType = 'story' | 'reel' | 'ugc' | 'brand_collab';

/** One of the four packages every creator can pick from. */
export type PresetPackage = {
  type: PackageType;
  /** Whole rupees. */
  price: number;
};

/** A package the creator named and described themselves. */
export type CustomPackage = {
  type: 'custom';
  name: string;
  desc: string | null;
  /** Whole rupees. */
  price: number;
};

export type CreatorPackage = PresetPackage | CustomPackage;

/** A package being picked; the price is null until the creator types one. */
export type PresetDraft = { type: PackageType; price: number | null };
/** `key` only tells drafts apart while editing; it is not saved. */
export type CustomDraft = { type: 'custom'; key: string; name: string; desc: string; price: number | null };
export type PackageDraft = PresetDraft | CustomDraft;

export const MAX_PACKAGE_PRICE = 10_000_000; // ₹1 crore
export const MAX_CUSTOM_PACKAGES = 6;
export const CUSTOM_NAME_MAX = 40;
export const CUSTOM_DESC_MAX = 100;

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

export const isCustomDraft = (draft: PackageDraft): draft is CustomDraft => draft.type === 'custom';

/** Identifies a draft within the list: its type for a preset, its key for a custom one. */
export const draftId = (draft: PackageDraft) => (isCustomDraft(draft) ? draft.key : draft.type);

export function newCustomDraft(): CustomDraft {
  return { type: 'custom', key: `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`, name: '', desc: '', price: null };
}

/** Presets in display order, then custom packages in the order they were added. */
export function orderDrafts(drafts: PackageDraft[]): PackageDraft[] {
  return [
    ...PACKAGE_OPTIONS.flatMap((o) => drafts.filter((d) => d.type === o.type)),
    ...drafts.filter(isCustomDraft),
  ];
}

/**
 * Reads saved packages into drafts. Onboarding drafts from before prices were
 * asked for hold bare type ids; those come back selected with no price, so
 * the creator has to fill it in.
 */
export function toPackageDrafts(saved: unknown): PackageDraft[] {
  if (!Array.isArray(saved)) return [];
  const drafts: PackageDraft[] = [];
  for (const entry of saved) {
    if (entry?.type === 'custom') {
      if (typeof entry.name !== 'string' || drafts.filter(isCustomDraft).length >= MAX_CUSTOM_PACKAGES) continue;
      drafts.push({
        ...newCustomDraft(),
        name: entry.name,
        desc: typeof entry.desc === 'string' ? entry.desc : '',
        price: isValidPrice(entry.price) ? entry.price : null,
      });
      continue;
    }
    const type = typeof entry === 'string' ? entry : entry?.type;
    if (!isPackageType(type) || drafts.some((d) => d.type === type)) continue;
    drafts.push({ type, price: isValidPrice(entry?.price) ? entry.price : null });
  }
  return orderDrafts(drafts);
}

/** Why a draft can't be saved yet, or null when it can. */
export function draftProblem(draft: PackageDraft): 'name' | 'price' | null {
  if (isCustomDraft(draft) && !draft.name.trim()) return 'name';
  if (!isValidPrice(draft.price)) return 'price';
  return null;
}

/** The drafts as packages to save, or null while any picked package is incomplete. */
export function completePackages(drafts: PackageDraft[]): CreatorPackage[] | null {
  if (drafts.length === 0 || drafts.some((d) => draftProblem(d) !== null)) return null;
  return orderDrafts(drafts).map((d) =>
    isCustomDraft(d)
      ? { type: 'custom', name: d.name.trim(), desc: d.desc.trim() || null, price: d.price as number }
      : { type: d.type, price: d.price as number },
  );
}

/** The name and description a package shows on the profile. */
export function describePackage(pkg: CreatorPackage): { name: string; desc: string | null } {
  if (pkg.type === 'custom') return { name: pkg.name, desc: pkg.desc };
  const option = PACKAGE_OPTIONS.find((o) => o.type === pkg.type);
  return { name: option?.name ?? 'Package', desc: option?.desc ?? null };
}

/** ₹12,000 */
export const formatPrice = (price: number) => `₹${String(price).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
