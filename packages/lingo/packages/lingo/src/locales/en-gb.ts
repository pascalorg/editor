import type { LocalePack } from '../locale'

export const enGb: LocalePack = {
  locale: 'en-gb',
  aliases: ['en-GB', 'en-IE'],
  extends: 'en',
  defaults: {
    currency: 'GBP',
    system: 'imperial',
  },
  detectionWords: ['stone', 'quid', 'fortnight', 'roundabout'],
  grammar: {
    approximateWords: ['roundabout'],
  },
}

export default enGb
