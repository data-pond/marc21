#!/usr/bin/env node

import { Command } from 'commander';
import { writeFile, mkdir } from 'fs/promises';
import { resolve, join } from 'path';
import { Marc21Parser } from './parser.js';
import { DownloadManager } from './downloader.js';
import type { ParseOptions, ExtractOptions, BulkExtractOptions, DownloadOptions } from './types.js';

const program = new Command();

program
  .name('marc21-extract')
  .description('Extract and categorize MARC21 XML records')
  .version('1.0.0');

// Categories command (default behavior)
program
  .command('categories <file>')
  .description('Extract and categorize MARC21 XML records')
  .option('-o, --output <file>', 'Output JSON file path')
  .option('-v, --verbose', 'Enable verbose output', false)
  .option('-p, --progress <interval>', 'Progress report interval (default: 1000)', '1000')
  .option('--min-count <count>', 'Minimum count for categories to be included (default: 0)', '0')
  .option('--pretty', 'Pretty print JSON output', false)
  .action(async (file: string, options) => {
    try {
      const startTime = Date.now();
      
      // Validate input file
      if (!file) {
        console.error('Error: MARC21 XML file path is required');
        process.exit(1);
      }

      const inputPath = resolve(file);
      
      if (options.verbose) {
        console.log(`Input file: ${inputPath}`);
      }

      // Prepare parser options
      const parseOptions: ParseOptions = {
        verbose: options.verbose,
        progressInterval: parseInt(options.progress, 10),
        minCount: parseInt(options.minCount, 10)
      };

      // Create parser and process file
      const parser = new Marc21Parser(parseOptions);
      const results = await parser.parseFile(inputPath);

      // Generate output
      const jsonOutput = options.pretty 
        ? JSON.stringify(results, null, 2)
        : JSON.stringify(results);

      if (options.output) {
        // Write to file
        const outputPath = resolve(options.output);
        await writeFile(outputPath, jsonOutput, 'utf8');
        
        console.log(`\nResults written to: ${outputPath}`);
        console.log(`Total records processed: ${results.totalRecords}`);
        console.log(`Processing time: ${results.processingTime}ms`);
        console.log(`Categories found:`);
        console.log(`  - Subject terms: ${results.subjectTerms.length}`);
        console.log(`  - Keywords: ${results.keywords.length}`);
      } else {
        // Output to stdout
        console.log(jsonOutput);
      }

      if (options.verbose) {
        console.log('\n=== TOP 10 CATEGORIES BY TYPE ===');
        
        if (results.subjectTerms.length > 0) {
          console.log('\nSubject Terms (Field 650):');
          results.subjectTerms.slice(0, 10).forEach(cat => {
            console.log(`  ${cat.name}: ${cat.count} books`);
          });
        }

        if (results.keywords.length > 0) {
          console.log('\nKeywords (Field 653):');
          results.keywords.slice(0, 10).forEach(cat => {
            console.log(`  ${cat.name}: ${cat.count} books`);
          });
        }
      }

      const totalTime = Date.now() - startTime;
      if (options.verbose) {
        console.log(`\nTotal execution time: ${totalTime}ms`);
      }

    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : 'Unknown error');
      process.exit(1);
    }
  });

// Extract records command
program
  .command('extract-records <file> <field> <name>')
  .description('Extract book records matching specific field and name criteria')
  .option('-v, --verbose', 'Enable verbose output', false)
  .option('-p, --progress <interval>', 'Progress report interval (default: 1000)', '1000')
  .option('--pretty', 'Pretty print JSON output', false)
  .action(async (file: string, field: string, name: string, options) => {
    try {
      const startTime = Date.now();
      
      // Validate input file
      if (!file) {
        console.error('Error: MARC21 XML file path is required');
        process.exit(1);
      }

      // Validate field
      if (!['650', '653'].includes(field)) {
        console.error('Error: Field must be one of: 650, 653');
        process.exit(1);
      }

      const inputPath = resolve(file);
      
      if (options.verbose) {
        console.log(`Input file: ${inputPath}`);
        console.log(`Extracting records for field ${field} with name "${name}"`);
      }

      // Prepare parser options
      const extractOptions: ExtractOptions = {
        field,
        name,
        verbose: options.verbose,
        progressInterval: parseInt(options.progress, 10)
      };

      // Create parser and extract records
      const parser = new Marc21Parser();
      const results = await parser.extractRecords(inputPath, extractOptions);

      // Create extracted directory
      const extractedDir = resolve('extracted');
      try {
        await mkdir(extractedDir, { recursive: true });
      } catch (error) {
        // Directory might already exist, that's OK
      }

      // Generate filename: ${field}_${name}_${count}.json
      const sanitizedName = name.replace(/[^a-zA-Z0-9]/g, '_');
      const filename = `${field}_${sanitizedName}_${results.totalMatches}.json`;
      const outputPath = join(extractedDir, filename);

      // Generate output
      const jsonOutput = options.pretty 
        ? JSON.stringify(results, null, 2)
        : JSON.stringify(results);

      // Write to file
      await writeFile(outputPath, jsonOutput, 'utf8');
      
      console.log(`\n✅ Extraction completed!`);
      console.log(`📄 Records matching "${name}" in field ${field}: ${results.totalMatches}`);
      console.log(`💾 Results written to: ${outputPath}`);
      console.log(`⏱️  Processing time: ${results.processingTime}ms`);

      if (options.verbose && results.matchingRecords.length > 0) {
        console.log('\n=== SAMPLE EXTRACTED RECORDS ===');
        
        // Show first few records
        const sampleCount = Math.min(3, results.matchingRecords.length);
        for (let i = 0; i < sampleCount; i++) {
          const record = results.matchingRecords[i];
          console.log(`\nRecord ${i + 1}:`);
          if (record.title) console.log(`  Title: ${record.title}`);
          if (record.authors && record.authors.length > 0) console.log(`  Authors: ${record.authors.join(', ')}`);
          if (record.ISBN) console.log(`  ISBN: ${record.ISBN}`);
          if (record.publisher) console.log(`  Publisher: ${record.publisher}`);
          if (record.nbPages !== null) console.log(`  Pages: ${record.nbPages}`);
          if (record.publicationDate) console.log(`  Publication Date: ${record.publicationDate}`);
          if (record.language) console.log(`  Language: ${record.language}`);
        }
        
        if (results.matchingRecords.length > sampleCount) {
          console.log(`\n... and ${results.matchingRecords.length - sampleCount} more records`);
        }
      }

      const totalTime = Date.now() - startTime;
      if (options.verbose) {
        console.log(`\nTotal execution time: ${totalTime}ms`);
      }

    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : 'Unknown error');
      process.exit(1);
    }
  });

// Bulk extract records command
program
  .command('bulk-extract <xmlFile> <jsonFile> <destinationFolder>')
  .description('Bulk extract book records using categories from JSON file')
  .option('-v, --verbose', 'Enable verbose output', false)
  .option('-p, --progress <interval>', 'Progress report interval (default: 1000)', '1000')
  .action(async (xmlFile: string, jsonFile: string, destinationFolder: string, options) => {
    try {
      const startTime = Date.now();
      
      // Validate input files
      if (!xmlFile || !jsonFile || !destinationFolder) {
        console.error('Error: XML file, JSON file, and destination folder are required');
        process.exit(1);
      }

      const xmlPath = resolve(xmlFile);
      const jsonPath = resolve(jsonFile);
      
      if (options.verbose) {
        console.log(`XML file: ${xmlPath}`);
        console.log(`JSON file: ${jsonPath}`);
        console.log(`Destination folder: ${destinationFolder}`);
      }

      // Prepare bulk extraction options
      const bulkOptions: BulkExtractOptions = {
        xmlFile: xmlPath,
        jsonFile: jsonPath,
        destinationFolder,
        verbose: options.verbose,
        progressInterval: parseInt(options.progress, 10)
      };

      // Create parser and perform bulk extraction
      const parser = new Marc21Parser();
      const results = await parser.bulkExtractRecords(bulkOptions);

      console.log(`\n🎉 Bulk extraction completed!`);
      console.log(`📊 Total categories processed: ${results.totalItems}`);
      console.log(`✅ Successful extractions: ${results.successfulExtractions}`);
      console.log(`❌ Failed extractions: ${results.failedExtractions}`);
      console.log(`📁 Files saved to: ${resolve(destinationFolder)}`);
      console.log(`⏱️  Total processing time: ${results.totalProcessingTime}ms`);

      if (options.verbose && results.fileResults.length > 0) {
        console.log('\n=== EXTRACTION SUMMARY ===');
        
        // Show successful extractions
        const successful = results.fileResults.filter(r => r.actualMatches > 0);
        if (successful.length > 0) {
          console.log('\n✅ Successful extractions:');
          successful.forEach(result => {
            console.log(`  ${result.name} (${result.field}): ${result.actualMatches} records → ${result.outputFile}`);
          });
        }

        // Show failed extractions
        const failed = results.fileResults.filter(r => r.actualMatches === 0);
        if (failed.length > 0) {
          console.log('\n❌ No records found for:');
          failed.forEach(result => {
            console.log(`  ${result.name} (${result.field}): expected ${result.expectedCount} records`);
          });
        }
      }

      const totalTime = Date.now() - startTime;
      if (options.verbose) {
        console.log(`\nTotal execution time: ${totalTime}ms`);
      }

    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : 'Unknown error');
      process.exit(1);
    }
  });

// Download PDFs command
program
  .command('download <inputFolder> <destinationFolder>')
  .description('Download PDFs from JSON files generated by bulk-extract')
  .option('-c, --concurrency <number>', 'Number of concurrent downloads (default: 5)', '5')
  .option('-t, --timeout <seconds>', 'Download timeout in seconds (default: 300)', '300')
  .option('-v, --verbose', 'Enable verbose output', false)
  .action(async (inputFolder: string, destinationFolder: string, options) => {
    try {
      const startTime = Date.now();
      
      // Validate input parameters
      if (!inputFolder || !destinationFolder) {
        console.error('Error: Input folder and destination folder are required');
        process.exit(1);
      }

      const inputPath = resolve(inputFolder);
      const destinationPath = resolve(destinationFolder);
      
      if (options.verbose) {
        console.log(`Input folder: ${inputPath}`);
        console.log(`Destination folder: ${destinationPath}`);
      }

      // Prepare download options
      const downloadOptions: DownloadOptions = {
        inputFolder: inputPath,
        destinationFolder: destinationPath,
        concurrency: parseInt(options.concurrency, 10),
        timeout: parseInt(options.timeout, 10),
        verbose: options.verbose
      };

      // Validate options
      if (downloadOptions.concurrency! < 1 || downloadOptions.concurrency! > 20) {
        console.error('Error: Concurrency must be between 1 and 20');
        process.exit(1);
      }

      if (downloadOptions.timeout! < 10 || downloadOptions.timeout! > 3600) {
        console.error('Error: Timeout must be between 10 and 3600 seconds');
        process.exit(1);
      }

      // Create download manager and start downloads
      const downloader = new DownloadManager(downloadOptions);
      await downloader.startDownload();

      const totalTime = Date.now() - startTime;
      if (options.verbose) {
        console.log(`\nTotal execution time: ${totalTime}ms`);
      }

    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : 'Unknown error');
      process.exit(1);
    }
  });

// Add examples to help
program.addHelpText('after', `
Examples:
  Categories:
    $ marc21-extract categories data.xml -o categories.json --pretty
    $ marc21-extract categories large-file.xml --verbose -p 5000
    $ marc21-extract categories records.xml -o output.json -v

  Extract Records:
    $ marc21-extract extract-records records.xml 650 "Education" --pretty
    $ marc21-extract extract-records large-file.xml 653 "performance" -v -p 5000

  Bulk Extract:
    $ marc21-extract bulk-extract records.xml categories.json ./output --verbose
    $ marc21-extract bulk-extract large-file.xml input.json /path/to/results -v -p 2000

  Download PDFs:
    $ marc21-extract download ./json-files ./pdfs --verbose
    $ marc21-extract download ./extracted ./downloads -c 3 -t 600 --verbose
    $ marc21-extract download /path/to/json /path/to/pdfs -c 10 -t 120
`);

program.parse();