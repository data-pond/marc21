import { createReadStream } from 'fs';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { join, resolve } from 'path';
import { parseString } from 'xml2js';
import type {
  CategoryData,
  CategoryResults,
  CategoryCounter,
  MarcRecord,
  SubField,
  ParseOptions,
  ExtractOptions,
  BookRecord,
  ExtractResults,
  BulkExtractOptions,
  BulkExtractResults,
  BulkExtractItem,
  BulkExtractFileResult
} from './types.js';

/**
 * Streaming XML parser for MARC21 records
 * Efficiently processes large XML files by parsing records one at a time
 */
export class Marc21Parser {
  private subjectTerms: CategoryCounter = {};
  private keywords: CategoryCounter = {};
  private totalRecords = 0;
  private startTime = 0;

  constructor(private options: ParseOptions = {}) {
    this.options.progressInterval = this.options.progressInterval || 1000;
  }

  /**
   * Parse a MARC21 XML file and extract categories
   */
  async parseFile(filePath: string): Promise<CategoryResults> {
    this.startTime = Date.now();
    this.resetCounters();

    if (this.options.verbose) {
      console.log(`Starting to parse MARC21 file: ${filePath}`);
    }

    try {
      await this.processXmlFile(filePath);
      
      const results = this.generateResults();
      
      if (this.options.verbose) {
        console.log(`\nParsing completed in ${results.processingTime}ms`);
        console.log(`Processed ${results.totalRecords} records`);
      }

      return results;
    } catch (error) {
      throw new Error(`Failed to parse MARC21 file: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Process the XML file using streaming approach
   */
  private async processXmlFile(filePath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const fileStream = createReadStream(filePath, { encoding: 'utf8' });
      let buffer = '';
      let recordCount = 0;

      fileStream.on('data', (chunk: string | Buffer) => {
        buffer += chunk.toString();
        
        // Process complete MARC records
        let recordStart = 0;
        let recordEnd = buffer.indexOf('</marc:record>', recordStart);
        
        while (recordEnd !== -1) {
          const recordXml = buffer.substring(recordStart, recordEnd + '</marc:record>'.length);
          
          // Find the start of this record
          const recordStartTag = recordXml.lastIndexOf('<marc:record>');
          if (recordStartTag !== -1) {
            const completeRecord = recordXml.substring(recordStartTag);
            this.processRecord(completeRecord);
            recordCount++;
            
            if (this.options.verbose && recordCount % this.options.progressInterval! === 0) {
              console.log(`Processed ${recordCount} records...`);
            }
          }
          
          recordStart = recordEnd + '</marc:record>'.length;
          recordEnd = buffer.indexOf('</marc:record>', recordStart);
        }
        
        // Keep remaining buffer for next chunk
        buffer = buffer.substring(recordStart);
      });

      fileStream.on('end', () => {
        resolve();
      });

      fileStream.on('error', (error) => {
        reject(error);
      });
    });
  }

  /**
   * Process a single MARC record
   */
  private processRecord(recordXml: string): void {
    try {
      parseString(recordXml, { 
        explicitArray: false,
        mergeAttrs: false,
        explicitRoot: false
      }, (err, result) => {
        if (err) {
          console.warn('Failed to parse record:', err.message);
          return;
        }

        const record = result as MarcRecord;
        this.extractCategories(record);
        this.totalRecords++;
      });
    } catch (error) {
      console.warn('Error processing record:', error);
    }
  }

  /**
   * Extract categories from a MARC record
   */
  private extractCategories(record: MarcRecord): void {
    if (!record['marc:datafield']) {
      return;
    }

    const dataFields = Array.isArray(record['marc:datafield']) 
      ? record['marc:datafield'] 
      : [record['marc:datafield']];

    for (const dataField of dataFields) {
      if (!dataField || !dataField.$) continue;

      const tag = dataField.$.tag;
      const subFields = Array.isArray(dataField['marc:subfield']) 
        ? dataField['marc:subfield'] 
        : dataField['marc:subfield'] ? [dataField['marc:subfield']] : [];

      switch (tag) {
        case '650': // Subject headings
          this.extractSubjectTerms(subFields);
          break;
        case '653': // Keywords
          this.extractKeywords(subFields);
          break;
      }
    }
  }


  /**
   * Extract subject terms from field 650
   */
  private extractSubjectTerms(subFields: SubField[]): void {
    for (const subField of subFields) {
      if (subField.$.code === 'a' && subField._) {
        const term = subField._.trim();
        if (term) {
          if (!this.subjectTerms[term]) {
            this.subjectTerms[term] = { count: 0 };
          }
          this.subjectTerms[term].count++;
        }
      }
    }
  }

  /**
   * Extract keywords from field 653
   */
  private extractKeywords(subFields: SubField[]): void {
    for (const subField of subFields) {
      if (subField.$.code === 'a' && subField._) {
        const keyword = subField._.trim();
        if (keyword) {
          if (!this.keywords[keyword]) {
            this.keywords[keyword] = { count: 0 };
          }
          this.keywords[keyword].count++;
        }
      }
    }
  }

  /**
   * Generate final results
   */
  private generateResults(): CategoryResults {
    const processingTime = Date.now() - this.startTime;

    return {
      subjectTerms: this.convertToSortedArray(this.subjectTerms, '650'),
      keywords: this.convertToSortedArray(this.keywords, '653'),
      totalRecords: this.totalRecords,
      processingTime
    };
  }

  /**
   * Convert counter object to sorted array
   */
  private convertToSortedArray(counter: CategoryCounter, field: string): CategoryData[] {
    const minCount = this.options.minCount || 0;
    
    return Object.entries(counter)
      .map(([name, data]) => ({
        name,
        code: data.code,
        count: data.count,
        field
      }))
      .filter(category => category.count >= minCount) // Filter by minimum count
      .sort((a, b) => b.count - a.count); // Sort by count descending
  }

  /**
   * Reset all counters
   */
  private resetCounters(): void {
    this.subjectTerms = {};
    this.keywords = {};
    this.totalRecords = 0;
  }

  /**
   * Extract records matching specific field and name criteria
   */
  async extractRecords(filePath: string, options: ExtractOptions): Promise<ExtractResults> {
    const startTime = Date.now();
    const matchingRecords: BookRecord[] = [];

    if (options.verbose) {
      console.log(`Extracting records for field ${options.field} with name "${options.name}" from: ${filePath}`);
    }

    try {
      await this.processXmlFileForExtraction(filePath, options, matchingRecords);
      
      const processingTime = Date.now() - startTime;
      
      if (options.verbose) {
        console.log(`\nExtraction completed in ${processingTime}ms`);
        console.log(`Found ${matchingRecords.length} matching records`);
      }

      return {
        field: options.field,
        name: options.name,
        matchingRecords,
        totalMatches: matchingRecords.length,
        processingTime,
        outputFile: '' // Will be set by CLI
      };
    } catch (error) {
      throw new Error(`Failed to extract records: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Process XML file for record extraction
   */
  private async processXmlFileForExtraction(
    filePath: string, 
    options: ExtractOptions, 
    matchingRecords: BookRecord[]
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const fileStream = createReadStream(filePath, { encoding: 'utf8' });
      let buffer = '';
      let recordCount = 0;

      fileStream.on('data', (chunk: string | Buffer) => {
        buffer += chunk.toString();
        
        // Process complete MARC records
        let recordStart = 0;
        let recordEnd = buffer.indexOf('</marc:record>', recordStart);
        
        while (recordEnd !== -1) {
          const recordXml = buffer.substring(recordStart, recordEnd + '</marc:record>'.length);
          
          // Find the start of this record
          const recordStartTag = recordXml.lastIndexOf('<marc:record>');
          if (recordStartTag !== -1) {
            const completeRecord = recordXml.substring(recordStartTag);
            this.processRecordForExtraction(completeRecord, options, matchingRecords);
            recordCount++;
            
            if (options.verbose && recordCount % (options.progressInterval || 1000) === 0) {
              console.log(`Processed ${recordCount} records, found ${matchingRecords.length} matches...`);
            }
          }
          
          recordStart = recordEnd + '</marc:record>'.length;
          recordEnd = buffer.indexOf('</marc:record>', recordStart);
        }
        
        // Keep remaining buffer for next chunk
        buffer = buffer.substring(recordStart);
      });

      fileStream.on('end', () => {
        resolve();
      });

      fileStream.on('error', (error) => {
        reject(error);
      });
    });
  }

  /**
   * Process a single MARC record for extraction
   */
  private processRecordForExtraction(
    recordXml: string, 
    options: ExtractOptions, 
    matchingRecords: BookRecord[]
  ): void {
    try {
      parseString(recordXml, { 
        explicitArray: false,
        mergeAttrs: false,
        explicitRoot: false
      }, (err, result) => {
        if (err) {
          console.warn('Failed to parse record:', err.message);
          return;
        }

        const record = result as MarcRecord;
        if (this.recordMatchesCriteria(record, options)) {
          const bookRecord = this.convertToBookRecord(record);
          matchingRecords.push(bookRecord);
        }
      });
    } catch (error) {
      console.warn('Error processing record for extraction:', error);
    }
  }

  /**
   * Check if a record matches the extraction criteria
   */
  private recordMatchesCriteria(record: MarcRecord, options: ExtractOptions): boolean {
    if (!record['marc:datafield']) {
      return false;
    }

    const dataFields = Array.isArray(record['marc:datafield']) 
      ? record['marc:datafield'] 
      : [record['marc:datafield']];

    for (const dataField of dataFields) {
      if (!dataField || !dataField.$) continue;

      const tag = dataField.$.tag;
      if (tag === options.field) {
        const subFields = Array.isArray(dataField['marc:subfield']) 
          ? dataField['marc:subfield'] 
          : dataField['marc:subfield'] ? [dataField['marc:subfield']] : [];

        for (const subField of subFields) {
          if (subField.$.code === 'a' && subField._) {
            const value = subField._.trim();
            if (value === options.name) {
              return true;
            }
          }
        }
      }
    }

    return false;
  }

  /**
   * Convert MARC record to BookRecord format
   */
  private convertToBookRecord(record: MarcRecord): BookRecord {
    // Initialize with default values
    const bookRecord: BookRecord = {
      title: '',
      language: null,
      authors: [],
      nbPages: null,
      publicationDate: null,
      bookUrl: '',
      ISBN: null,
      description: null,
      publisher: '',
      licence: null,
      thumnail: null
    };

    if (!record['marc:datafield']) {
      return bookRecord;
    }

    const dataFields = Array.isArray(record['marc:datafield']) 
      ? record['marc:datafield'] 
      : [record['marc:datafield']];

    // Process data fields
    for (const dataField of dataFields) {
      if (!dataField || !dataField.$) continue;

      const tag = dataField.$.tag;
      const subFields = Array.isArray(dataField['marc:subfield']) 
        ? dataField['marc:subfield'] 
        : dataField['marc:subfield'] ? [dataField['marc:subfield']] : [];

      switch (tag) {
        case '020': // ISBN
          if (!bookRecord.ISBN) {
            for (const subField of subFields) {
              if (subField.$.code === 'a' && subField._) {
                bookRecord.ISBN = subField._.trim();
                break; // Take first ISBN
              }
            }
          }
          break;

        case '100': // Main author
        case '700': // Additional authors
          for (const subField of subFields) {
            if (subField.$.code === 'a' && subField._) {
              const author = subField._.trim();
              if (author && !bookRecord.authors.includes(author)) {
                bookRecord.authors.push(author);
              }
            }
          }
          break;

        case '245': // Title
          let title = '';
          let subtitle = '';
          for (const subField of subFields) {
            if (subField.$.code === 'a' && subField._) {
              title = subField._.trim();
            } else if (subField.$.code === 'b' && subField._) {
              subtitle = subField._.trim();
            }
          }
          bookRecord.title = subtitle ? `${title}: ${subtitle}` : title;
          break;

        case '260': // Publication info
          for (const subField of subFields) {
            if (subField.$.code === 'b' && subField._) {
              bookRecord.publisher = subField._.trim();
            } else if (subField.$.code === 'c' && subField._) {
              bookRecord.publicationDate = subField._.trim();
            }
          }
          break;

        case '300': // Physical description (number of pages)
          for (const subField of subFields) {
            if (subField.$.code === 'a' && subField._) {
              const physicalDesc = subField._.trim();
              // Extract number from descriptions like "1 electronic resource (336 p.)" or "250 pages"
              const pageMatch = physicalDesc.match(/(\d+)\s*(?:p\.?|pages?)/i);
              if (pageMatch) {
                bookRecord.nbPages = parseInt(pageMatch[1], 10);
              }
              break;
            }
          }
          break;

        case '520': // Summary/Abstract/Description
          for (const subField of subFields) {
            if (subField.$.code === 'a' && subField._) {
              bookRecord.description = subField._.trim();
              break; // Take first description
            }
          }
          break;

        case '540': // Terms Governing Use and Reproduction (License)
          for (const subField of subFields) {
            if ((subField.$.code === 'a' || subField.$.code === 'f') && subField._) {
              if (!bookRecord.licence) {
                bookRecord.licence = subField._.trim();
              }
            }
          }
          break;

        case '546': // Language Note
          for (const subField of subFields) {
            if (subField.$.code === 'a' && subField._) {
              bookRecord.language = subField._.trim();
              break; // Take first language
            }
          }
          break;

        case '856': // Electronic location and access (URLs including thumbnails)
          let url = '';
          let description = '';
          
          // Collect URL and description for this 856 field
          for (const subField of subFields) {
            if (subField.$.code === 'u' && subField._) {
              url = subField._.trim();
            } else if (subField.$.code === 'z' && subField._) {
              description = subField._.trim().toLowerCase();
            }
          }
          
          if (url) {
            // Check if this might be a thumbnail URL
            const urlLower = url.toLowerCase();
            const isThumbnail = description.includes('thumbnail') || 
                               description.includes('cover') || 
                               description.includes('image') ||
                               urlLower.includes('thumbnail') || 
                               urlLower.includes('cover') || 
                               urlLower.includes('image') ||
                               urlLower.includes('thumb');
            
            if (isThumbnail && !bookRecord.thumnail) {
              bookRecord.thumnail = url;
            } else if (!bookRecord.bookUrl) {
              // If no thumbnail indicators and we don't have a main URL yet, use as main URL
              bookRecord.bookUrl = url;
            }
          }
          break;
      }
    }

    return bookRecord;
  }

  /**
   * Bulk extract records from multiple categories defined in a JSON file
   * OPTIMIZED: Parses XML file only once for all categories instead of once per category
   */
  async bulkExtractRecords(options: BulkExtractOptions): Promise<BulkExtractResults> {
    const startTime = Date.now();
    const fileResults: BulkExtractFileResult[] = [];
    let successfulExtractions = 0;
    let failedExtractions = 0;

    if (options.verbose) {
      console.log(`Starting optimized bulk extraction from: ${options.xmlFile}`);
      console.log(`Using categories from: ${options.jsonFile}`);
      console.log(`Destination folder: ${options.destinationFolder}`);
    }

    try {
      // Read and parse JSON file
      const jsonContent = await readFile(resolve(options.jsonFile), 'utf8');
      const categories: BulkExtractItem[] = JSON.parse(jsonContent);

      if (!Array.isArray(categories)) {
        throw new Error('JSON file must contain an array of category objects');
      }

      // Validate category structure
      for (const category of categories) {
        if (!category.name || !category.field || typeof category.count !== 'number') {
          throw new Error('Each category must have "name", "field", and "count" properties');
        }
        if (!['650', '653'].includes(category.field)) {
          throw new Error(`Invalid field "${category.field}". Must be "650" or "653"`);
        }
      }

      // Create destination folder
      const destinationPath = resolve(options.destinationFolder);
      try {
        await mkdir(destinationPath, { recursive: true });
      } catch (error) {
        if (options.verbose) {
          console.log(`Destination folder already exists or created successfully`);
        }
      }

      if (options.verbose) {
        console.log(`Processing ${categories.length} categories in single XML parse...`);
      }

      // OPTIMIZATION: Parse XML file once and collect records for all categories
      const categoryBuckets = await this.extractAllCategoriesInSinglePass(options.xmlFile, categories, options);

      // Process results for each category and write files
      for (let i = 0; i < categories.length; i++) {
        const category = categories[i];
        const categoryKey = `${category.field}:${category.name}`;
        const matchingRecords = categoryBuckets.get(categoryKey) || [];
        const itemStartTime = Date.now();

        try {
          if (options.verbose) {
            console.log(`\n[${i + 1}/${categories.length}] Writing "${category.name}" (${matchingRecords.length} records)...`);
          }

          // Generate filename: ${name}_${actualCount}.json
          const sanitizedName = category.name.replace(/[^a-zA-Z0-9]/g, '_');
          const filename = `${sanitizedName}_${matchingRecords.length}.json`;
          const outputPath = join(destinationPath, filename);

          // Create ExtractResults object similar to single extraction
          const extractResults: ExtractResults = {
            field: category.field,
            name: category.name,
            matchingRecords,
            totalMatches: matchingRecords.length,
            processingTime: 0, // Will be set per file
            outputFile: outputPath
          };

          // Write results to file
          const fileContent = JSON.stringify(extractResults, null, 2);
          await writeFile(outputPath, fileContent, 'utf8');

          const itemProcessingTime = Date.now() - itemStartTime;
          extractResults.processingTime = itemProcessingTime;

          const fileResult: BulkExtractFileResult = {
            field: category.field,
            name: category.name,
            count: category.count,
            expectedCount: category.count,
            actualMatches: matchingRecords.length,
            outputFile: outputPath,
            processingTime: itemProcessingTime
          };

          fileResults.push(fileResult);
          successfulExtractions++;

          if (options.verbose) {
            console.log(`✅ Success: Found ${matchingRecords.length} records (expected: ${category.count})`);
            console.log(`📄 Saved to: ${outputPath}`);
            console.log(`⏱️  Time: ${itemProcessingTime}ms`);
          }

        } catch (error) {
          failedExtractions++;
          const itemProcessingTime = Date.now() - itemStartTime;
          
          const fileResult: BulkExtractFileResult = {
            field: category.field,
            name: category.name,
            count: category.count,
            expectedCount: category.count,
            actualMatches: 0,
            outputFile: '',
            processingTime: itemProcessingTime
          };

          fileResults.push(fileResult);

          if (options.verbose) {
            console.log(`❌ Failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
          }
        }
      }

      const totalProcessingTime = Date.now() - startTime;

      if (options.verbose) {
        console.log(`\n🎉 Optimized bulk extraction completed!`);
        console.log(`📊 Total categories processed: ${categories.length}`);
        console.log(`✅ Successful extractions: ${successfulExtractions}`);
        console.log(`❌ Failed extractions: ${failedExtractions}`);
        console.log(`⏱️  Total time: ${totalProcessingTime}ms (single XML parse)`);
      }

      return {
        totalItems: categories.length,
        successfulExtractions,
        failedExtractions,
        fileResults,
        totalProcessingTime
      };

    } catch (error) {
      throw new Error(`Bulk extraction failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * OPTIMIZATION: Extract all categories in a single XML parse pass
   * Returns a Map with category keys (field:name) to arrays of matching BookRecords
   */
  private async extractAllCategoriesInSinglePass(
    filePath: string, 
    categories: BulkExtractItem[],
    options: BulkExtractOptions
  ): Promise<Map<string, BookRecord[]>> {
    const categoryBuckets = new Map<string, BookRecord[]>();
    
    // Initialize buckets for each category
    for (const category of categories) {
      const key = `${category.field}:${category.name}`;
      categoryBuckets.set(key, []);
    }

    return new Promise((resolve, reject) => {
      const fileStream = createReadStream(filePath, { encoding: 'utf8' });
      let buffer = '';
      let recordCount = 0;

      fileStream.on('data', (chunk: string | Buffer) => {
        buffer += chunk.toString();
        
        // Process complete MARC records
        let recordStart = 0;
        let recordEnd = buffer.indexOf('</marc:record>', recordStart);
        
        while (recordEnd !== -1) {
          const recordXml = buffer.substring(recordStart, recordEnd + '</marc:record>'.length);
          
          // Find the start of this record
          const recordStartTag = recordXml.lastIndexOf('<marc:record>');
          if (recordStartTag !== -1) {
            const completeRecord = recordXml.substring(recordStartTag);
            this.processRecordForAllCategories(completeRecord, categories, categoryBuckets);
            recordCount++;
            
            if (options.verbose && recordCount % (options.progressInterval || 1000) === 0) {
              const totalMatches = Array.from(categoryBuckets.values()).reduce((sum, bucket) => sum + bucket.length, 0);
              console.log(`Processed ${recordCount} records, found ${totalMatches} total matches...`);
            }
          }
          
          recordStart = recordEnd + '</marc:record>'.length;
          recordEnd = buffer.indexOf('</marc:record>', recordStart);
        }
        
        // Keep remaining buffer for next chunk
        buffer = buffer.substring(recordStart);
      });

      fileStream.on('end', () => {
        if (options.verbose) {
          const totalMatches = Array.from(categoryBuckets.values()).reduce((sum, bucket) => sum + bucket.length, 0);
          console.log(`\n📋 Single-pass extraction complete: ${recordCount} records processed, ${totalMatches} total matches found`);
        }
        resolve(categoryBuckets);
      });

      fileStream.on('error', (error) => {
        reject(error);
      });
    });
  }

  /**
   * Process a single MARC record against all categories in one pass
   */
  private processRecordForAllCategories(
    recordXml: string, 
    categories: BulkExtractItem[],
    categoryBuckets: Map<string, BookRecord[]>
  ): void {
    try {
      parseString(recordXml, { 
        explicitArray: false,
        mergeAttrs: false,
        explicitRoot: false
      }, (err, result) => {
        if (err) {
          console.warn('Failed to parse record:', err.message);
          return;
        }

        const record = result as MarcRecord;
        
        // Check this record against all categories
        for (const category of categories) {
          if (this.recordMatchesCategoryFilter(record, category.field, category.name)) {
            const bookRecord = this.convertToBookRecord(record);
            const key = `${category.field}:${category.name}`;
            const bucket = categoryBuckets.get(key);
            if (bucket) {
              bucket.push(bookRecord);
            }
          }
        }
      });
    } catch (error) {
      console.warn('Error processing record for all categories:', error);
    }
  }

  /**
   * Check if a record matches a specific field and name (refactored from recordMatchesCriteria)
   */
  private recordMatchesCategoryFilter(record: MarcRecord, field: string, name: string): boolean {
    if (!record['marc:datafield']) {
      return false;
    }

    const dataFields = Array.isArray(record['marc:datafield']) 
      ? record['marc:datafield'] 
      : [record['marc:datafield']];

    for (const dataField of dataFields) {
      if (!dataField || !dataField.$) continue;

      const tag = dataField.$.tag;
      if (tag === field) {
        const subFields = Array.isArray(dataField['marc:subfield']) 
          ? dataField['marc:subfield'] 
          : dataField['marc:subfield'] ? [dataField['marc:subfield']] : [];

        for (const subField of subFields) {
          if (subField.$.code === 'a' && subField._) {
            const value = subField._.trim();
            if (value === name) {
              return true;
            }
          }
        }
      }
    }

    return false;
  }
}