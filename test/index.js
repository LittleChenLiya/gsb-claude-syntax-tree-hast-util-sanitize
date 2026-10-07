import assert from 'node:assert/strict'
import test from 'node:test'
import deepmerge from 'deepmerge'
import {h, s} from 'hastscript'
import {defaultSchema, sanitize, tightenSchema} from 'hast-util-sanitize'
import {toHtml} from 'hast-util-to-html'
import {u} from 'unist-builder'

const own = {}.hasOwnProperty

test('sanitize()', async function (t) {
  await t.test('check', async function () {
    const attributes = defaultSchema.attributes
    assert(attributes)

    const generic = new Set(
      attributes['*'].map((d) => (typeof d === 'string' ? d : d[0]))
    )

    for (const tagName in attributes) {
      if (tagName !== '*' && Object.hasOwn(attributes, tagName)) {
        const allowed = attributes[tagName]

        for (const attribute of allowed) {
          const name = typeof attribute === 'string' ? attribute : attribute[0]

          assert(
            generic.has(name) === false,
            'unexpected attribute `' +
              name +
              '` in both `*` and `' +
              tagName +
              '`, they conflict, please use one or the other'
          )
        }
      }
    }
  })

  await t.test('should expose the public api', async function () {
    assert.deepEqual(Object.keys(await import('hast-util-sanitize')).sort(), [
      'defaultSchema',
      'sanitize',
      'tightenSchema'
    ])
  })

  await t.test('should ignore non-nodes (#1)', async function () {
    assert.equal(
      toHtml(
        // @ts-expect-error: check how a non-node is handled.
        sanitize(true)
      ),
      ''
    )
  })

  await t.test('should ignore non-nodes (#2)', async function () {
    assert.equal(
      toHtml(
        // @ts-expect-error: check how a non-node is handled.
        sanitize(undefined)
      ),
      ''
    )
  })

  await t.test('should ignore non-nodes (#3)', async function () {
    assert.equal(
      toHtml(
        // @ts-expect-error: check how a non-node is handled.
        sanitize({type: 1})
      ),
      ''
    )
  })

  await t.test('should ignore unknown nodes', async function () {
    assert.equal(
      toHtml(
        sanitize(
          // @ts-expect-error: check how an unknown node is
          u('unknown', '<xml></xml>')
        )
      ),
      ''
    )
  })
})

test('`comment`', async function (t) {
  await t.test('should ignore `comment`s by default', async function () {
    assert.equal(toHtml(sanitize(u('comment', 'alpha'))), '')
  })

  await t.test(
    'should allow `comment`s with `allowComments: true`',
    async function () {
      assert.equal(
        toHtml(sanitize(u('comment', 'alpha'), {allowComments: true})),
        '<!--alpha-->'
      )
    }
  )

  await t.test(
    'should ignore non-string `value`s with `allowComments: true`',
    async function () {
      assert.equal(
        toHtml(
          // @ts-expect-error: check how non-string `value` is handled.
          sanitize({type: 'comment', value: {toString}}, {allowComments: true})
        ),
        '<!---->'
      )
    }
  )

  await t.test(
    'should not break out of comments with `allowComments: true`',
    async function () {
      assert.equal(
        toHtml(
          sanitize(u('comment', 'alpha--><script>alert(1)</script><!--bravo'), {
            allowComments: true
          })
        ),
        '<!--alpha-->'
      )
    }
  )
})

test('`doctype`', async function (t) {
  await t.test('should ignore `doctype`s by default', async function () {
    assert.equal(toHtml(sanitize(u('doctype', {name: 'html'}, 'alpha'))), '')
  })

  await t.test(
    'should allow `doctype`s with `allowDoctypes: true`',
    async function () {
      assert.equal(
        toHtml(
          sanitize(u('doctype', {name: 'html'}, 'alpha'), {
            allowDoctypes: true
          })
        ),
        '<!doctype html>'
      )
    }
  )
})

test('`text`', async function (t) {
  await t.test('should allow known properties', async function () {
    assert.deepEqual(
      sanitize({
        type: 'text',
        // @ts-expect-error: check how unknown properties on `text` are handled.
        tagName: 'div',
        value: 'alert(1)',
        unknown: 'alert(1)',
        properties: {href: 'javascript:alert(1)'},
        children: [h('script', 'alert(1)')],
        data: {href: 'alert(1)'},
        position: {
          start: {line: 1, column: 1},
          end: {line: 2, column: 1}
        }
      }),
      {
        type: 'text',
        value: 'alert(1)',
        data: {href: 'alert(1)'},
        position: {
          start: {line: 1, column: 1, offset: undefined},
          end: {line: 2, column: 1, offset: undefined}
        }
      }
    )
  })

  await t.test('should allow `text`', async function () {
    assert.equal(toHtml(sanitize(u('text', 'alert(1)'))), 'alert(1)')
  })

  await t.test('should ignore non-string `value`s', async function () {
    assert.equal(
      // @ts-expect-error: check how non-string `value` is handled.
      toHtml(sanitize({type: 'text', value: {toString}})),
      ''
    )
  })

  await t.test('should ignore `text` in `script` elements', async function () {
    assert.equal(toHtml(sanitize(h('script', {}, u('text', 'alert(1)')))), '')
  })

  await t.test('should show `text` in `style` elements', async function () {
    assert.equal(
      toHtml(sanitize(h('style', {}, u('text', 'alert(1)')))),
      'alert(1)'
    )
  })
})

test('`element`', async function (t) {
  await t.test('should allow known properties', async function () {
    assert.deepEqual(
      sanitize({
        type: 'element',
        tagName: 'div',
        // @ts-expect-error: check how unknown properties are handled.
        value: 'alert(1)',
        unknown: 'alert(1)',
        properties: {href: 'javascript:alert(1)'},
        children: [h('script', 'alert(1)')],
        data: {href: 'alert(1)'},
        position: {
          start: {line: 1, column: 1},
          end: {line: 2, column: 1}
        }
      }),
      {
        type: 'element',
        tagName: 'div',
        properties: {},
        children: [],
        data: {href: 'alert(1)'},
        position: {
          start: {line: 1, column: 1, offset: undefined},
          end: {line: 2, column: 1, offset: undefined}
        }
      }
    )
  })

  await t.test('should ignore unknown elements', async function () {
    assert.deepEqual(
      sanitize(h('unknown', {}, u('text', 'alert(1)'))),
      u('text', 'alert(1)')
    )
  })

  await t.test('should ignore elements without name', async function () {
    assert.deepEqual(
      sanitize(
        // @ts-expect-error: check how missing `tagName` is handled.
        {
          type: 'element',
          properties: {},
          children: [u('text', 'alert(1)')]
        }
      ),
      u('text', 'alert(1)')
    )
  })

  await t.test(
    'should support elements without children / properties',
    async function () {
      assert.deepEqual(
        sanitize(
          // @ts-expect-error: check how missing `children`, `properties` is handled.
          {type: 'element', tagName: 'div'}
        ),
        h('')
      )
    }
  )

  await t.test('should always return a valid node (#1)', async function () {
    assert.deepEqual(sanitize(h('unknown', [])), u('root', []))
  })

  await t.test('should always return a valid node (#2)', async function () {
    assert.deepEqual(sanitize(h('script', [])), u('root', []))
  })

  await t.test('should always return a valid node (#3)', async function () {
    assert.deepEqual(
      sanitize(h('div', h('style', [u('text', '1'), u('text', '2')]))),
      h('div', [u('text', '1'), u('text', '2')])
    )
  })

  await t.test('should always return a valid node (#4)', async function () {
    assert.deepEqual(
      sanitize(h('unknown', [u('text', 'value')])),
      u('text', 'value')
    )
  })

  await t.test('should always return a valid node (#5)', async function () {
    assert.deepEqual(
      sanitize(h('unknown', [u('text', '1'), u('text', '2')])),
      u('root', [u('text', '1'), u('text', '2')])
    )
  })

  await t.test('should allow known generic properties', async function () {
    assert.deepEqual(
      sanitize(h('div', {alt: 'alpha'})),
      h('div', {alt: 'alpha'})
    )
  })

  await t.test('should allow specific properties', async function () {
    assert.deepEqual(
      sanitize(h('a', {href: '#heading'})),
      h('a', {href: '#heading'})
    )
  })

  await t.test(
    'should ignore mismatched specific properties',
    async function () {
      assert.deepEqual(sanitize(h('img', {href: '#heading'})), h('img'))
    }
  )

  await t.test('should ignore unspecified properties', async function () {
    assert.deepEqual(sanitize(h('div', {dataFoo: 'bar'})), h('div'))
  })

  await t.test('should ignore unspecified properties', async function () {
    assert.deepEqual(sanitize(h('div', {dataFoo: 'bar'})), h('div'))
  })

  await t.test('should allow `data*`', async function () {
    assert.deepEqual(
      sanitize(
        h('div', {dataFoo: 'bar'}),
        deepmerge(defaultSchema, {attributes: {'*': ['data*']}})
      ),
      h('div', {dataFoo: 'bar'})
    )
  })

  await t.test('should allow `string`s', async function () {
    assert.deepEqual(
      sanitize(h('img', {alt: 'hello'})),
      h('img', {alt: 'hello'})
    )
  })

  await t.test('should allow `boolean`s', async function () {
    assert.deepEqual(sanitize(h('img', {alt: true})), h('img', {alt: true}))
  })

  await t.test('should allow `number`s', async function () {
    assert.deepEqual(sanitize(h('img', {alt: 1})), h('img', {alt: 1}))
  })

  await t.test('should ignore `null`', async function () {
    assert.deepEqual(
      sanitize({
        type: 'element',
        tagName: 'img',
        properties: {alt: null},
        children: []
      }),
      h('img')
    )
  })

  await t.test('should ignore `undefined`', async function () {
    assert.deepEqual(
      sanitize({
        type: 'element',
        tagName: 'img',
        properties: {alt: undefined},
        children: []
      }),
      h('img')
    )
  })

  await t.test('should prevent clobbering (`id`)', async function () {
    assert.deepEqual(
      sanitize(h('div', {id: 'getElementById'})),
      h('div', {id: 'user-content-getElementById'})
    )
  })

  await t.test('should prevent clobbering (`name`)', async function () {
    assert.deepEqual(
      sanitize(h('div', {name: 'getElementById'})),
      h('div', {name: 'user-content-getElementById'})
    )
  })

  await t.test('should ignore objects', async function () {
    assert.deepEqual(
      sanitize({
        type: 'element',
        tagName: 'img',
        properties: {
          // @ts-expect-error: check how non-string property value is handled.
          alt: {toString}
        },
        children: []
      }),
      h('img')
    )
  })

  await t.test('should supports arrays', async function () {
    assert.deepEqual(
      sanitize({
        type: 'element',
        tagName: 'img',
        properties: {
          // @ts-expect-error: check how non-string values are handled.
          alt: [1, true, 'three', [4], {toString}]
        },
        children: []
      }),
      h('img', {alt: [1, 'three']})
    )
  })

  await t.test('should ignore `svg` elements', async function () {
    assert.deepEqual(
      sanitize(s('svg', {viewBox: '0 0 50 50'}, '!')),
      u('text', '!')
    )
  })

  await t.test('should support `href`', async function () {
    testAllUrls('a', 'href', {
      valid: {
        anchor: '#heading',
        relative: '/file.html',
        search: 'example.com?foo:bar',
        hash: 'example.com#foo:bar',
        'protocol-less': 'www.example.com',
        mailto: 'mailto:foo@bar.com',
        https: 'http://example.com',
        http: 'http://example.com'
      },
      invalid: {
        javascript: 'javascript:alert(1)',
        whitespace: ' javascript:while(1){}',
        'Unicode LS/PS I': '\u2028javascript:alert(1)',
        'Unicode Whitespace (#1)': ' javascript:alert(1)',
        'Unicode Whitespace (#2)': ' javascript:alert(1)',
        'infinity loop': 'javascript:while(1){}',
        'data URL': 'data:,evilnastystuff'
      }
    })
  })

  await t.test('should support `cite`', async function () {
    testAllUrls('blockquote', 'cite', {
      valid: {
        anchor: '#heading',
        relative: '/file.html',
        search: 'example.com?foo:bar',
        hash: 'example.com#foo:bar',
        'protocol-less': 'www.example.com',
        https: 'http://example.com',
        http: 'http://example.com'
      },
      invalid: {
        mailto: 'mailto:foo@bar.com',
        javascript: 'javascript:alert(1)',
        'Unicode LS/PS I': '\u2028javascript:alert(1)',
        'Unicode Whitespace (#1)': ' javascript:alert(1)',
        'Unicode Whitespace (#2)': ' javascript:alert(1)',
        'infinity loop': 'javascript:while(1){}',
        'data URL': 'data:,evilnastystuff'
      }
    })
  })

  await t.test('should support `src`', async function () {
    testAllUrls('img', 'src', {
      valid: {
        anchor: '#heading',
        relative: '/file.html',
        search: 'example.com?foo:bar',
        hash: 'example.com#foo:bar',
        'protocol-less': 'www.example.com',
        https: 'http://example.com',
        http: 'http://example.com'
      },
      invalid: {
        mailto: 'mailto:foo@bar.com',
        javascript: 'javascript:alert(1)',
        'Unicode LS/PS I': '\u2028javascript:alert(1)',
        'Unicode Whitespace (#1)': ' javascript:alert(1)',
        'Unicode Whitespace (#2)': ' javascript:alert(1)',
        'infinity loop': 'javascript:while(1){}',
        'data URL': 'data:,evilnastystuff'
      }
    })
  })

  await t.test('should support `longDesc`', async function () {
    testAllUrls('img', 'longDesc', {
      valid: {
        anchor: '#heading',
        relative: '/file.html',
        search: 'example.com?foo:bar',
        hash: 'example.com#foo:bar',
        'protocol-less': 'www.example.com',
        https: 'http://example.com',
        http: 'http://example.com'
      },
      invalid: {
        mailto: 'mailto:foo@bar.com',
        javascript: 'javascript:alert(1)',
        'Unicode LS/PS I': '\u2028javascript:alert(1)',
        'Unicode Whitespace (#1)': ' javascript:alert(1)',
        'Unicode Whitespace (#2)': ' javascript:alert(1)',
        'infinity loop': 'javascript:while(1){}',
        'data URL': 'data:,evilnastystuff'
      }
    })
  })

  await t.test('should allow `li` outside list', async function () {
    assert.deepEqual(sanitize(h('li', 'alert(1)')), h('li', 'alert(1)'))
  })

  await t.test('should allow `li` in `ol`', async function () {
    assert.deepEqual(
      sanitize(h('ol', h('li', 'alert(1)'))),
      h('ol', h('li', 'alert(1)'))
    )
  })

  await t.test('should allow `li` in `ul`', async function () {
    assert.deepEqual(
      sanitize(h('ul', h('li', 'alert(1)'))),
      h('ul', h('li', 'alert(1)'))
    )
  })

  await t.test('should allow `li` descendant `ol`', async function () {
    assert.deepEqual(
      sanitize(h('ol', h('div', h('li', 'alert(1)')))),
      h('ol', h('div', h('li', 'alert(1)')))
    )
  })

  await t.test('should allow `li` descendant `ul`', async function () {
    assert.deepEqual(
      sanitize(h('ul', h('div', h('li', 'alert(1)')))),
      h('ul', h('div', h('li', 'alert(1)')))
    )
  })

  const tableNames = ['tr', 'td', 'th', 'tbody', 'thead', 'tfoot']
  let index = -1

  while (++index < tableNames.length) {
    const name = tableNames[index]

    await t.test(
      'should not allow `' + name + '` outside `table`',
      async function () {
        assert.deepEqual(sanitize(h(name, 'alert(1)')), u('text', 'alert(1)'))
      }
    )

    await t.test('should allow `' + name + '` in `table`', async function () {
      assert.deepEqual(
        sanitize(h('table', h(name, 'alert(1)'))),
        h('table', h(name, 'alert(1)'))
      )
    })

    await t.test(
      'should allow `' + name + '` descendant `table`',
      async function () {
        assert.deepEqual(
          sanitize(h('table', h('div', h(name, 'alert(1)')))),
          h('table', h('div', h(name, 'alert(1)')))
        )
      }
    )
  }

  await t.test('should allow only disabled checkbox inputs', async function () {
    assert.deepEqual(
      sanitize(h('input')),
      h('input', {type: 'checkbox', disabled: true})
    )
  })

  await t.test('should not allow text inputs', async function () {
    assert.deepEqual(
      sanitize(h('input', {type: 'text'})),
      h('input', {type: 'checkbox', disabled: true})
    )
  })

  await t.test('should not allow enabled inputs', async function () {
    assert.deepEqual(
      sanitize(h('input', {type: 'checkbox', disabled: false})),
      h('input', {type: 'checkbox', disabled: true})
    )
  })

  await t.test('should allow list items', async function () {
    assert.deepEqual(sanitize(h('ol', [h('li')])), h('ol', [h('li')]))
  })

  await t.test('should not allow classes on list items', async function () {
    assert.deepEqual(
      sanitize(h('ol', [h('li', {className: ['foo', 'bar']})])),
      h('ol', [h('li', {className: []})])
    )
  })

  await t.test(
    'should only allow `task-list-item` as a class on list items',
    async function () {
      assert.deepEqual(
        sanitize(h('ol', [h('li', {className: ['foo', 'task-list-item']})])),
        h('ol', [h('li', {className: ['task-list-item']})])
      )
    }
  )

  await t.test('should ignore some elements by default', async function () {
    assert.deepEqual(sanitize(h('select')), u('root', []))
  })

  await t.test(
    'should support allowing elements through the schema',
    async function () {
      assert.deepEqual(
        sanitize(h('select'), deepmerge(defaultSchema, {tagNames: ['select']})),
        h('select')
      )
    }
  )

  await t.test('should ignore attributes for new elements', async function () {
    assert.deepEqual(
      sanitize(
        h('select', {autoComplete: true}),
        deepmerge(defaultSchema, {tagNames: ['select']})
      ),
      h('select')
    )
  })

  await t.test(
    'should support allowing attributes for new elements through the schema',
    async function () {
      assert.deepEqual(
        sanitize(
          h('select', {autoComplete: true}),
          deepmerge(defaultSchema, {
            tagNames: ['select'],
            attributes: {select: ['autoComplete']}
          })
        ),
        h('select', {autoComplete: true})
      )
    }
  )

  await t.test(
    'should support a list of valid values on new attributes',
    async function () {
      assert.deepEqual(
        sanitize(
          h('div', [h('select', {form: 'one'}), h('select', {form: 'two'})]),
          deepmerge(defaultSchema, {
            tagNames: ['select'],
            attributes: {select: [['form', 'one']]}
          })
        ),
        h('div', [h('select', {form: 'one'}), h('select')])
      )
    }
  )

  await t.test(
    'should support RegExp in the list of valid values',
    async function () {
      assert.deepEqual(
        sanitize(
          h('div', [
            h('span', {className: 'a-one'}),
            h('span', {className: 'a-two'}),
            h('span', {className: 'b-one'}),
            h('span', {className: 'b-two'}),
            h('span', {className: 'a-one a-two b-one b-two'})
          ]),
          deepmerge(defaultSchema, {
            tagNames: ['span'],
            attributes: {span: [['className', /^a-/, 'b-one']]}
          })
        ),
        h('div', [
          h('span', {className: 'a-one'}),
          h('span', {className: 'a-two'}),
          h('span', {className: 'b-one'}),
          h('span', {className: []}),
          h('span', {className: 'a-one a-two b-one'})
        ])
      )
    }
  )

  await t.test(
    'should not support allowing *all* attributes',
    async function () {
      assert.deepEqual(
        sanitize(h('img', {title: true}), {
          tagNames: ['img'],
          attributes: undefined
        }),
        h('img')
      )
    }
  )

  await t.test('should support required attributes', async function () {
    assert.deepEqual(
      sanitize(
        h('div', [
          h('select', {form: 'alpha'}),
          h('select', {form: 'bravo'}),
          h('select', {}),
          h('select', {form: false})
        ]),
        deepmerge(defaultSchema, {
          tagNames: ['select'],
          attributes: {select: [['form', 'alpha']]},
          required: {select: {form: 'alpha'}}
        })
      ),
      h('div', [
        h('select', {form: 'alpha'}),
        h('select', {form: 'alpha'}),
        h('select', {form: 'alpha'}),
        h('select', {form: 'alpha'})
      ])
    )
  })

  await t.test('should support not setting `required`', async function () {
    assert.deepEqual(
      sanitize(h('input', {checked: true}), {
        tagNames: ['input'],
        required: undefined
      }),
      h('input', {checked: true})
    )
  })

  await t.test(
    'should support `ancestors` to enforce certain ancestors (rehypejs/rehype-sanitize#8)',
    async function () {
      assert.deepEqual(
        sanitize(h('div', h('li', 'text')), {
          tagNames: ['div', 'ul', 'li'],
          ancestors: {li: ['ul']}
        }),
        h('div', 'text')
      )
    }
  )

  await t.test(
    'should allow specific values allowed by either a specific or generic attribute definition (1)',
    async function () {
      assert.deepEqual(
        sanitize(
          h(null, [h('a', {x: 'y'}), h('a', {x: 'z'}), h('a', {x: 'w'})]),
          {...defaultSchema, attributes: {a: [['x', 'y']], '*': [['x', 'z']]}}
        ),
        h(null, [h('a', {x: 'y'}), h('a', {x: 'z'}), h('a')])
      )
    }
  )

  await t.test(
    'should allow specific values allowed by either a specific or generic attribute definition (2)',
    async function () {
      assert.deepEqual(
        sanitize(
          h(null, [h('a', {x: 'y'}), h('a', {x: 'z'}), h('a', {x: 'w'})]),
          // `x` on `*` can contain anything:
          {...defaultSchema, attributes: {a: ['x'], '*': [['x', 'z']]}}
        ),
        h(null, [h('a', {x: 'y'}), h('a', {x: 'z'}), h('a', {x: 'w'})])
      )
    }
  )

  await t.test(
    'should allow specific values allowed by either a specific or generic attribute definition (3)',
    async function () {
      assert.deepEqual(
        sanitize(
          h(null, [h('a', {x: 'y'}), h('a', {x: 'z'}), h('a', {x: 'w'})]),
          // `x` on `*` can contain anything:
          {...defaultSchema, attributes: {a: [['x', 'y']], '*': ['x']}}
        ),
        h(null, [h('a', {x: 'y'}), h('a', {x: 'z'}), h('a', {x: 'w'})])
      )
    }
  )
})

test('`root`', async function (t) {
  await t.test('should allow known properties', async function () {
    assert.deepEqual(
      sanitize({
        type: 'root',
        // @ts-expect-error: check how unknown properties are handled.
        tagName: 'div',
        value: 'alert(1)',
        unknown: 'alert(1)',
        properties: {href: 'javascript:alert(1)'},
        children: [h('script', 'alert(1)')],
        data: {href: 'alert(1)'},
        position: {
          start: {line: 1, column: 1},
          end: {line: 2, column: 1}
        }
      }),
      {
        type: 'root',
        children: [],
        data: {href: 'alert(1)'},
        position: {
          start: {line: 1, column: 1, offset: undefined},
          end: {line: 2, column: 1, offset: undefined}
        }
      }
    )
  })

  await t.test(
    'should support `ancestors` to enforce certain ancestors in a `root` (rehypejs/rehype-sanitize#8)',
    async function () {
      assert.deepEqual(
        sanitize(u('root', [h('div', h('li', 'text'))]), {
          tagNames: ['div', 'ul', 'li'],
          ancestors: {li: ['ul']}
        }),
        u('root', [h('div', 'text')])
      )
    }
  )
})

// Simple value to see if `toString` is called.
// Check.
function toString() {
  return 'alert(1);'
}

/**
 * Test `valid` and `invalid` `url`s in `property` on `tagName`.
 *
 * @param {string} tagName
 * @param {string} property
 * @param {{valid: Record<string, string>, invalid: Record<string, string>}} all
 */
function testAllUrls(tagName, property, all) {
  testUrls(tagName, property, all.valid, true)
  testUrls(tagName, property, all.invalid, false)
}

/**
 * Test `valid` `url`s in `property` on `tagName`.
 *
 * @param {string} tagName
 * @param {string} property
 * @param {Record<string, string>} urls
 * @param {boolean} valid
 */
function testUrls(tagName, property, urls, valid) {
  /** @type {string} */
  let name

  for (name in urls) {
    if (own.call(urls, name)) {
      const properties_ = {[property]: urls[name]}

      assert.deepEqual(
        sanitize(h(tagName, properties_)),
        h(tagName, valid ? properties_ : {}),
        'should ' + (valid ? 'allow' : 'clean') + ' ' + name
      )
    }
  }
}

test('tightenSchema()', async function (t) {
  await t.test(
    'should intersect tag names, attributes, and protocols',
    async function () {
      /** @type {import('hast-util-sanitize').Schema} */
      const base = {
        tagNames: ['a', 'b', 'img'],
        attributes: {a: ['href', 'title'], img: ['src', 'alt']},
        protocols: {href: ['http', 'https'], src: ['http', 'https']}
      }
      /** @type {import('hast-util-sanitize').Schema} */
      const restriction = {
        tagNames: ['a', 'img'],
        attributes: {a: ['href'], img: ['src']},
        protocols: {href: ['https'], src: ['https']}
      }

      const combined = tightenSchema(base, restriction)

      assert.deepEqual(combined.tagNames, ['a', 'img'])
      assert.deepEqual(combined.attributes, {a: ['href'], img: ['src']})
      assert.deepEqual(combined.protocols, {href: ['https'], src: ['https']})

      // Dangerous nodes and values are still filtered by the combined schema.
      assert.equal(
        toHtml(
          sanitize(
            u('root', [
              h('b', 'not allowed anymore'),
              h('a', {href: 'javascript:alert(1)', title: 'x'}, 'link'),
              h('img', {src: 'https://example.com/x.png', alt: 'y'}),
              h('script', 'alert(1)')
            ]),
            combined
          )
        ),
        '<a>link</a><img src="https://example.com/x.png">',
        'should filter dangerous nodes and values with the combined schema'
      )
    }
  )

  await t.test(
    'should not re-allow forbidden tag names, attributes, or protocols',
    async function () {
      /** @type {import('hast-util-sanitize').Schema} */
      const base = {
        tagNames: ['a'],
        attributes: {a: ['href']},
        protocols: {href: ['https']}
      }
      /** @type {import('hast-util-sanitize').Schema} */
      const restriction = {
        tagNames: ['a', 'script'],
        attributes: {a: ['href', 'onclick']},
        protocols: {href: ['https', 'javascript']}
      }

      const combined = tightenSchema(base, restriction)

      assert.deepEqual(combined.tagNames, ['a'])
      assert.deepEqual(combined.attributes, {a: ['href']})
      assert.deepEqual(combined.protocols, {href: ['https']})

      assert.equal(
        toHtml(
          sanitize(
            u('root', [
              h('script', 'alert(1)'),
              h('a', {href: 'javascript:alert(1)', onclick: 'alert(1)'}, 'x')
            ]),
            combined
          )
        ),
        '<a>x</a>',
        'should not re-allow items banned by the base schema'
      )
    }
  )

  await t.test('should intersect fixed attribute values', async function () {
    /** @type {import('hast-util-sanitize').Schema} */
    const base = {
      tagNames: ['input'],
      attributes: {input: [['type', 'checkbox', 'radio']]}
    }
    /** @type {import('hast-util-sanitize').Schema} */
    const restriction = {
      tagNames: ['input'],
      attributes: {input: [['type', 'radio', 'text']]}
    }

    const combined = tightenSchema(base, restriction)

    assert.deepEqual(combined.attributes, {input: [['type', 'radio']]})

    assert.equal(
      toHtml(
        sanitize(
          u('root', [
            h('input', {type: 'checkbox'}),
            h('input', {type: 'radio'}),
            h('input', {type: 'text'})
          ]),
          combined
        )
      ),
      '<input><input type="radio"><input>',
      'should only allow values allowed by both schemas'
    )
  })

  await t.test(
    'should intersect fixed values with expressions',
    async function () {
      /** @type {import('hast-util-sanitize').Schema} */
      const base = {
        tagNames: ['span'],
        attributes: {span: [['className', /^hljs-/]]}
      }
      /** @type {import('hast-util-sanitize').Schema} */
      const restriction = {
        tagNames: ['span'],
        attributes: {span: [['className', 'hljs-number', 'other']]}
      }

      const combined = tightenSchema(base, restriction)

      assert.deepEqual(combined.attributes, {
        span: [['className', 'hljs-number']]
      })

      assert.equal(
        toHtml(
          sanitize(
            u('root', [
              h('span', {className: ['hljs-number']}, 'a'),
              h('span', {className: ['hljs-string']}, 'b'),
              h('span', {className: ['other']}, 'c')
            ]),
            combined
          )
        ),
        '<span class="hljs-number">a</span><span class="">b</span><span class="">c</span>',
        'should keep only primitives matched by the expression'
      )
    }
  )

  await t.test(
    'should reject an empty fixed value intersection',
    async function () {
      /** @type {import('hast-util-sanitize').Schema} */
      const base = {
        tagNames: ['input'],
        attributes: {input: [['type', 'checkbox']]}
      }
      /** @type {import('hast-util-sanitize').Schema} */
      const restriction = {
        tagNames: ['input'],
        attributes: {input: [['type', 'text']]}
      }

      assert.throws(
        () => tightenSchema(base, restriction),
        /Cannot tighten schemas: attribute `type` on `input` has no allowed values left/,
        'should reject a fixed value conflict that cannot be expressed'
      )
    }
  )

  await t.test(
    'should reject an empty protocol intersection',
    async function () {
      /** @type {import('hast-util-sanitize').Schema} */
      const base = {protocols: {href: ['https']}}
      /** @type {import('hast-util-sanitize').Schema} */
      const restriction = {protocols: {href: ['http']}}

      assert.throws(
        () => tightenSchema(base, restriction),
        /Cannot tighten schemas: property `href` has no allowed protocols left/,
        'should reject a protocol conflict that cannot be expressed'
      )
    }
  )

  await t.test('should reject conflicting expressions', async function () {
    /** @type {import('hast-util-sanitize').Schema} */
    const base = {
      tagNames: ['code'],
      attributes: {code: [['className', /^language-/]]}
    }
    /** @type {import('hast-util-sanitize').Schema} */
    const restriction = {
      tagNames: ['code'],
      attributes: {code: [['className', /^hljs-/]]}
    }

    assert.throws(
      () => tightenSchema(base, restriction),
      /Cannot tighten schemas: conflicting expressions/,
      'should reject two different expressions for one attribute'
    )
  })

  await t.test(
    'should reject conflicting `clobberPrefix` and `required` values',
    async function () {
      assert.throws(
        () => tightenSchema({clobberPrefix: 'a-'}, {clobberPrefix: 'b-'}),
        /Cannot tighten schemas: conflicting `clobberPrefix` values/,
        'should reject conflicting clobber prefixes'
      )

      assert.throws(
        () =>
          tightenSchema(
            {required: {input: {type: 'checkbox'}}},
            {required: {input: {type: 'radio'}}}
          ),
        /Cannot tighten schemas: conflicting required values for `type` on `input`/,
        'should reject conflicting required values'
      )
    }
  )

  await t.test(
    'should union `strip` and `clobber`, and keep flags off',
    async function () {
      const combined = tightenSchema(
        {
          allowComments: true,
          allowDoctypes: true,
          strip: ['script'],
          clobber: ['id']
        },
        {
          allowComments: false,
          strip: ['style'],
          clobber: ['name']
        }
      )

      assert.equal(combined.allowComments, false, 'should turn a flag off')
      assert.equal(
        combined.allowDoctypes,
        true,
        'should keep a flag when not mentioned'
      )
      assert.deepEqual(combined.strip, ['script', 'style'])
      assert.deepEqual(combined.clobber, ['id', 'name'])

      assert.equal(
        tightenSchema({allowComments: false}, {allowComments: true})
          .allowComments,
        false,
        'should not turn a flag back on'
      )
    }
  )

  await t.test(
    'should support the `tighten` option in `sanitize`',
    async function () {
      assert.equal(
        toHtml(
          sanitize(
            u('root', [
              h('b', 'gone'),
              h('a', {href: 'javascript:alert(1)'}, 'js'),
              h('a', {href: 'https://example.com'}, 'ok')
            ]),
            {
              tighten: {
                tagNames: ['a'],
                protocols: {href: ['https']}
              }
            }
          )
        ),
        'gone<a>js</a><a href="https://example.com">ok</a>',
        'should tighten the default schema with the `tighten` option'
      )
    }
  )

  await t.test(
    'should support a list of schemas in the `tighten` option',
    async function () {
      assert.equal(
        toHtml(
          sanitize(
            u('root', [
              h('b', 'gone'),
              h('a', {href: 'http://example.com'}, 'http'),
              h('a', {href: 'https://example.com'}, 'https')
            ]),
            {
              tighten: [
                {tagNames: ['a', 'b']},
                {tagNames: ['a'], protocols: {href: ['https']}}
              ]
            }
          )
        ),
        'gone<a>http</a><a href="https://example.com">https</a>',
        'should apply every given restriction in order'
      )
    }
  )

  await t.test(
    'should work as before without the `tighten` option',
    async function () {
      assert.equal(
        toHtml(
          sanitize(
            u('root', [
              h('b', 'kept'),
              h('a', {href: 'https://example.com'}, 'ok')
            ]),
            defaultSchema
          )
        ),
        '<b>kept</b><a href="https://example.com">ok</a>',
        'should not change behavior when `tighten` is not given'
      )
    }
  )

  await t.test('should not mutate the given schemas', async function () {
    /** @type {import('hast-util-sanitize').Schema} */
    const base = {
      tagNames: ['a', 'b'],
      attributes: {a: ['href', 'title']},
      protocols: {href: ['http', 'https']}
    }
    /** @type {import('hast-util-sanitize').Schema} */
    const restriction = {
      tagNames: ['a'],
      attributes: {a: ['href']},
      protocols: {href: ['https']}
    }

    tightenSchema(base, restriction)

    assert.deepEqual(base, {
      tagNames: ['a', 'b'],
      attributes: {a: ['href', 'title']},
      protocols: {href: ['http', 'https']}
    })
    assert.deepEqual(restriction, {
      tagNames: ['a'],
      attributes: {a: ['href']},
      protocols: {href: ['https']}
    })
  })
})
