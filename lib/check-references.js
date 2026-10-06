/**
 * @import {Element, Nodes} from 'hast'
 * @import {Schema} from 'hast-util-sanitize'
 */

/**
 * @typedef {'duplicate' | 'missing'} ReferenceKind
 *   Kind of reference problem.
 *
 *   * `'duplicate'`: more than one element has the referenced id.
 *   * `'missing'`: no element has the referenced id.
 *
 * @typedef Reference
 *   A reference that is not valid.
 * @property {ReferenceKind} kind
 *   Kind of problem.
 * @property {Element} node
 *   Element that references.
 * @property {string} property
 *   Property on `node` that references (for example `ariaDescribedBy`,
 *   `href`).
 * @property {string} value
 *   Value that is not valid.
 * @property {Array<Element>} targets
 *   Elements that have the referenced id (empty for missing, two or more for
 *   duplicate).
 *
 * @typedef Options
 *   Configuration.
 * @property {boolean | null | undefined} [remove=false]
 *   Remove invalid references from the tree.
 * @property {Schema | null | undefined} [schema]
 *   Schema that was used to sanitize (default: `defaultSchema`).
 */

import {defaultSchema} from './schema.js'

// ARIA properties that reference other elements by id.
const ariaReferenceProperties = [
  'ariaActiveDescendant',
  'ariaControls',
  'ariaDescribedBy',
  'ariaDetails',
  'ariaErrorMessage',
  'ariaFlowTo',
  'ariaLabelledBy',
  'ariaOwns'
]

/**
 * Check references in a sanitized tree.
 *
 * Walks a tree that was sanitized and checks that the remaining `id`s are
 * referenced by ARIA attributes and fragment URLs.
 * References that point to no target (`missing`) or to more than one target
 * (`duplicate`) are reported.
 * Optionally removes invalid references.
 *
 * @param {Readonly<Nodes>} tree
 *   Sanitized tree.
 * @param {Readonly<Options> | null | undefined} [options]
 *   Configuration (default: `{}`).
 * @returns {Array<Reference>}
 *   Invalid references.
 */
export function checkReferences(tree, options) {
  const settings = options || {}
  const schema = settings.schema
    ? {...defaultSchema, ...settings.schema}
    : defaultSchema
  const remove = settings.remove === true
  const clobberPrefix =
    schema.clobber && schema.clobber.includes('id') && schema.clobberPrefix
      ? schema.clobberPrefix
      : ''

  /**
   * All remaining ids, keyed by the id as it appears in the tree and, when
   * clobbering applies, by the canonical id without the prefix.
   *
   * @type {Map<string, Array<Element>>}
   */
  const ids = new Map()

  visit(tree, function (node) {
    if (node.type === 'element') {
      const element = /** @type {Element} */ (node)
      const id = element.properties && element.properties.id

      if (typeof id === 'string') {
        add(ids, id, element)

        if (clobberPrefix && id.startsWith(clobberPrefix)) {
          add(ids, id.slice(clobberPrefix.length), element)
        }
      }
    }
  })

  /** @type {Array<Reference>} */
  const report = []

  visit(tree, function (node) {
    if (node.type !== 'element') return

    const element = /** @type {Element} */ (node)
    const properties = /** @type {Record<string, unknown>} */ (
      element.properties || {}
    )

    for (const property of ariaReferenceProperties) {
      const value = properties[property]

      if (typeof value !== 'string' && !Array.isArray(value)) continue

      const tokens = tokenize(value)
      /** @type {Set<string>} */
      const invalid = new Set()

      for (const token of tokens) {
        const targets = ids.get(token) || []

        if (targets.length === 0) {
          report.push({
            kind: 'missing',
            node: element,
            property,
            value: token,
            targets: []
          })
          invalid.add(token)
        } else if (targets.length > 1) {
          report.push({
            kind: 'duplicate',
            node: element,
            property,
            value: token,
            targets
          })
          invalid.add(token)
        }
      }

      if (remove && invalid.size > 0) {
        const valid = tokens.filter(function (token) {
          return !invalid.has(token)
        })

        if (valid.length === 0) {
          delete properties[property]
        } else if (Array.isArray(value)) {
          properties[property] = valid
        } else {
          properties[property] = valid.join(' ')
        }
      }
    }

    const href = properties.href

    if (typeof href === 'string' && href.startsWith('#')) {
      const token = href.slice(1)
      const targets = ids.get(token) || []

      if (targets.length === 0) {
        report.push({
          kind: 'missing',
          node: element,
          property: 'href',
          value: token,
          targets: []
        })

        if (remove) {
          delete properties.href
        }
      } else if (targets.length > 1) {
        report.push({
          kind: 'duplicate',
          node: element,
          property: 'href',
          value: token,
          targets
        })

        if (remove) {
          delete properties.href
        }
      }
    }
  })

  return report
}

/**
 * Add a node to a map of ids.
 *
 * @param {Map<string, Array<Element>>} ids
 *   Map of ids.
 * @param {string} id
 *   Id.
 * @param {Element} node
 *   Node.
 */
function add(ids, id, node) {
  const nodes = ids.get(id)

  if (nodes) {
    nodes.push(node)
  } else {
    ids.set(id, [node])
  }
}

/**
 * Get the tokens of a reference value.
 *
 * @param {string | Array<number | string>} value
 *   Value.
 * @returns {Array<string>}
 *   Tokens.
 */
function tokenize(value) {
  /** @type {Array<string>} */
  const result = []

  if (typeof value === 'string') {
    result.push(...value.split(/\s+/).filter(Boolean))
  } else {
    for (const item of value) {
      if (typeof item === 'string') {
        result.push(...item.split(/\s+/).filter(Boolean))
      }
    }
  }

  return result
}

/**
 * Visit a node and its descendants.
 *
 * @param {Readonly<Nodes>} node
 *   Node.
 * @param {(node: Nodes) => void} callback
 *   Callback.
 */
function visit(node, callback) {
  if (node && typeof node === 'object') {
    callback(node)

    const children = /** @type {Array<Nodes> | undefined} */ (
      /** @type {Record<string, unknown>} */ (node).children
    )

    if (Array.isArray(children)) {
      for (const child of children) {
        visit(child, callback)
      }
    }
  }
}
