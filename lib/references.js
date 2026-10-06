/**
 * @import {Element, Nodes} from 'hast'
 */

/**
 * @typedef ReferenceIssue
 *   A single broken or ambiguous reference found on an element.
 * @property {Element} node
 *   Element that holds the reference.
 * @property {string} property
 *   Property name that holds the reference (such as `ariaDescribedBy` or
 *   `href`).
 * @property {string} id
 *   Referenced identifier (without a `#` prefix).
 * @property {number} index
 *   Index of the identifier in a multi-value property, or `-1` when the
 *   property holds a single value.
 *
 * @typedef DuplicateId
 *   An identifier that is defined by more than one element.
 * @property {string} id
 *   The duplicated identifier.
 * @property {Array<Element>} nodes
 *   Elements that define it, in document order.
 *
 * @typedef ReferenceReport
 *   Result of checking references.
 * @property {Array<ReferenceIssue>} missing
 *   References whose target identifier does not exist in the tree.
 * @property {Array<DuplicateId>} duplicate
 *   Identifiers defined by more than one element.
 * @property {Array<ReferenceIssue>} ambiguous
 *   References whose target identifier is defined more than once.
 *
 * @typedef CheckReferencesOptions
 *   Configuration for `checkReferences`.
 * @property {'report' | 'trim' | null | undefined} [mode='report']
 *   How to handle invalid references (default: `'report'`).
 *
 *   With `'report'`, the tree is left untouched and problems are only
 *   reported.
 *   With `'trim'`, invalid identifiers are removed from multi-value
 *   properties (valid identifiers are kept, in their original order), and
 *   single-value properties that only hold an invalid reference are removed.
 *
 * @typedef Context
 *   Info passed around.
 * @property {Map<string, Array<Element>>} byId
 *   Identifiers that exist in the tree.
 * @property {'report' | 'trim'} mode
 *   Whether to only report or also remove invalid references.
 * @property {ReferenceReport} report
 *   Report to add issues to.
 */

/**
 * ARIA properties that hold one or more ID references.
 *
 * @type {Array<string>}
 */
const ariaReferences = [
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
 * Properties whose value may be a URL with a fragment (`#id`) that
 * references an element in the same tree.
 *
 * @type {Array<string>}
 */
const fragmentReferences = [
  'action',
  'background',
  'cite',
  'data',
  'formAction',
  'href',
  'longDesc',
  'poster',
  'profile',
  'src',
  'useMap'
]

/**
 * Check `id` references (ARIA properties and URL fragments) against the
 * identifiers that actually exist in a tree.
 *
 * This is meant to be used on the result of `sanitize`: it looks at the
 * current (safe) tree as plain data, so references whose target was removed
 * by sanitation are reported as missing instead of being treated as still
 * valid.
 * It does not re-run `sanitize` and does not mutate the tree unless
 * `options.mode` is `'trim'`.
 *
 * @param {Readonly<Nodes>} tree
 *   Tree to check (typically the result of `sanitize`).
 * @param {Readonly<CheckReferencesOptions> | null | undefined} [options]
 *   Configuration (default: `{mode: 'report'}`).
 * @returns {ReferenceReport}
 *   Report of missing, duplicate, and ambiguous references.
 */
export function checkReferences(tree, options) {
  /** @type {Context} */
  const context = {
    byId: new Map(),
    mode: options && options.mode === 'trim' ? 'trim' : 'report',
    report: {missing: [], duplicate: [], ambiguous: []}
  }
  const elements = collectElements(tree)
  const byId = context.byId
  const report = context.report

  for (const element of elements) {
    const id = element.properties ? element.properties.id : undefined

    if (typeof id === 'string' || typeof id === 'number') {
      const key = String(id)
      const list = byId.get(key)

      if (list) {
        list.push(element)
      } else {
        byId.set(key, [element])
      }
    }
  }

  for (const [id, nodes] of byId) {
    if (nodes.length > 1) {
      report.duplicate.push({id, nodes})
    }
  }

  for (const element of elements) {
    checkElement(element, context)
  }

  return report
}

/**
 * Collect all elements in a tree, in document order, by reading plain data
 * fields only.
 *
 * @param {Readonly<Nodes>} tree
 *   Tree to walk.
 * @returns {Array<Element>}
 *   All elements, in document order.
 */
function collectElements(tree) {
  /** @type {Array<Element>} */
  const elements = []
  /** @type {Array<Readonly<Nodes>>} */
  const stack = [tree]

  while (stack.length > 0) {
    const node = stack.pop()

    if (node && typeof node === 'object') {
      if (node.type === 'element') {
        elements.push(node)
      }

      if ('children' in node && Array.isArray(node.children)) {
        let index = node.children.length

        while (index-- > 0) {
          stack.push(node.children[index])
        }
      }
    }
  }

  return elements
}

/**
 * Check all references on one element.
 *
 * @param {Element} element
 *   Element to check.
 * @param {Context} context
 *   Info passed around.
 * @returns {undefined}
 *   Nothing.
 */
function checkElement(element, context) {
  const properties = element.properties

  if (!properties) return

  for (const property of ariaReferences) {
    if (Object.hasOwn(properties, property)) {
      checkList(element, property, context)
    }
  }

  for (const property of fragmentReferences) {
    if (Object.hasOwn(properties, property)) {
      checkFragment(element, property, context)
    }
  }
}

/**
 * Check a multi-value ID reference property (such as `ariaDescribedBy`).
 *
 * @param {Element} element
 *   Element to check.
 * @param {string} property
 *   Property name.
 * @param {Context} context
 *   Info passed around.
 * @returns {undefined}
 *   Nothing.
 */
function checkList(element, property, context) {
  // `checkElement` only calls this when `element.properties` exists.
  const properties = /** @type {import('hast').Properties} */ (
    element.properties
  )

  const value = properties[property]
  const tokens = tokenize(value)
  /** @type {Array<string>} */
  const valid = []
  let broken = false

  for (const [index, id] of tokens.entries()) {
    const targets = context.byId.get(id)

    if (!targets) {
      context.report.missing.push({node: element, property, id, index})
      broken = true
    } else if (targets.length > 1) {
      context.report.ambiguous.push({node: element, property, id, index})
      broken = true
    } else {
      valid.push(id)
    }
  }

  if (context.mode === 'trim' && broken) {
    if (valid.length === 0) {
      delete properties[property]
    } else if (Array.isArray(value)) {
      properties[property] = valid
    } else {
      properties[property] = valid.join(' ')
    }
  }
}

/**
 * Check a single-value fragment reference property (such as `href="#id"`).
 *
 * @param {Element} element
 *   Element to check.
 * @param {string} property
 *   Property name.
 * @param {Context} context
 *   Info passed around.
 * @returns {undefined}
 *   Nothing.
 */
function checkFragment(element, property, context) {
  // `checkElement` only calls this when `element.properties` exists.
  const properties = /** @type {import('hast').Properties} */ (
    element.properties
  )

  const value = properties[property]

  if (typeof value !== 'string' || value.charAt(0) !== '#') return

  const id = value.slice(1)

  if (!id) return

  const targets = context.byId.get(id)

  if (!targets) {
    context.report.missing.push({node: element, property, id, index: -1})
  } else if (targets.length > 1) {
    context.report.ambiguous.push({node: element, property, id, index: -1})
  } else {
    return
  }

  if (context.mode === 'trim') {
    delete properties[property]
  }
}

/**
 * Split a property value into identifiers, keeping their order.
 *
 * @param {unknown} value
 *   Property value.
 * @returns {Array<string>}
 *   Identifiers, in order.
 */
function tokenize(value) {
  if (typeof value === 'string') {
    return value.split(/\s+/).filter(Boolean)
  }

  if (Array.isArray(value)) {
    /** @type {Array<string>} */
    const result = []
    const list = /** @type {Array<unknown>} */ (value)

    for (const item of list) {
      if (typeof item === 'string' || typeof item === 'number') {
        result.push(String(item))
      }
    }

    return result
  }

  return []
}
