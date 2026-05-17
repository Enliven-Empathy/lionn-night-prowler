/**
 * Player skin catalogue. Skins are color overrides on the player's
 * Rectangle visuals — the underlying body / physics / movement / FX
 * code is identical. Each SkinDef defines:
 *
 *   - bodyFill / bodyStroke — idle player rectangle
 *   - dashFill              — player rectangle while dashing
 *   - trailFill             — dash afterimage rectangles
 *
 * Switching skins doesn't change gameplay; it's pure cosmetic so the
 * kid can express preference + collect more skins over time. Skin
 * choice persists per UserProfile (UserStore.selectedSkinId).
 *
 * Adding a new skin = one entry here + (optionally) a way for the kid
 * to unlock it. For v1 every skin is unlocked from the start.
 */

export interface SkinDef {
  /** Stable id, used as the key in UserProfile.selectedSkinId.
   *  Never rename. */
  id: string;
  /** Display name in the picker. */
  name: string;
  /** Short pitch shown under the preview. */
  description: string;
  /** Body fill colour while idle. */
  bodyFill: number;
  /** Stroke / outline colour. */
  bodyStroke: number;
  /** Body fill colour while dashing — usually a brighter take of fill. */
  dashFill: number;
  /** Dash-trail rectangle colour. */
  trailFill: number;
}

export const SKIN_DEFAULT_ID = 'lionn';

export const SKINS: SkinDef[] = [
  {
    id: 'lionn',
    name: 'Lionn',
    description: 'The classic night prowler. Violet shadow.',
    bodyFill: 0x6a3fbe,
    bodyStroke: 0xb47bff,
    dashFill: 0xb47bff,
    trailFill: 0xb47bff,
  },
  {
    id: 'iron_walker',
    name: 'Iron Walker',
    description: 'Armoured. Heavier than they look.',
    bodyFill: 0x4a4854,    // dark steel
    bodyStroke: 0xa07840,  // copper / brass trim
    dashFill: 0x8a8590,    // brighter steel when dashing
    trailFill: 0x6a6878,
  },
];

/** Find a skin by id; falls back to the default (Lionn) if the id is
 *  unknown — e.g., a save from a future version that knows skins this
 *  build doesn't. Never returns null. */
export function getSkin(id: string | undefined | null): SkinDef {
  if (!id) return SKINS[0];
  return SKINS.find((s) => s.id === id) ?? SKINS[0];
}
