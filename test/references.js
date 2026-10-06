import assert from 'node:assert/strict'
import test from 'node:test'
import {checkReferences, sanitize} from 'hast-util-sanitize'

/**
 * Small schema for these tests: no clobbering, aria ID references allowed
 * everywhere, `script` stripped.
 */
const schema = {
  attributes: {
    '*': ['id', 'href', 'ariaDescribedBy', 'ariaLabelledBy']
  },
  clobber: [],
  strip: ['script'],
  tagNames: ['a', 'p', 'section', 'span']
}

/**
 * Four-node example: a kept target, a stripped target, a multi-value aria
 * reference, and a fragment reference.
 *
 * @returns {import('hast').Root}
 *   Tree.
 */
function fourNodeTree() {
  return {
    type: 'root',
    children: [
      {
        type: 'element',
        tagName: 'section',
        properties: {id: 'intro'},
        children: []
      },
      {
        type: 'element',
        tagName: 'script',
        properties: {id: 'gone'},
        children: []
      },
      {
        type: 'element',
        tagName: 'p',
        properties: {ariaDescribedBy: ['intro', 'gone', 'never']},
        children: [{type: 'text', value: 'hi'}]
      },
      {
        type: 'element',
        tagName: 'a',
        properties: {href: '#intro'},
        children: [{type: 'text', value: 'link'}]
      }
    ]
  }
}

/**
 * Sanitize with the test schema and cast the result to a root.
 *
 * @param {import('hast').Nodes} tree
 *   Unsafe tree.
 * @returns {import('hast').Root}
 *   Safe root.
 */
function clean(tree) {
  return /** @type {import('hast').Root} */ (sanitize(tree, schema))
}

test('checkReferences()', async function (t) {
  await t.test(
    'four-node example: removed target is reported missing',
    async function () {
      const safe = clean(fourNodeTree())

      // The `script` node was stripped by sanitation.
      assert.deepEqual(
        safe.children.map((d) => (d.type === 'element' ? d.tagName : d.type)),
        ['section', 'p', 'a']
      )

      const report = checkReferences(safe)

      assert.deepEqual(
        report.missing.map((d) => ({
          property: d.property,
          id: d.id,
          index: d.index
        })),
        [
          {property: 'ariaDescribedBy', id: 'gone', index: 1},
          {property: 'ariaDescribedBy', id: 'never', index: 2}
        ]
      )
      assert.deepEqual(report.duplicate, [])
      assert.deepEqual(report.ambiguous, [])

      // Issues point at the actual nodes of the safe tree.
      const p = safe.children[1]
      assert(report.missing[0].node === p)

      // Report mode leaves the tree untouched.
      assert.deepEqual(safe, clean(fourNodeTree()))
    }
  )

  await t.test(
    'duplicate ids are reported apart from missing',
    async function () {
      const safe = clean({
        type: 'root',
        children: [
          {
            type: 'element',
            tagName: 'span',
            properties: {id: 'dup'},
            children: []
          },
          {
            type: 'element',
            tagName: 'span',
            properties: {id: 'dup'},
            children: []
          },
          {
            type: 'element',
            tagName: 'p',
            properties: {ariaLabelledBy: ['dup']},
            children: []
          }
        ]
      })

      const report = checkReferences(safe)

      assert.deepEqual(report.missing, [])
      assert.equal(report.duplicate.length, 1)
      assert.equal(report.duplicate[0].id, 'dup')
      assert.equal(report.duplicate[0].nodes.length, 2)
      assert(report.duplicate[0].nodes[0] === safe.children[0])
      assert(report.duplicate[0].nodes[1] === safe.children[1])
      assert.deepEqual(
        report.ambiguous.map((d) => ({property: d.property, id: d.id})),
        [{property: 'ariaLabelledBy', id: 'dup'}]
      )
    }
  )

  await t.test(
    'trim mode removes invalid items but keeps valid ones in order',
    async function () {
      const safe = clean({
        type: 'root',
        children: [
          {
            type: 'element',
            tagName: 'section',
            properties: {id: 'a'},
            children: []
          },
          {
            type: 'element',
            tagName: 'section',
            properties: {id: 'b'},
            children: []
          },
          {
            type: 'element',
            tagName: 'p',
            properties: {ariaDescribedBy: ['a', 'nope', 'b']},
            children: []
          },
          {
            type: 'element',
            tagName: 'p',
            properties: {ariaLabelledBy: ['gone']},
            children: []
          },
          {
            type: 'element',
            tagName: 'a',
            properties: {href: '#a'},
            children: []
          },
          {
            type: 'element',
            tagName: 'a',
            properties: {href: '#gone'},
            children: []
          }
        ]
      })

      const report = checkReferences(safe, {mode: 'trim'})

      assert.deepEqual(
        report.missing.map((d) => d.id),
        ['nope', 'gone', 'gone']
      )

      const described = safe.children[2]
      const labelled = safe.children[3]
      const validLink = safe.children[4]
      const brokenLink = safe.children[5]
      assert(
        described.type === 'element' &&
          labelled.type === 'element' &&
          validLink.type === 'element' &&
          brokenLink.type === 'element'
      )

      // Valid multi-value items are kept, in their original order.
      assert.deepEqual(described.properties.ariaDescribedBy, ['a', 'b'])
      // A list with only invalid items is removed completely.
      assert(!Object.hasOwn(labelled.properties, 'ariaLabelledBy'))
      // Valid fragment references are kept as-is.
      assert.equal(validLink.properties.href, '#a')
      // Dangling fragment references are removed.
      assert(!Object.hasOwn(brokenLink.properties, 'href'))
    }
  )

  await t.test(
    'trim mode keeps string-valued lists as strings',
    async function () {
      const safe = clean({
        type: 'root',
        children: [
          {
            type: 'element',
            tagName: 'section',
            properties: {id: 'a'},
            children: []
          },
          {
            type: 'element',
            tagName: 'p',
            properties: {
              ariaDescribedBy: /** @type {Array<string>} */ (
                /** @type {unknown} */ ('a nope')
              )
            },
            children: []
          }
        ]
      })

      checkReferences(safe, {mode: 'trim'})

      const p = safe.children[1]
      assert(p.type === 'element')
      assert.equal(p.properties.ariaDescribedBy, 'a')
    }
  )

  await t.test(
    'default mode only reports and never mutates',
    async function () {
      const safe = clean(fourNodeTree())
      const before = structuredClone(safe)

      checkReferences(safe)
      checkReferences(safe, {mode: 'report'})
      checkReferences(safe, {})

      assert.deepEqual(safe, before)
    }
  )

  await t.test('edge cases', async function () {
    // A lone text node has no elements and no references.
    assert.deepEqual(checkReferences({type: 'text', value: 'hi'}), {
      missing: [],
      duplicate: [],
      ambiguous: []
    })

    // Non-nodes in `children`, elements without `properties`, and odd
    // `id` values are handled as plain data.
    const odd = /** @type {import('hast').Root} */ (
      /** @type {unknown} */ ({
        type: 'root',
        children: [
          null,
          {type: 'element', tagName: 'p', children: []},
          {
            type: 'element',
            tagName: 'span',
            properties: {id: 1, ariaDescribedBy: true},
            children: []
          },
          {
            type: 'element',
            tagName: 'span',
            properties: {id: true},
            children: []
          },
          {
            type: 'element',
            tagName: 'p',
            properties: {ariaLabelledBy: [1, null, 'missing']},
            children: []
          },
          {
            type: 'element',
            tagName: 'a',
            properties: {href: '#'},
            children: []
          },
          {
            type: 'element',
            tagName: 'a',
            properties: {href: ['not-a-string']},
            children: []
          },
          {
            type: 'element',
            tagName: 'a',
            properties: {href: 'https://example.com'},
            children: []
          }
        ]
      })
    )

    const oddReport = checkReferences(odd)

    // Numeric ids and reference items are compared as strings, non-string
    // values are ignored, and only actual problems are reported.
    assert.deepEqual(
      oddReport.missing.map((d) => ({property: d.property, id: d.id})),
      [{property: 'ariaLabelledBy', id: 'missing'}]
    )
    assert.deepEqual(oddReport.duplicate, [])
    assert.deepEqual(oddReport.ambiguous, [])

    // A fragment reference to a duplicated id is ambiguous, and `trim`
    // removes it; a fully valid list is left untouched by `trim`.
    const mixed = /** @type {import('hast').Root} */ (
      /** @type {unknown} */ ({
        type: 'root',
        children: [
          {type: 'element', tagName: 'span', properties: {id: 'x'}},
          {type: 'element', tagName: 'span', properties: {id: 'x'}},
          {type: 'element', tagName: 'span', properties: {id: 'y'}},
          {
            type: 'element',
            tagName: 'a',
            properties: {href: '#x'}
          },
          {
            type: 'element',
            tagName: 'p',
            properties: {ariaDescribedBy: ['y']}
          }
        ]
      })
    )

    const mixedReport = checkReferences(mixed, {mode: 'trim'})

    assert.deepEqual(
      mixedReport.ambiguous.map((d) => d.property),
      ['href']
    )

    const link = mixed.children[3]
    const paragraph = mixed.children[4]
    assert(link.type === 'element' && paragraph.type === 'element')
    assert(!Object.hasOwn(link.properties, 'href'))
    assert.deepEqual(paragraph.properties.ariaDescribedBy, ['y'])
  })
})
