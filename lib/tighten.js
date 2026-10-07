/**
 * @import {Properties} from 'hast'
 * @import {PropertyDefinition, Schema} from './index.js'
 */

const own = {}.hasOwnProperty

/**
 * Combine two schemas into a tighter one.
 *
 * The result only ever *narrows* what `base` allows: the `restriction`
 * schema can remove tag names, attributes, attribute values, and protocols,
 * but it can never re-allow something that `base` already forbids.
 *
 * Rules:
 *
 * *   `tagNames`, `protocols`, and `attributes` are intersected.
 * *   Fixed value allow lists (such as `['type', 'checkbox', 'radio']`)
 *     are intersected value by value; a regex keeps the primitives it
 *     matches and identical regexes are kept.
 * *   `strip` and `clobber` are unioned (dropping more is tighter).
 * *   `allowComments` and `allowDoctypes` stay off when either schema
 *     turns them off.
 * *   `ancestors` are intersected per tag name, `required` is merged.
 * *   Conflicts that cannot be expressed as a tighter schema (such as an
 *     empty intersection of fixed attribute values or protocols, two
 *     different regexes for one attribute, conflicting `required` values,
 *     or conflicting `clobberPrefix` values) are rejected by throwing an
 *     error.
 *
 * @param {Readonly<Schema>} base
 *   Base schema; its allowances are the ceiling.
 * @param {Readonly<Schema>} restriction
 *   Restricting schema; can only narrow `base`.
 * @returns {Schema}
 *   New schema that is the tightening combination of both.
 */
export function tightenSchema(base, restriction) {
  /** @type {Schema} */
  const result = {...base}

  result.allowComments = Boolean(
    base.allowComments && restriction.allowComments !== false
  )
  result.allowDoctypes = Boolean(
    base.allowDoctypes && restriction.allowDoctypes !== false
  )

  if (restriction.clobberPrefix !== undefined) {
    if (
      base.clobberPrefix !== undefined &&
      base.clobberPrefix !== restriction.clobberPrefix
    ) {
      throw new Error(
        'Cannot tighten schemas: conflicting `clobberPrefix` values `' +
          base.clobberPrefix +
          '` and `' +
          restriction.clobberPrefix +
          '`'
      )
    }

    result.clobberPrefix = restriction.clobberPrefix
  }

  result.clobber = unionStrings(base.clobber, restriction.clobber)
  result.strip = unionStrings(base.strip, restriction.strip)
  result.tagNames = intersectStrings(base.tagNames, restriction.tagNames)
  result.ancestors = tightenAncestors(base.ancestors, restriction.ancestors)
  result.attributes = tightenAttributes(base.attributes, restriction.attributes)
  result.protocols = tightenProtocols(base.protocols, restriction.protocols)
  result.required = tightenRequired(base.required, restriction.required)

  return result
}

/**
 * Union two string lists; `undefined` means “nothing”.
 *
 * @param {Readonly<Array<string>> | null | undefined} a
 *   First list.
 * @param {Readonly<Array<string>> | null | undefined} b
 *   Second list.
 * @returns {Array<string> | undefined}
 *   Union, or `undefined` when both are missing.
 */
function unionStrings(a, b) {
  if (!a) return b ? [...b] : undefined
  if (!b) return [...a]

  /** @type {Array<string>} */
  const result = [...a]

  for (const value of b) {
    if (!result.includes(value)) result.push(value)
  }

  return result
}

/**
 * Intersect two string lists; `undefined` means “no constraint”.
 *
 * @param {Readonly<Array<string>> | null | undefined} a
 *   First list.
 * @param {Readonly<Array<string>> | null | undefined} b
 *   Second list.
 * @returns {Array<string> | undefined}
 *   Intersection, or `undefined` when both are missing.
 */
function intersectStrings(a, b) {
  if (!a) return b ? [...b] : undefined
  if (!b) return [...a]
  return a.filter((value) => b.includes(value))
}

/**
 * Tighten `ancestors`: intersect the required ancestor lists per tag name.
 *
 * @param {Schema['ancestors']} base
 *   Base ancestors.
 * @param {Schema['ancestors']} restriction
 *   Restricting ancestors.
 * @returns {Schema['ancestors']}
 *   Tightened ancestors.
 */
function tightenAncestors(base, restriction) {
  if (!base) return restriction ? {...restriction} : restriction
  if (!restriction) return {...base}

  /** @type {Record<string, Array<string>>} */
  const result = {}

  const keys = new Set([...Object.keys(base), ...Object.keys(restriction)])

  for (const key of keys) {
    const a = own.call(base, key) ? base[key] : undefined
    const b = own.call(restriction, key) ? restriction[key] : undefined
    // An empty list means the element can never occur: expressible and tight.
    result[key] = intersectStrings(a, b) || []
  }

  return result
}

/**
 * Tighten `attributes`: intersect the allowed attribute lists per tag name.
 *
 * Attributes allowed by only one schema are dropped; attributes allowed by
 * both get their fixed value allow lists intersected.
 *
 * @param {Schema['attributes']} base
 *   Base attributes.
 * @param {Schema['attributes']} restriction
 *   Restricting attributes.
 * @returns {Schema['attributes']}
 *   Tightened attributes.
 */
function tightenAttributes(base, restriction) {
  if (!base) return restriction ? {...restriction} : restriction
  if (!restriction) return {...base}

  /** @type {Record<string, Array<PropertyDefinition>>} */
  const result = {}

  const keys = new Set([...Object.keys(base), ...Object.keys(restriction)])

  for (const key of keys) {
    const a = own.call(base, key) ? base[key] : undefined
    const b = own.call(restriction, key) ? restriction[key] : undefined

    if (!a) {
      if (b) result[key] = [...b]
    } else if (!b) {
      result[key] = [...a]
    } else {
      /** @type {Array<PropertyDefinition>} */
      const entries = []

      for (const entryA of a) {
        const nameA = typeof entryA === 'string' ? entryA : entryA[0]

        for (const entryB of b) {
          const nameB = typeof entryB === 'string' ? entryB : entryB[0]

          if (nameA === nameB) {
            entries.push(tightenDefinition(entryA, entryB, key))
            break
          }
        }
      }

      result[key] = entries
    }
  }

  return result
}

/**
 * Tighten one attribute definition against another.
 *
 * @param {Readonly<PropertyDefinition>} a
 *   Base definition.
 * @param {Readonly<PropertyDefinition>} b
 *   Restricting definition.
 * @param {string} tagName
 *   Tag name the attribute is defined for (used in errors).
 * @returns {PropertyDefinition}
 *   Tightened definition.
 */
function tightenDefinition(a, b, tagName) {
  const name = typeof a === 'string' ? a : a[0]

  // Either side allows any value: the other side is tighter.
  if (typeof a === 'string') return typeof b === 'string' ? a : [...b]
  if (typeof b === 'string') return [...a]

  // Both sides restrict values: intersect them.
  /** @type {Array<Exclude<Properties[keyof Properties], Array<any>> | RegExp>} */
  const values = []

  for (const valueA of a.slice(1)) {
    if (valueA instanceof RegExp) {
      for (const valueB of b.slice(1)) {
        if (valueB instanceof RegExp) {
          if (
            valueA.source === valueB.source &&
            valueA.flags === valueB.flags
          ) {
            values.push(valueA)
          } else {
            throw new Error(
              'Cannot tighten schemas: conflicting expressions `' +
                valueA +
                '` and `' +
                valueB +
                '` for attribute `' +
                name +
                '` on `' +
                tagName +
                '` cannot be intersected'
            )
          }
        } else if (valueA.test(String(valueB))) {
          values.push(valueB)
        }
      }
    } else {
      for (const valueB of b.slice(1)) {
        if (valueB instanceof RegExp) {
          if (valueB.test(String(valueA))) values.push(valueA)
        } else if (valueA === valueB) {
          values.push(valueA)
        }
      }
    }
  }

  if (values.length === 0) {
    throw new Error(
      'Cannot tighten schemas: attribute `' +
        name +
        '` on `' +
        tagName +
        '` has no allowed values left, which cannot be expressed'
    )
  }

  return [name, ...values]
}

/**
 * Tighten `protocols`: intersect the allowed protocols per property.
 *
 * @param {Schema['protocols']} base
 *   Base protocols.
 * @param {Schema['protocols']} restriction
 *   Restricting protocols.
 * @returns {Schema['protocols']}
 *   Tightened protocols.
 */
function tightenProtocols(base, restriction) {
  if (!base) return restriction ? {...restriction} : restriction
  if (!restriction) return {...base}

  /** @type {Record<string, Array<string>>} */
  const result = {}

  const keys = new Set([...Object.keys(base), ...Object.keys(restriction)])

  for (const key of keys) {
    const a = own.call(base, key) ? base[key] : undefined
    const b = own.call(restriction, key) ? restriction[key] : undefined

    if (a && b) {
      const intersection = intersectStrings(a, b) || []

      // An empty protocol list means “no restriction” at runtime, so an
      // empty intersection cannot be expressed: reject it.
      if (intersection.length === 0) {
        throw new Error(
          'Cannot tighten schemas: property `' +
            key +
            '` has no allowed protocols left, which cannot be expressed'
        )
      }

      result[key] = intersection
    } else {
      const value = a || b
      if (value) result[key] = [...value]
    }
  }

  return result
}

/**
 * Tighten `required`: merge required properties; conflicting required values
 * for the same tag and property cannot be expressed and are rejected.
 *
 * @param {Schema['required']} base
 *   Base required properties.
 * @param {Schema['required']} restriction
 *   Restricting required properties.
 * @returns {Schema['required']}
 *   Tightened required properties.
 */
function tightenRequired(base, restriction) {
  if (!base) return restriction ? {...restriction} : restriction
  if (!restriction) return {...base}

  /** @type {Record<string, Record<string, Properties[keyof Properties]>>} */
  const result = {}

  const keys = new Set([...Object.keys(base), ...Object.keys(restriction)])

  for (const key of keys) {
    const a = own.call(base, key) ? base[key] : undefined
    const b = own.call(restriction, key) ? restriction[key] : undefined

    if (!a) {
      if (b) result[key] = {...b}
    } else if (!b) {
      result[key] = {...a}
    } else {
      /** @type {Record<string, Properties[keyof Properties]>} */
      const merged = {...a}

      for (const property in b) {
        if (own.call(b, property)) {
          if (own.call(merged, property) && merged[property] !== b[property]) {
            throw new Error(
              'Cannot tighten schemas: conflicting required values for `' +
                property +
                '` on `' +
                key +
                '`'
            )
          }

          merged[property] = b[property]
        }
      }

      result[key] = merged
    }
  }

  return result
}
