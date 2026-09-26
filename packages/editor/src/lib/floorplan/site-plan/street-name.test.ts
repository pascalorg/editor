import { describe, expect, test } from 'bun:test'
import { parseStreetName, sameStreet } from './street-name'

describe('parseStreetName (USPS Pub. 28)', () => {
  test('the number dropped, the directional and the type standardised', () => {
    expect(parseStreetName('4121 NW 34th St')).toEqual({
      pre: 'nw',
      name: '34th',
      type: 'st',
      post: '',
    })
    expect(parseStreetName('Northwest 34th Terrace')).toEqual({
      pre: 'nw',
      name: '34th',
      type: 'ter',
      post: '',
    })
    expect(parseStreetName('N.W. 34th Terr.')).toEqual({
      pre: 'nw',
      name: '34th',
      type: 'ter',
      post: '',
    })
    expect(parseStreetName('2715 LAKE HUNTER DR')).toEqual({
      pre: '',
      name: 'lake hunter',
      type: 'dr',
      post: '',
    })
    expect(parseStreetName('100 1st Ave N')).toEqual({
      pre: '',
      name: '1st',
      type: 'ave',
      post: 'n',
    })
    expect(parseStreetName('Del Prado Boulevard South').type).toBe('blvd')
    expect(parseStreetName('Pine Island Pkwy').type).toBe('pkwy')
    expect(parseStreetName('Old Dixie Highway').type).toBe('hwy')
  })

  test('a word is only a type or a directional when a name is left beside it', () => {
    expect(parseStreetName('North St')).toEqual({ pre: '', name: 'north', type: 'st', post: '' })
    expect(parseStreetName('Broadway')).toEqual({ pre: '', name: 'broadway', type: '', post: '' })
    expect(parseStreetName('')).toEqual({ pre: '', name: '', type: '', post: '' })
  })
})

describe('sameStreet', () => {
  test('abbreviated and spelled-out lines of one street match', () => {
    expect(sameStreet('4121 NW 34th St', 'Northwest 34th Street')).toBe(true)
    expect(sameStreet('1247 NE 109th St', 'Northeast 109th Street')).toBe(true)
    expect(sameStreet('2600 Castro Way', 'Castro Way')).toBe(true)
    expect(sameStreet('44 Oak Cir', 'Oak Circle')).toBe(true)
    expect(sameStreet('9 Elm Ct', 'Elm Court')).toBe(true)
  })

  test('a different street type or quadrant is a different street', () => {
    expect(sameStreet('4121 NW 34th St', 'Northwest 34th Terrace')).toBe(false)
    expect(sameStreet('4121 NW 34th St', 'Southwest 34th Street')).toBe(false)
    expect(sameStreet('12 Oak Ln', 'Oak Place')).toBe(false)
    expect(sameStreet('12 Oak Rd', 'Oak Road')).toBe(true)
  })

  test('a line that leaves the type or the directional out does not rule a street out', () => {
    expect(sameStreet('S Castro', 'Castro Way')).toBe(true)
    expect(sameStreet('4121 NW 34th St', '34th Street')).toBe(true)
    expect(sameStreet('', 'Castro Way')).toBe(false)
  })
})
