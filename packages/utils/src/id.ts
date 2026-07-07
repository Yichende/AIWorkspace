/**
 * Simple client-side ID generator.
 * Format: {timestamp}-{counter}-{random6}
 *
 * Not cryptographically secure — sufficient for client-generated
 * unique IDs within a single user session.
 */

let counter = 0

export function generateId(): string {
  counter++
  return `${Date.now()}-${counter}-${Math.random().toString(36).slice(2, 8)}`
}
