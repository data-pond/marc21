/**
 * MARC21 Category Extractor
 * A TypeScript library for extracting and categorizing MARC21 XML records
 */

export { Marc21Parser } from './parser.js';
export type {
  CategoryData,
  CategoryResults,
  CategoryCounter,
  MarcRecord,
  DataField,
  SubField,
  ParseOptions
} from './types.js';

// Re-export for convenience
export { Marc21Parser as default } from './parser.js';