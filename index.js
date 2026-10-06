/**
 * @typedef {import('./lib/index.js').Schema} Schema
 * @typedef {import('./lib/references.js').CheckReferencesOptions} CheckReferencesOptions
 * @typedef {import('./lib/references.js').DuplicateId} DuplicateId
 * @typedef {import('./lib/references.js').ReferenceIssue} ReferenceIssue
 * @typedef {import('./lib/references.js').ReferenceReport} ReferenceReport
 */

export {sanitize} from './lib/index.js'
export {checkReferences} from './lib/references.js'
export {defaultSchema} from './lib/schema.js'
