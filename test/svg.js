import assert from 'node:assert/strict'
import test from 'node:test'
import {sanitize, sanitizeSvg} from '../index.js'

/**
 * Small fixture tree: an `svg` subtree (with a `circle`, a `use` with a
 * dangerous `xlinkHref`, an `a` with a dangerous `href`, and a
 * `foreignObject` containing HTML) inside an HTML root.
 */
const tree = {
  type: 'root',
  children: [
    {
      type: 'element',
      tagName: 'svg',
      properties: {
        height: 100,
        onload: 'alert(1)',
        title: 'dropped by SVG rules',
        viewBox: '0 0 100 100',
        width: 100
      },
      children: [
        {
          type: 'element',
          tagName: 'circle',
          properties: {
            cx: 50,
            cy: 50,
            fill: 'red',
            onclick: 'alert(1)',
            r: 40,
            transform: 'rotate(45)'
          },
          children: []
        },
        {
          type: 'element',
          tagName: 'use',
          properties: {
            href: 'https://example.com/icon.svg#ok',
            xlinkHref: 'javascript:alert(1)'
          },
          children: []
        },
        {
          type: 'element',
          tagName: 'a',
          properties: {href: 'javascript:alert(1)'},
          children: [{type: 'text', value: 'link'}]
        },
        {
          type: 'element',
          tagName: 'foreignObject',
          properties: {height: 100, width: 100},
          children: [
            {
              type: 'element',
              tagName: 'div',
              properties: {
                onclick: 'alert(1)',
                title: 'kept by HTML rules',
                transform: 'rotate(45)'
              },
              children: [{type: 'text', value: 'HTML in SVG'}]
            }
          ]
        }
      ]
    }
  ]
}

test('sanitizeSvg()', async function (t) {
  await t.test('should keep SVG attributes in an `svg` subtree', function () {
    const clean = sanitizeSvg(tree)
    const svg = clean.children[0]

    assert.equal(svg.tagName, 'svg')
    assert.deepEqual(svg.properties, {
      height: 100,
      viewBox: '0 0 100 100',
      width: 100
    })

    const circle = svg.children[0]
    assert.equal(circle.tagName, 'circle')
    assert.deepEqual(circle.properties, {
      cx: 50,
      cy: 50,
      fill: 'red',
      r: 40,
      transform: 'rotate(45)'
    })
  })

  await t.test(
    'should apply HTML rules to same-named attributes in `foreignObject`',
    function () {
      const clean = sanitizeSvg(tree)
      const svg = clean.children[0]
      const foreignObject = svg.children[3]

      assert.equal(foreignObject.tagName, 'foreignObject')
      // `foreignObject` itself is an SVG element: SVG rules.
      assert.deepEqual(foreignObject.properties, {height: 100, width: 100})

      const div = foreignObject.children[0]
      assert.equal(div.tagName, 'div')
      // `title` is allowed on all HTML elements but not in the SVG schema,
      // `transform` is allowed in the SVG schema but not on HTML elements.
      assert.deepEqual(div.properties, {title: 'kept by HTML rules'})
    }
  )

  await t.test('should still drop dangerous URIs', function () {
    const clean = sanitizeSvg(tree)
    const svg = clean.children[0]

    const use = svg.children[1]
    assert.equal(use.tagName, 'use')
    assert.deepEqual(use.properties, {
      href: 'https://example.com/icon.svg#ok'
    })

    const a = svg.children[2]
    assert.equal(a.tagName, 'a')
    assert.deepEqual(a.properties, {})
    assert.deepEqual(a.children, [{type: 'text', value: 'link'}])
  })

  await t.test('should not change the input tree', function () {
    const snapshot = structuredClone(tree)

    sanitizeSvg(tree)
    sanitize(tree)

    assert.deepEqual(tree, snapshot)
  })

  await t.test(
    'should leave the default HTML entry (`sanitize`) unchanged',
    function () {
      const clean = sanitize(tree)

      // No SVG tag names in the default schema: `svg`, `circle`, `use`, and
      // `foreignObject` are replaced by their children, and SVG attributes
      // such as `viewBox` are unknown.
      assert.deepEqual(clean, {
        type: 'root',
        children: [
          {
            type: 'element',
            tagName: 'a',
            properties: {},
            children: [{type: 'text', value: 'link'}]
          },
          {
            type: 'element',
            tagName: 'div',
            properties: {title: 'kept by HTML rules'},
            children: [{type: 'text', value: 'HTML in SVG'}]
          }
        ]
      })
    }
  )
})
