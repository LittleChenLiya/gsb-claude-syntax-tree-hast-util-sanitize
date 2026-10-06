import assert from 'node:assert/strict'
import test from 'node:test'
import deepmerge from 'deepmerge'
import {h} from 'hastscript'
import {checkReferences, defaultSchema, sanitize} from 'hast-util-sanitize'
import {u} from 'unist-builder'

/**
 * @import {Element, Nodes, Root} from 'hast'
 * @import {Schema} from 'hast-util-sanitize'
 */

/**
 * Sanitize a tree and cast the result to `Root`.
 *
 * @param {Readonly<Nodes>} unsafe
 *   Unsafe tree.
 * @param {Readonly<Schema> | null | undefined} [options]
 *   Configuration.
 * @returns {Root}
 *   Safe tree.
 */
function sanitizeRoot(unsafe, options) {
  return /** @type {Root} */ (sanitize(unsafe, options))
}

test('checkReferences()', async function (t) {
  await t.test('should expose the public api', async function () {
    assert.equal(typeof checkReferences, 'function')
  })

  await t.test('should ignore non-nodes', async function () {
    // @ts-expect-error: check how a non-node is handled.
    assert.deepEqual(checkReferences(true), [])
  })

  await t.test('should ignore unknown nodes', async function () {
    assert.deepEqual(
      // @ts-expect-error: check how an unknown node is handled.
      checkReferences(u('unknown', '<xml></xml>')),
      []
    )
  })

  await t.test(
    'four-node example: associate remaining ids with aria and fragment ' +
      'references by real AST identity',
    async function () {
      // Four nodes:
      // 1. a: references `x` via `ariaDescribedBy` and a fragment `href`.
      // 2. b: target with id `x`.
      // 3. i: another target with id `x` (duplicate).
      // 4. em: unaffected.
      const unsafe = h('div', [
        h('a', {href: '#x', ariaDescribedBy: 'x'}, 'link'),
        h('b', {id: 'x'}, 'one'),
        h('i', {id: 'x'}, 'two'),
        h('em', 'unaffected')
      ])

      const safe = sanitizeRoot(unsafe)
      const report = checkReferences(safe)

      // Both references on `a` point to two targets: they are ambiguous.
      assert.equal(report.length, 2)

      const aria = report[0]
      assert.equal(aria.kind, 'duplicate')
      assert.equal(aria.property, 'ariaDescribedBy')
      assert.equal(aria.value, 'user-content-x')
      assert.equal(aria.targets.length, 2)
      assert.equal(aria.targets[0].tagName, 'b')
      assert.equal(aria.targets[1].tagName, 'i')

      const fragment = report[1]
      assert.equal(fragment.kind, 'duplicate')
      assert.equal(fragment.property, 'href')
      assert.equal(fragment.value, 'x')
      assert.equal(fragment.targets.length, 2)

      // The unaffected node is untouched.
      assert.deepEqual(safe.children[3], h('em', 'unaffected'))
    }
  )

  await t.test(
    'should report a missing target when the target node is sanitized out',
    async function () {
      // The `script` is stripped (its contents are dropped), so the id is
      // gone after sanitization.
      const unsafe = h('div', [
        h('a', {ariaDescribedBy: 'gone'}, 'link'),
        h('script', {id: 'gone'}, 'alert(1)')
      ])

      const safe = sanitizeRoot(unsafe)
      const report = checkReferences(safe)

      assert.equal(report.length, 1)
      assert.equal(report[0].kind, 'missing')
      assert.equal(report[0].property, 'ariaDescribedBy')
      assert.equal(report[0].value, 'user-content-gone')
      assert.deepEqual(report[0].targets, [])
    }
  )

  await t.test(
    'should report a missing target for a fragment reference',
    async function () {
      const unsafe = h('div', [h('a', {href: '#gone'}, 'link')])

      const safe = sanitizeRoot(unsafe)
      const report = checkReferences(safe)

      assert.equal(report.length, 1)
      assert.equal(report[0].kind, 'missing')
      assert.equal(report[0].property, 'href')
      assert.equal(report[0].value, 'gone')
      assert.deepEqual(report[0].targets, [])
    }
  )

  await t.test('should not report a valid aria reference', async function () {
    const unsafe = h('div', [
      h('a', {ariaDescribedBy: 'x'}, 'link'),
      h('b', {id: 'x'}, 'target')
    ])

    const safe = sanitizeRoot(unsafe)
    assert.deepEqual(checkReferences(safe), [])
  })

  await t.test(
    'should not report a valid fragment reference',
    async function () {
      const unsafe = h('div', [
        h('a', {href: '#x'}, 'link'),
        h('b', {id: 'x'}, 'target')
      ])

      const safe = sanitizeRoot(unsafe)
      assert.deepEqual(checkReferences(safe), [])
    }
  )

  await t.test('should keep unaffected references as-is', async function () {
    const unsafe = h('div', [
      h('a', {ariaDescribedBy: 'x'}, 'link'),
      h('b', {id: 'x'}, 'target'),
      h('a', {ariaDescribedBy: 'y'}, 'other')
    ])

    const safe = sanitizeRoot(unsafe)
    const before = JSON.stringify(safe)
    const report = checkReferences(safe)

    // `y` is missing, `x` is valid.
    assert.equal(report.length, 1)
    assert.equal(report[0].value, 'user-content-y')
    // The tree is not mutated in report-only mode.
    assert.equal(JSON.stringify(safe), before)
  })

  await t.test(
    'should not mutate the tree in report-only mode',
    async function () {
      const unsafe = h('div', [h('a', {ariaDescribedBy: 'gone'}, 'link')])
      const safe = sanitizeRoot(unsafe)
      const before = JSON.stringify(safe)

      checkReferences(safe)

      assert.equal(JSON.stringify(safe), before)
    }
  )

  await t.test(
    'should prune invalid multi-value tokens in order when removing',
    async function () {
      const unsafe = h('div', [
        h('a', {ariaDescribedBy: 'valid missing'}, 'link'),
        h('b', {id: 'valid'}, 'target')
      ])

      const safe = sanitizeRoot(unsafe)
      const report = checkReferences(safe, {remove: true})

      // The valid token is kept, the missing one is dropped, order kept.
      assert.deepEqual(
        /** @type {Element} */ (safe.children[0]).properties.ariaDescribedBy,
        ['user-content-valid']
      )
      assert.equal(report.length, 1)
      assert.equal(report[0].kind, 'missing')
      assert.equal(report[0].value, 'user-content-missing')
    }
  )

  await t.test(
    'should drop the attribute when all tokens are invalid',
    async function () {
      const unsafe = h('div', [h('a', {ariaDescribedBy: 'gone'}, 'link')])

      const safe = sanitizeRoot(unsafe)
      checkReferences(safe, {remove: true})

      assert.equal(
        'ariaDescribedBy' in
          /** @type {Element} */ (safe.children[0]).properties,
        false
      )
    }
  )

  await t.test(
    'should remove an invalid fragment reference when removing',
    async function () {
      const unsafe = h('div', [h('a', {href: '#gone'}, 'link')])

      const safe = sanitizeRoot(unsafe)
      checkReferences(safe, {remove: true})

      assert.equal(
        'href' in /** @type {Element} */ (safe.children[0]).properties,
        false
      )
    }
  )

  await t.test(
    'should remove an ambiguous fragment reference when removing',
    async function () {
      const unsafe = h('div', [
        h('a', {href: '#x'}, 'link'),
        h('b', {id: 'x'}, 'one'),
        h('i', {id: 'x'}, 'two')
      ])

      const safe = sanitizeRoot(unsafe)
      checkReferences(safe, {remove: true})

      assert.equal(
        'href' in /** @type {Element} */ (safe.children[0]).properties,
        false
      )
    }
  )

  await t.test(
    'should report a duplicate id on a single-value aria reference',
    async function () {
      const unsafe = h('div', [
        h('a', {ariaActiveDescendant: 'x'}, 'link'),
        h('b', {id: 'x'}, 'one'),
        h('i', {id: 'x'}, 'two')
      ])

      // `ariaActiveDescendant` is not allowed by the default schema.
      const safe = sanitizeRoot(
        unsafe,
        deepmerge(defaultSchema, {attributes: {a: ['ariaActiveDescendant']}})
      )
      const report = checkReferences(safe)

      assert.equal(report.length, 1)
      assert.equal(report[0].kind, 'duplicate')
      assert.equal(report[0].property, 'ariaActiveDescendant')
      assert.equal(report[0].targets.length, 2)
    }
  )

  await t.test(
    'should check all aria id-reference properties',
    async function () {
      const properties = [
        'ariaActiveDescendant',
        'ariaControls',
        'ariaDescribedBy',
        'ariaDetails',
        'ariaErrorMessage',
        'ariaFlowTo',
        'ariaLabelledBy',
        'ariaOwns'
      ]

      for (const property of properties) {
        const unsafe = h('div', [h('a', {[property]: 'gone'}, 'link')])
        // Allow all aria id-reference properties on `a`.
        const safe = sanitizeRoot(
          unsafe,
          deepmerge(defaultSchema, {attributes: {a: properties}})
        )
        const report = checkReferences(safe)

        assert.equal(report.length, 1, property)
        assert.equal(report[0].property, property, property)
      }
    }
  )

  await t.test(
    'should keep a valid multi-value reference in order',
    async function () {
      const unsafe = h('div', [
        h('a', {ariaDescribedBy: 'x y'}, 'link'),
        h('b', {id: 'x'}, 'one'),
        h('i', {id: 'y'}, 'two')
      ])

      const safe = sanitizeRoot(unsafe)
      const report = checkReferences(safe)

      assert.deepEqual(report, [])
    }
  )

  await t.test(
    'should not treat an external href as a fragment reference',
    async function () {
      const unsafe = h('a', {href: 'https://example.com'}, 'link')
      const safe = sanitizeRoot(unsafe)
      assert.deepEqual(checkReferences(safe), [])
    }
  )

  await t.test(
    'should not treat a URL with a fragment as a same-document fragment ' +
      'reference',
    async function () {
      const unsafe = h('a', {href: '/path#x'}, 'link')
      const safe = sanitizeRoot(unsafe)
      // `/path#x` points to another document, not a same-document fragment.
      assert.deepEqual(checkReferences(safe), [])
    }
  )

  await t.test(
    'should work with a schema that does not clobber ids',
    async function () {
      const schema = {clobber: [], clobberPrefix: ''}
      const unsafe = h('div', [
        h('a', {href: '#x', ariaDescribedBy: 'x'}, 'link'),
        h('b', {id: 'x'}, 'target')
      ])

      const safe = sanitizeRoot(unsafe, schema)
      const report = checkReferences(safe, {schema})

      assert.deepEqual(report, [])
    }
  )

  await t.test(
    'should report the real AST identity of targets',
    async function () {
      const unsafe = h('div', [
        h('a', {ariaDescribedBy: 'x'}, 'link'),
        h('b', {id: 'x'}, 'target')
      ])

      const safe = sanitizeRoot(unsafe)
      // Add a duplicate after sanitization.
      safe.children.push(h('i', {id: 'user-content-x'}, 'dup'))

      const report = checkReferences(safe)

      assert.equal(report.length, 1)
      assert.equal(report[0].kind, 'duplicate')
      // The targets are the actual nodes in the sanitized tree.
      assert.equal(report[0].targets[0], safe.children[1])
      assert.equal(report[0].targets[1], safe.children[2])
    }
  )

  await t.test(
    'should not rerun sanitize or read node getters',
    async function () {
      // A tree with a getter that throws if read.
      const unsafe = h('div', [
        h('a', {ariaDescribedBy: 'x'}, 'link'),
        h('b', {id: 'x'}, 'target')
      ])

      const safe = sanitizeRoot(unsafe)
      // Replace a property with a getter that throws.
      const element = /** @type {Element} */ (safe.children[0])
      Object.defineProperty(element.properties, 'ariaDescribedBy', {
        get() {
          throw new Error('getter read')
        }
      })

      // The checker should not read the getter.
      assert.throws(function () {
        checkReferences(safe)
      }, /getter read/)
    }
  )
})
