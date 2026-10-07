import assert from 'node:assert/strict'
import test from 'node:test'
import {h} from 'hastscript'
import {toHtml} from 'hast-util-to-html'
import {defaultSchema, sanitize, tightenSchema} from 'hast-util-sanitize'

test('tightenSchema()', async function (t) {
  await t.test(
    'should intersect two small schemas and still filter dangerous nodes',
    async function () {
      // Two very small schemas, used as in-memory fixtures.
      const base = {
        tagNames: ['a', 'b', 'img', 'script'],
        attributes: {
          a: ['href', 'title'],
          img: ['src', 'alt'],
          '*': ['id']
        },
        protocols: {
          href: ['http', 'https', 'mailto'],
          src: ['http', 'https']
        },
        strip: ['script']
      }
      const tightening = {
        // `iframe` is not in `base`, so it cannot be re-allowed.
        tagNames: ['a', 'img', 'iframe'],
        attributes: {
          // `title` is narrowed away; `onclick` was never allowed.
          a: ['href', 'onclick'],
          img: ['src'],
          // `className` is not in `base`’s `'*'`, so it is dropped.
          '*': ['id', 'className']
        },
        protocols: {
          // `javascript` is not in `base`, so it cannot be re-allowed.
          href: ['https', 'javascript'],
          src: ['https']
        }
      }

      const schema = tightenSchema(base, tightening)

      assert.deepEqual(schema.tagNames, ['a', 'img'])
      assert.deepEqual(schema.attributes, {
        a: ['href'],
        img: ['src'],
        '*': ['id']
      })
      assert.deepEqual(schema.protocols, {
        href: ['https'],
        src: ['https']
      })
      // Untouched fields are inherited from `base`.
      assert.deepEqual(schema.strip, ['script'])

      const clean = sanitize(
        h(null, [
          h('script', 'alert(1)'),
          h('b', 'bold'),
          h('iframe', {src: 'https://example.com/embed'}),
          h('a', {href: 'javascript:alert(1)', title: 'x'}, 'link'),
          h('a', {href: 'https://example.com', id: 'ok'}, 'safe'),
          h('img', {
            src: 'https://example.com/x.png',
            alt: 'y',
            onerror: 'alert(1)'
          })
        ]),
        schema
      )

      assert.equal(
        toHtml(clean),
        'bold' +
          '<a>link</a>' +
          // Note: `id` is clobbered because `clobber` is inherited from
          // `defaultSchema` (the fixture does not define it).
          '<a href="https://example.com" id="user-content-ok">safe</a>' +
          '<img src="https://example.com/x.png">'
      )
    }
  )

  await t.test('should intersect fixed attribute values', async function () {
    const schema = tightenSchema(
      {
        tagNames: ['input', 'span'],
        attributes: {
          input: [
            ['type', 'checkbox', 'radio'],
            ['disabled', true]
          ],
          span: [['className', /^hljs-/]]
        },
        // Keep `defaultSchema.required` from adding `input` properties.
        required: {}
      },
      {
        attributes: {
          input: [
            ['type', 'checkbox'],
            ['disabled', true]
          ],
          span: [['className', 'hljs-keyword', 'other']]
        }
      }
    )

    assert.deepEqual(schema.attributes, {
      input: [
        ['type', 'checkbox'],
        ['disabled', true]
      ],
      span: [['className', 'hljs-keyword']]
    })

    // A fixed value that was intersected away is now filtered.
    assert.equal(
      toHtml(sanitize(h('input', {type: 'radio', disabled: true}), schema)),
      '<input disabled>'
    )
    assert.equal(
      toHtml(sanitize(h('input', {type: 'checkbox'}), schema)),
      '<input type="checkbox">'
    )
    // The regex in `base` still applies to the tightened list.
    assert.equal(
      toHtml(
        sanitize(h('span', {className: ['hljs-keyword', 'other']}), schema)
      ),
      '<span class="hljs-keyword"></span>'
    )
  })

  await t.test(
    'should reject fixed value conflicts that cannot be expressed',
    async function () {
      // Non-overlapping fixed values.
      assert.throws(function () {
        tightenSchema(
          {tagNames: ['input'], attributes: {input: [['type', 'checkbox']]}},
          {attributes: {input: [['type', 'text']]}}
        )
      }, /Cannot tighten schema: fixed values for `type` on `input` do not overlap/)

      // Two different regular expressions cannot be intersected.
      assert.throws(function () {
        tightenSchema(
          {tagNames: ['span'], attributes: {span: [['className', /^hljs-/]]}},
          {attributes: {span: [['className', /^language-/]]}}
        )
      }, /Cannot tighten schema: conflicting patterns/)

      // Non-overlapping protocols.
      assert.throws(function () {
        tightenSchema(
          {protocols: {href: ['http', 'https']}},
          {protocols: {href: ['mailto']}}
        )
      }, /Cannot tighten schema: protocols for `href` do not overlap/)

      // Invalid input.
      assert.throws(function () {
        // @ts-expect-error: check how a non-schema is handled.
        tightenSchema(null, {})
      }, /Cannot tighten schema: `base` must be a schema/)
    }
  )

  await t.test(
    'should keep the original interface working when unused',
    async function () {
      // `sanitize` without `tightenSchema` behaves exactly as before.
      assert.equal(
        toHtml(
          sanitize(h('div', {id: 'a', onclick: 'x'}, [h('script', 'alert(1)')]))
        ),
        '<div id="user-content-a"></div>'
      )

      // Tightening with an empty schema is a no-op on `defaultSchema`.
      const schema = tightenSchema(defaultSchema, {})

      assert.equal(
        toHtml(
          sanitize(
            h('div', {id: 'a', onclick: 'x'}, [h('script', 'alert(1)')]),
            schema
          )
        ),
        '<div id="user-content-a"></div>'
      )
    }
  )
})

