import type { ImageSourcePropType } from 'react-native'

/**
 * Marketing imagery — generated brand assets for the public-facing surfaces (landing hero, the three
 * feature cards, and the closing CTA today; share cards + onboarding/empty-state art as the set grows).
 *
 * Every slot is `null` in the template, so screens fall back to their branded placeholders out of the
 * box (hero → gradient block; feature cards → icon + text; CTA → gradient banner). The factory image
 * pipeline — `builder/assets/generate-marketing.js` — generates per-app assets with Grok Imagine
 * (xAI), crops them to each slot's aspect with sharp, drops them into `assets/images/marketing/`, and
 * flips the matching slot below from `null` to a `require()`. No screen edits, ever.
 *
 * This file is per-app config (like APP_CONFIG): a minted app pointing these at its own assets is
 * expected, not drift — the screen code that reads them stays byte-identical to the template.
 *
 * To wire a slot by hand: drop the file in `assets/images/marketing/` and swap `null` for a require().
 */
export const MARKETING: {
  /** Landing hero, 16:9. The hero panel; `null` falls back to the gradient placeholder. */
  heroImage: ImageSourcePropType | null
  /** Feature cards (3), square. When set, each card becomes a photo with its title + body overlaid on a
   *  dark scrim; `null` falls back to the icon + text card. */
  feature1Image: ImageSourcePropType | null
  feature2Image: ImageSourcePropType | null
  feature3Image: ImageSourcePropType | null
  /** Closing CTA, 16:9. When set, the CTA becomes a photo banner with the headline + button overlaid;
   *  `null` falls back to the brand-gradient banner. */
  ctaImage: ImageSourcePropType | null
} = {
  heroImage: require('../../../assets/images/marketing/hero.jpg'),
  feature1Image: require('../../../assets/images/marketing/feature-1.jpg'),
  feature2Image: require('../../../assets/images/marketing/feature-2.jpg'),
  feature3Image: require('../../../assets/images/marketing/feature-3.jpg'),
  ctaImage: require('../../../assets/images/marketing/cta.jpg'),
  // Set by `generate-marketing.js --slot <hero|feature1|feature2|feature3|cta>`, e.g.:
  // heroImage: require('../../../assets/images/marketing/hero.jpg'),
}
