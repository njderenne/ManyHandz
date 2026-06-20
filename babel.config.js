module.exports = function (api) {
  api.cache(true)
  return {
    presets: [
      ['babel-preset-expo', { jsxImportSource: 'nativewind' }],
      'nativewind/babel',
    ],
    // react-native-worklets powers Reanimated v4 — its plugin must be listed last.
    plugins: ['react-native-worklets/plugin'],
  }
}
