const cache = new Map<string, string>()

export function getSvgCache(
  key: string,
  creator: () => string
) {
  const value = cache.get(key)

  if (value) {
    return value
  }

  const newValue = creator()

  cache.set(key, newValue)

  return newValue
}