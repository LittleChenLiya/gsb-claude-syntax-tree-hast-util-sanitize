/**
 * Small demo fixture for the schema tightening combination.
 *
 * Run with: node test/tighten-demo.js
 */
import {h} from 'hastscript'
import {toHtml} from 'hast-util-to-html'
import {u} from 'unist-builder'
import {defaultSchema, sanitize, tightenSchema} from '../index.js'

// 1. Two tiny schemas: the second one can only narrow the first.
/** @type {import('../index.js').Schema} */
const base = {
  tagNames: ['a', 'b', 'img'],
  attributes: {a: ['href', 'title'], img: ['src', 'alt']},
  protocols: {href: ['http', 'https'], src: ['http', 'https']}
}

/** @type {import('../index.js').Schema} */
const restriction = {
  tagNames: ['a', 'img'],
  attributes: {a: ['href'], img: ['src']},
  protocols: {href: ['https'], src: ['https']}
}

const combined = tightenSchema(base, restriction)

console.log('1. combined schema (intersection of both):')
console.log(JSON.stringify(combined, undefined, 2))

// 2. Dangerous nodes are still filtered by the combined schema.
const dirty = u('root', [
  h('b', 'no longer allowed'),
  h('a', {href: 'javascript:alert(1)', title: 'x'}, 'link'),
  h('a', {href: 'https://example.com'}, 'ok'),
  h('img', {src: 'https://example.com/x.png', alt: 'y'}),
  h('script', 'alert(1)')
])

console.log('\n2. sanitize with combined schema:')
console.log(toHtml(sanitize(dirty, combined)))

// 3. Fixed value intersection.
const values = tightenSchema(
  {tagNames: ['input'], attributes: {input: [['type', 'checkbox', 'radio']]}},
  {tagNames: ['input'], attributes: {input: [['type', 'radio', 'text']]}}
)

console.log('\n3. fixed value intersection:')
console.log(JSON.stringify(values.attributes))
console.log(
  toHtml(
    sanitize(
      u('root', [
        h('input', {type: 'checkbox'}),
        h('input', {type: 'radio'}),
        h('input', {type: 'text'})
      ]),
      values
    )
  )
)

// 4. Conflicts that cannot be expressed are rejected.
console.log('\n4. unexpressible conflicts:')
/** @type {Array<[string, import('../index.js').Schema, import('../index.js').Schema]>} */
const conflicts = [
  [
    'empty fixed value intersection',
    {attributes: {input: [['type', 'checkbox']]}},
    {attributes: {input: [['type', 'text']]}}
  ],
  [
    'empty protocol intersection',
    {protocols: {href: ['https']}},
    {protocols: {href: ['http']}}
  ]
]

for (const [label, a, b] of conflicts) {
  try {
    tightenSchema(a, b)
    console.log(label + ': NOT REJECTED (bug!)')
  } catch (error) {
    console.log(
      label +
        ': rejected -> ' +
        (error instanceof Error ? error.message : String(error))
    )
  }
}

// 5. The `tighten` option on `sanitize` itself.
console.log('\n5. `tighten` option on `sanitize`:')
console.log(
  toHtml(
    sanitize(
      u('root', [
        h('b', 'gone'),
        h('a', {href: 'javascript:alert(1)'}, 'js'),
        h('a', {href: 'https://example.com'}, 'ok')
      ]),
      {tighten: {tagNames: ['a'], protocols: {href: ['https']}}}
    )
  )
)

// 6. Without the option, the original interface is unchanged.
console.log('\n6. no `tighten` option (original behavior):')
console.log(
  toHtml(
    sanitize(
      u('root', [h('b', 'kept'), h('a', {href: 'https://example.com'}, 'ok')]),
      defaultSchema
    )
  )
)
