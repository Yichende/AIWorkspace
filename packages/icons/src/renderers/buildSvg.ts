import type { IconData } from '../types'

export function buildSvg(
  icon: IconData,
  color: string
) {
  const paths = icon.paths
    .map(
      (path) =>
        `<path d="${path}" fill="${color}" />`
    )
    .join('')

  return `
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="${icon.viewBox}"
  >
    ${paths}
  </svg>
  `
}