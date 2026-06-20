/**
 * Dynamic Expo config — extends app.json and injects per-app secrets from the environment so they
 * never land in committed config.
 *
 * The Google Maps **Android** key is read from GOOGLE_MAPS_API_KEY (set it as an EAS environment
 * variable for builds). It's baked into the native manifest at build time, so Android maps require
 * a rebuild after changing it. iOS uses Apple Maps and needs no key.
 */
module.exports = ({ config }) => ({
  ...config,
  android: {
    ...config.android,
    config: {
      ...(config.android && config.android.config),
      googleMaps: { apiKey: process.env.GOOGLE_MAPS_API_KEY },
    },
  },
})
