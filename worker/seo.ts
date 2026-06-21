/**
 * Edge SEO injection for the public web build.
 *
 * The app builds as a SPA (`web.output: 'single'`), where Expo ignores app/+html.tsx's <head> meta.
 * So the Worker is the single source of crawler- and social-scraper-facing <head> tags: it rewrites
 * the served index.html via HTMLRewriter, replacing the bare <title> and appending description,
 * keywords, Open Graph, Twitter, canonical, theme-color, and JSON-LD. This is the SEO that search
 * engines and link-preview scrapers (iMessage/Slack/Facebook/X) actually read — they don't run the
 * app's JS. Edit copy HERE.
 */
const SITE = 'https://manyhandz.io'
const TITLE = 'ManyHandz — Chore charts, fairness & rewards for families & roommates'
const DESCRIPTION =
  'The chore app that finally feels fair. Assign and auto-rotate chores, see exactly who pulls their weight with effort-weighted fairness scoring, photo-verify what got done, and gamify it for the kids. One app for families and roommates — 14-day free trial, no credit card.'
const KEYWORDS =
  'chore app, chore chart, family chores, roommate chores, chore tracker, fairness, allowance app, kids chores, household tasks, chore rotation, task reminders, split chores, who does more, chore wheel, settle up'
const OG_IMAGE = `${SITE}/og-image.jpg`

const JSON_LD = JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: 'ManyHandz',
  applicationCategory: 'LifestyleApplication',
  operatingSystem: 'iOS, Android, Web',
  description: DESCRIPTION,
  url: SITE,
  image: OG_IMAGE,
  offers: {
    '@type': 'Offer',
    price: '9.99',
    priceCurrency: 'USD',
    description: '14-day free trial, then $9.99/month or $99.99/year',
  },
})

/** Escape a string for safe use inside a double-quoted HTML attribute. */
const attr = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const HEAD_TAGS = [
  `<meta name="description" content="${attr(DESCRIPTION)}">`,
  `<meta name="keywords" content="${attr(KEYWORDS)}">`,
  `<meta name="theme-color" content="#FF6B4A">`,
  `<link rel="canonical" href="${SITE}">`,
  `<meta property="og:type" content="website">`,
  `<meta property="og:site_name" content="ManyHandz">`,
  `<meta property="og:title" content="${attr(TITLE)}">`,
  `<meta property="og:description" content="${attr(DESCRIPTION)}">`,
  `<meta property="og:url" content="${SITE}">`,
  `<meta property="og:image" content="${OG_IMAGE}">`,
  `<meta property="og:image:width" content="1200">`,
  `<meta property="og:image:height" content="630">`,
  `<meta name="twitter:card" content="summary_large_image">`,
  `<meta name="twitter:title" content="${attr(TITLE)}">`,
  `<meta name="twitter:description" content="${attr(DESCRIPTION)}">`,
  `<meta name="twitter:image" content="${OG_IMAGE}">`,
  // JSON.stringify can't emit "</script>" for our fixed payload, but guard anyway.
  `<script type="application/ld+json">${JSON_LD.replace(/</g, '\\u003c')}</script>`,
].join('')

/** Rewrite the served index.html <head> with the app's SEO tags. Call only on text/html responses. */
export function injectSeo(res: Response): Response {
  return new HTMLRewriter()
    .on('title', {
      element(el) {
        el.setInnerContent(TITLE)
      },
    })
    .on('head', {
      element(el) {
        el.append(HEAD_TAGS, { html: true })
      },
    })
    .transform(res)
}
