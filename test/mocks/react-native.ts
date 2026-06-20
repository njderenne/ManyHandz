/** Minimal react-native stub so framework-free app logic is unit-testable in Node. */
export const Share = { share: async () => ({ action: 'sharedAction' }) }
export const Platform = {
  OS: 'ios' as const,
  select: <T>(o: { ios?: T; android?: T; default?: T }) => o.ios ?? o.default,
}
