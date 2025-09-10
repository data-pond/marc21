/**
 * MARC21 category extraction types and interfaces
 */

export interface CategoryData {
  name: string;
  code?: string;
  count: number;
  field: string; // '650' or '653'
}

export interface CategoryResults {
  subjectTerms: CategoryData[];     // Field 650
  keywords: CategoryData[];         // Field 653
  totalRecords: number;
  processingTime: number;
}

export interface SubField {
  $: {
    code: string;
  };
  _: string;
}

export interface DataField {
  $: {
    tag: string;
    ind1?: string;
    ind2?: string;
  };
  'marc:subfield': SubField[];
}

export interface ControlField {
  $: {
    tag: string;
  };
  _: string;
}

export interface MarcRecord {
  'marc:datafield'?: DataField[];
  'marc:controlfield'?: ControlField[];
  'marc:leader'?: string;
}

export interface ParseOptions {
  outputFile?: string;
  verbose?: boolean;
  progressInterval?: number;
  minCount?: number;
}

export interface CategoryCounter {
  [key: string]: {
    count: number;
    code?: string;
  };
}

// New interfaces for record extraction functionality
export interface ExtractOptions {
  field: string;  // '650' or '653'
  name: string;   // The category name/code to search for
  verbose?: boolean;
  progressInterval?: number;
}

export interface BookRecord {
  title: string;
  language: string | null;
  authors: string[];
  nbPages: number | null;
  publicationDate: string | null;
  bookUrl: string;
  ISBN: string | null;
  description: string | null;
  publisher: string;
  licence: string | null;
  thumnail: string | null;
}

export interface ExtractResults {
  field: string;
  name: string;
  matchingRecords: BookRecord[];
  totalMatches: number;
  processingTime: number;
  outputFile: string;
}

// New interfaces for bulk extraction functionality
export interface BulkExtractItem {
  name: string;
  count: number;
  field: string;
}

export interface BulkExtractOptions {
  xmlFile: string;
  jsonFile: string;
  destinationFolder: string;
  verbose?: boolean;
  progressInterval?: number;
}

export interface BulkExtractFileResult {
  field: string;
  name: string;
  count: number;
  expectedCount: number;
  actualMatches: number;
  outputFile: string;
  processingTime: number;
}

export interface BulkExtractResults {
  totalItems: number;
  successfulExtractions: number;
  failedExtractions: number;
  fileResults: BulkExtractFileResult[];
  totalProcessingTime: number;
}

// New interfaces for download functionality
export interface DownloadOptions {
  inputFolder: string;
  destinationFolder: string;
  concurrency?: number;
  timeout?: number;
  verbose?: boolean;
}

export type DownloadState = 'pending' | 'downloading' | 'error' | 'done';

export interface IndexEntry {
  record: BookRecord;
  downloadState: DownloadState;
  filePath?: string;
  errorMessage?: string;
  downloadedAt?: string;
}

export interface DownloadIndex {
  [isbn: string]: IndexEntry;
}

export interface DownloadResult {
  isbn: string;
  success: boolean;
  filePath?: string;
  errorMessage?: string;
  downloadTime?: number;
  fileSize?: number;
}

export interface DownloadProgress {
  total: number;
  completed: number;
  failed: number;
  pending: number;
  downloading: number;
}