const cache = new Map<string, string>()

export function getCachedSvg(
  key: string,
  creator: () => string
) {
  const hit = cache.get(key)

  if (hit) {
    return hit
  }

  const value = creator()

  cache.set(key, value)

  return value
}