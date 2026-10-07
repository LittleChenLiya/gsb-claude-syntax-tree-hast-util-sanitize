/**
 * @import {Properties} from 'hast'
 * @import {PropertyDefinition, Schema} from './index.js'
 */

const own = {}.hasOwnProperty

/**
 * Combine two schemas into a tighter one.
 *
 * The result never allows more than `base`: tag names, attributes, and
 * protocols are intersected, so `tightening` can only narrow what `base`
 * allows and can never re-allow things that `base` forbids.
 *
 * Fixed value allow lists in attribute definitions (such as
 * `['type', 'checkbox', 'radio']`) are intersected too.
 * Conflicts that cannot be expressed as a schema (such as two fixed value
 * lists that do not overlap, or two different regular expressions for one
 * attribute) are rejected by throwing an error.
 *
 * Fields that `tightening` does not mention are copied from `base`.
 * The result can be passed to `sanitize` like any other schema.
 *
 * @param {Readonly<Schema>} base
 *   Base schema.
 * @param {Readonly<Schema>} tightening
 *   Schema that may only narrow `base`.
 * @returns {Schema}
 *   New schema that is never wider than `base`.
 */
export function tightenSchema(base, tightening) {
  if (!base || typeof base !== 'object') {
    throw new TypeError('Cannot tighten schema: `base` must be a schema')
  }

  if (!tightening || typeof tightening !== 'object') {
    throw new TypeError('Cannot tighten schema: `tightening` must be a schema')
  }

  /** @type {Schema} */
  const result = {...base}

  // Booleans can only be turned off, never back on.
  if (
    tightening.allowComments !== undefined &&
    tightening.allowComments !== null
  ) {
    result.allowComments = Boolean(
      base.allowComments && tightening.allowComments
    )
  }

  if (
    tightening.allowDoctypes !== undefined &&
    tightening.allowDoctypes !== null
  ) {
    result.allowDoctypes = Boolean(
      base.allowDoctypes && tightening.allowDoctypes
    )
  }

  if (tightening.tagNames) {
    result.tagNames = base.tagNames
      ? base.tagNames.filter((name) => tightening.tagNames.includes(name))
      : [...tightening.tagNames]
  }

  if (tightening.attributes) {
    result.attributes = tightenAttributes(base.attributes, tightening.attributes)
  }

  if (tightening.protocols) {
    result.protocols = tightenProtocols(base.protocols, tightening.protocols)
  }

  // Stripping more is tighter.
  if (tightening.strip) {
    result.strip = base.strip
      ? [...new Set([...base.strip, ...tightening.strip])]
      : [...tightening.strip]
  }

  // Clobbering more is tighter.
  if (tightening.clobber) {
    result.clobber = base.clobber
      ? [...new Set([...base.clobber, ...tightening.clobber])]
      : [...tightening.clobber]
  }

  if (
    tightening.clobberPrefix !== undefined &&
    tightening.clobberPrefix !== null
  ) {
    result.clobberPrefix = tightening.clobberPrefix
  }

  // Requiring ancestors is tighter: intersect the allowed ancestors.
  if (tightening.ancestors) {
    /** @type {Record<string, Array<string>>} */
    const ancestors = {...base.ancestors}

    for (const name in tightening.ancestors) {
      if (own.call(tightening.ancestors, name)) {
        const tight = tightening.ancestors[name]
        const wide = ancestors[name]
        ancestors[name] = wide
          ? wide.filter((ancestor) => tight.includes(ancestor))
          : [...tight]
      }
    }

    result.ancestors = ancestors
  }

  // Required properties are defaults, not allowances: merge per tag.
  if (tightening.required) {
    /** @type {Record<string, Record<string, Properties[keyof Properties]>>} */
    const required = {...base.required}

    for (const name in tightening.required) {
      if (own.call(tightening.required, name)) {
        required[name] = {...required[name], ...tightening.required[name]}
      }
    }

    result.required = required
  }

  return result
}

/**
 * Intersect two attribute maps.
 *
 * @param {Record<string, Array<PropertyDefinition>> | null | undefined} base
 *   Base attribute map.
 * @param {Record<string, Array<PropertyDefinition>>} tightening
 *   Tightening attribute map.
 * @returns {Record<string, Array<PropertyDefinition>>}
 *   Attribute map never wider than `base`.
 */
function tightenAttributes(base, tightening) {
  /** @type {Record<string, Array<PropertyDefinition>>} */
  const result = {}

  if (base) {
    for (const tagName in base) {
      if (own.call(base, tagName)) {
        result[tagName] = own.call(tightening, tagName)
          ? intersectDefinitions(base[tagName], tightening[tagName], tagName)
          : [...base[tagName]]
      }
    }
  }

  // Tags only in `tightening`: `base` allows nothing specific there, so
  // intersect with the generic `'*'` definitions of `base` (if any).
  // Without a `base` map, nothing was restricted and `tightening` wins.
  for (const tagName in tightening) {
    if (own.call(tightening, tagName) && !(base && own.call(base, tagName))) {
      if (!base) {
        result[tagName] = [...tightening[tagName]]
      } else if (own.call(base, '*')) {
        result[tagName] = intersectDefinitions(
          base['*'],
          tightening[tagName],
          tagName
        )
      }
      // Else: `base` allows no attributes on this tag; nothing to add.
    }
  }

  return result
}

/**
 * Intersect two lists of property definitions.
 *
 * Properties missing from either list are dropped: a property that `base`
 * does not allow cannot be re-allowed, and a property that `tightening`
 * does not mention is narrowed away.
 *
 * @param {Readonly<Array<PropertyDefinition>>} base
 *   Base definitions.
 * @param {Readonly<Array<PropertyDefinition>>} tightening
 *   Tightening definitions.
 * @param {string} tagName
 *   Tag name these definitions apply to (for error messages).
 * @returns {Array<PropertyDefinition>}
 *   Intersected definitions.
 */
function intersectDefinitions(base, tightening, tagName) {
  /** @type {Array<PropertyDefinition>} */
  const result = []

  for (const tightEntry of tightening) {
    const name = typeof tightEntry === 'string' ? tightEntry : tightEntry[0]
    const baseEntry = findByName(base, name)

    // `base` does not allow this property: it cannot be re-allowed.
    if (baseEntry === undefined) continue

    result.push(intersectEntry(baseEntry, tightEntry, tagName, name))
  }

  return result
}

/**
 * Intersect two definitions of one property.
 *
 * @param {Readonly<PropertyDefinition>} baseEntry
 *   Base definition.
 * @param {Readonly<PropertyDefinition>} tightEntry
 *   Tightening definition.
 * @param {string} tagName
 *   Tag name (for error messages).
 * @param {string} name
 *   Property name (for error messages).
 * @returns {PropertyDefinition}
 *   Intersected definition.
 */
function intersectEntry(baseEntry, tightEntry, tagName, name) {
  // A bare string allows any value: the other side is the tighter one.
  if (typeof baseEntry === 'string') return tightEntry
  if (typeof tightEntry === 'string') return baseEntry

  /** @type {Array<boolean | number | string | RegExp>} */
  const values = []

  for (const tight of tightEntry.slice(1)) {
    for (const wide of baseEntry.slice(1)) {
      const wideRegex = isRegex(wide)
      const tightRegex = isRegex(tight)

      if (wideRegex && tightRegex) {
        if (wide.source === tight.source && wide.flags === tight.flags) {
          values.push(wide)
          break
        }

        throw new Error(
          'Cannot tighten schema: conflicting patterns `' +
            String(wide) +
            '` and `' +
            String(tight) +
            '` for `' +
            name +
            '` on `' +
            tagName +
            '` cannot be intersected'
        )
      }

      if (wideRegex) {
        if (wide.test(String(tight))) {
          values.push(tight)
          break
        }
      } else if (tightRegex) {
        if (tight.test(String(wide))) {
          values.push(wide)
          break
        }
      } else if (wide === tight) {
        values.push(wide)
        break
      }
    }
  }

  if (values.length === 0) {
    throw new Error(
      'Cannot tighten schema: fixed values for `' +
        name +
        '` on `' +
        tagName +
        '` do not overlap'
    )
  }

  return [name, ...values]
}

/**
 * Intersect two protocol maps.
 *
 * @param {Record<string, Array<string>> | null | undefined} base
 *   Base protocol map.
 * @param {Record<string, Array<string>>} tightening
 *   Tightening protocol map.
 * @returns {Record<string, Array<string>>}
 *   Protocol map never wider than `base`.
 */
function tightenProtocols(base, tightening) {
  /** @type {Record<string, Array<string>>} */
  const result = {...base}

  for (const key in tightening) {
    if (own.call(tightening, key)) {
      const tight = tightening[key]
      const wide = base && own.call(base, key) ? base[key] : undefined

      // Missing or empty in `base` means unrestricted: `tightening` wins.
      if (!wide || wide.length === 0) {
        result[key] = [...tight]
      } else {
        const both = tight.filter((protocol) => wide.includes(protocol))

        if (both.length === 0) {
          throw new Error(
            'Cannot tighten schema: protocols for `' + key + '` do not overlap'
          )
        }

        result[key] = both
      }
    }
  }

  return result
}

/**
 * Find the definition for a property name in a list of definitions.
 *
 * @param {Readonly<Array<PropertyDefinition>>} definitions
 *   Definitions.
 * @param {string} name
 *   Property name.
 * @returns {PropertyDefinition | undefined}
 *   Definition, if found.
 */
function findByName(definitions, name) {
  let index = -1

  while (++index < definitions.length) {
    const entry = definitions[index]

    if ((typeof entry === 'string' ? entry : entry[0]) === name) {
      return entry
    }
  }
}

/**
 * Check whether a value is a regular expression.
 *
 * @param {unknown} value
 *   Value.
 * @returns {value is RegExp}
 *   Whether `value` is a regular expression.
 */
function isRegex(value) {
  return Boolean(
    value && typeof value === 'object' && 'flags' in value && 'test' in value
  )
}
