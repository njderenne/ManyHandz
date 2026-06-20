const { getDefaultConfig } = require('expo/metro-config')
const { withNativeWind } = require('nativewind/metro')

// Expo's Metro config, wrapped with NativeWind so Tailwind classes compile for RN + web.
const config = getDefaultConfig(__dirname)

// Keep Metro's file watcher out of the Worker's build output: wrangler creates and deletes
// transient bundle dirs under worker/.wrangler (deploy / dry runs), and watching one mid-delete
// crashes the dev server (ENOENT in the watcher). worker/node_modules is a separate dep tree
// Metro never resolves from.
config.resolver.blockList = /worker[\\/](\.wrangler|node_modules)[\\/].*/

module.exports = withNativeWind(config, { input: './global.css' })
