import type { IconData, IconName } from './types'

export const icons: Record<IconName, IconData> = {
  chat: {
    viewBox: '0 0 1024 1024',
    paths: [
      'M512 128C299.97 128 128 272.62 128 451.03c0 95.6 50.34 181.56 130.14 240.59L224 864l176.83-88.41c35.44 8.8 72.85 13.44 111.17 13.44 212.03 0 384-144.62 384-323.03S724.03 128 512 128z'
    ]
  },

  table: {
    viewBox: '0 0 1024 1024',
    paths: [
      'M128 128h768v768H128z'
    ]
  },

  report: {
    viewBox: '0 0 1024 1024',
    paths: [
      'M256 128h384l128 128v640H256z'
    ]
  },

  model: {
    viewBox: '0 0 1024 1024',
    paths: [
      'M512 96l352 192v448L512 928 160 736V288z'
    ]
  },

  arrowRight: {
    viewBox: '0 0 1024 1024',
    paths: [
      'M384 192l256 320-256 320'
    ]
  }
}