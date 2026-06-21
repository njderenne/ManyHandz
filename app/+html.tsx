import { ScrollViewStyleReset } from 'expo-router/html'
import type { PropsWithChildren } from 'react'

/**
 * Web-only HTML shell (Expo Router renders this around every web route; native ignores it).
 *
 * The critical piece is <ScrollViewStyleReset/>: React Native Web's root ScrollView assumes the
 * body never scrolls, so without this reset the page either double-scrolls or freezes. It also
 * sets `lang`, the responsive `viewport` meta, and a dark `background-color` so first paint matches
 * the app's dark theme instead of flashing white. Keep this minimal and static — it runs in Node
 * at build/SSG time, so it must not use hooks, browser globals, or app state.
 *
 * NOTE: this app builds with `web.output: 'single'` (SPA), where Expo IGNORES this file's <head> for
 * meta — so SEO tags (title, description, Open Graph, JSON-LD) are injected at the edge by the Worker
 * via worker/seo.ts (it HTMLRewrites the served index.html). Put SEO changes THERE, not here.
 *
 * See: https://docs.expo.dev/router/reference/static-rendering/#root-html
 */
export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, shrink-to-fit=no"
        />

        {/*
          Disable body scrolling on web so the root ScrollView owns scroll (prevents the
          double-scroll/freeze). Remove if you want the body to scroll instead.
        */}
        <ScrollViewStyleReset />

        {/* Match the app's dark background so there's no white flash before React mounts. */}
        <style dangerouslySetInnerHTML={{ __html: responsiveBackground }} />
      </head>
      <body>{children}</body>
    </html>
  )
}

const responsiveBackground = `
body {
  background-color: #0a0e1a;
}
@media (prefers-color-scheme: light) {
  body {
    background-color: #ffffff;
  }
}`
