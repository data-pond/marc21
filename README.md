# MARC21 Category Extractor & Record Extractor

A high-performance Node.js/TypeScript CLI tool and library for extracting and categorizing MARC21 XML records, plus extracting complete book records matching specific criteria. Designed to efficiently handle large XML files (300MB+) using streaming XML parsing.

## Features

- **Memory Efficient**: Streaming XML parsing for large files (300MB+)
- **Fast Processing**: Optimized for performance with progress reporting
- **Dual Functionality**: 
  - **Category Extraction**: Extracts and counts categories from MARC21 fields (650, 653)
  - **Record Extraction**: Extracts complete book records matching specific field/name criteria
- **Flexible Output**: JSON output with organized data structure
- **Auto Directory Creation**: Creates `/extracted/` directory for record extraction outputs
- **Smart Filename Generation**: `${field}_${name}_${count}.json` format
- **CLI Interface**: Easy-to-use command line tool with subcommands
- **Library API**: Use as a TypeScript/JavaScript library
- **TypeScript Support**: Full type definitions included

## Installation

### Run locally

```bash
# Extract categories and display in console
npm run dev -- test/sample-marc21.xml --verbose

# Save to JSON file with pretty printing
npm run dev -- test/sample-marc21.xml -o output.json --pretty --verbose

# Process with custom progress interval
npm run dev -- large-file.xml --verbose -p 5000 -o categories.json
```


### Global Installation (CLI)

```bash
npm install -g @the_library/marc21
```

### Local Installation (Library)

```bash
npm install @the_library/marc21
```

## CLI Usage

The CLI provides two main commands: `categories` for extracting category statistics and `extract-records` for extracting complete book records.

### Categories Command

Extract and count categories from MARC21 fields.

```bash
# Extract categories and output to console
marc21-extract categories records.xml

# Save results to JSON file
marc21-extract categories records.xml -o categories.json

# Pretty print JSON output
marc21-extract categories records.xml -o categories.json --pretty

# Verbose mode with progress reporting
marc21-extract categories large-file.xml --verbose -p 5000

# Filter categories with minimum count (only show categories appearing 2+ times)
marc21-extract categories records.xml --min-count 2 --pretty

# Filter categories with minimum count and save to file
marc21-extract categories records.xml --min-count 5 -o filtered-categories.json
```

**Categories Command Options:**
```
Usage: marc21-extract categories [options] <file>

Extract and categorize MARC21 XML records

Arguments:
  file                    Path to MARC21 XML file

Options:
  -o, --output <file>     Output JSON file path
  -v, --verbose           Enable verbose output (default: false)
  -p, --progress <interval> Progress report interval (default: 1000)
  --min-count <count>     Minimum count for categories to be included (default: 0)
  --pretty                Pretty print JSON output (default: false)
  -h, --help              Display help for command
```

### Extract Records Command

Extract complete book records matching specific field and name criteria.

```bash
# Extract books with subject term "Education"
marc21-extract extract-records records.xml 650 "Education" --pretty

# Extract books with keyword "performance"
marc21-extract extract-records records.xml 653 "performance" --verbose
```

**Extract Records Command Options:**
```
Usage: marc21-extract extract-records [options] <file> <field> <name>

Extract book records matching specific field and name criteria

Arguments:
  file                    Path to MARC21 XML file
  field                   MARC field (650 or 653)
  name                    Category name/code to match

Options:
  -v, --verbose           Enable verbose output (default: false)
  -p, --progress <interval> Progress report interval (default: 1000)
  --pretty                Pretty print JSON output (default: false)
  -h, --help              Display help for command
```

**Output Directory Structure:**
The extract-records command automatically creates an `extracted/` directory and saves files with the naming pattern: `${field}_${name}_${count}.json`

Example outputs:
- `extracted/650_Education_8.json` - 8 books with subject term "Education"
- `extracted/653_performance_3.json` - 3 books with keyword "performance"

### Bulk Extract Command

Extract multiple categories of book records using a JSON configuration file.

**🚀 OPTIMIZED**: Uses single-pass XML parsing for maximum efficiency - parses the XML file only once for all categories instead of once per category, dramatically improving performance for large files.

```bash
# Basic bulk extraction
marc21-extract bulk-extract records.xml categories.json ./output

# Verbose mode with progress reporting
marc21-extract bulk-extract large-file.xml input.json /path/to/results --verbose -p 2000
```

**Bulk Extract Command Options:**
```
Usage: marc21-extract bulk-extract [options] <xmlFile> <jsonFile> <destinationFolder>

Bulk extract book records using categories from JSON file

Arguments:
  xmlFile               Path to MARC21 XML file
  jsonFile              Path to JSON file containing category definitions
  destinationFolder     Destination folder for extracted files

Options:
  -v, --verbose         Enable verbose output (default: false)
  -p, --progress <interval> Progress report interval (default: 1000)
  -h, --help            Display help for command
```

**JSON Input Format:**
The JSON file must contain an array of category objects with the following structure:
```json
[
  {
    "name": "Education",
    "count": 2850,
    "field": "650"
  },
  {
    "name": "performance", 
    "count": 89,
    "field": "653"
  }
]
```

**Output Files:**
For each category in the JSON file, the command creates a file named `${name}_${actualCount}.json` in the destination folder, where:
- `name` is the sanitized category name (special characters replaced with underscores)
- `actualCount` is the number of matching records found

Example outputs:
- `output/Education_8.json` - 8 books with subject term "Education"
- `output/performance_3.json` - 3 books with keyword "performance"

### Download PDFs Command

Bulk download PDF files from JSON files generated by the bulk-extract command. The download utility supports concurrent downloads, resume functionality, and comprehensive error handling.

```bash
# Basic PDF download
marc21-extract download ./json-files ./pdfs --verbose

# Download with custom concurrency and timeout
marc21-extract download ./extracted ./downloads -c 3 -t 600 --verbose

# High-speed download with 10 concurrent connections
marc21-extract download /path/to/json /path/to/pdfs -c 10 -t 120
```

**Download Command Options:**
```
Usage: marc21-extract download [options] <inputFolder> <destinationFolder>

Download PDFs from JSON files generated by bulk-extract

Arguments:
  inputFolder           Path to folder containing JSON files from bulk-extract
  destinationFolder     Destination folder for downloaded PDF files

Options:
  -c, --concurrency <number>  Number of concurrent downloads (default: 5, max: 20)
  -t, --timeout <seconds>     Download timeout in seconds (default: 300, max: 3600)
  -v, --verbose               Enable verbose output (default: false)
  -h, --help                  Display help for command
```

**Features:**
- **Concurrent Downloads**: Download multiple PDFs simultaneously (configurable 1-20)
- **Resume Functionality**: Automatically resumes interrupted downloads
- **Error Handling**: Comprehensive error tracking and retry mechanism
- **Progress Tracking**: Real-time download progress with detailed logging
- **File Naming**: PDFs saved as `${ISBN}.pdf` for easy identification
- **Index Management**: Creates and maintains `index.json` for download tracking

**Index.json Structure:**
The download command creates an `index.json` file in the destination folder that tracks all download operations:

```json
{
  "9780472057627": {
    "record": {
      "title": "Book Title",
      "authors": ["Author Name"],
      "ISBN": "9780472057627",
      "bookUrl": "https://example.com/book.pdf",
      "publisher": "Publisher Name"
    },
    "downloadState": "done",
    "filePath": "/path/to/9780472057627.pdf",
    "downloadedAt": "2023-12-01T10:30:00.000Z"
  }
}
```

**Download States:**
- `pending` - Queued for download
- `downloading` - Currently being downloaded  
- `done` - Successfully downloaded
- `error` - Download failed (with error message)

**Resume Capability:**
If the download process is interrupted, running the command again will:
- Load the existing `index.json`
- Skip already downloaded files (`done` state)
- Retry failed downloads (`error` state)
- Continue with pending downloads

### Complete Examples

```bash
# Categories extraction examples
marc21-extract categories oapen-records.xml -o categories.json --verbose -p 5000
marc21-extract categories sample.xml -o results.json --pretty
marc21-extract categories records.xml --min-count 3 -o frequent-categories.json
marc21-extract categories records.xml | jq '.subjectTerms[0:10]'

# Record extraction examples
marc21-extract extract-records sample.xml 650 "Politics and government" --pretty
marc21-extract extract-records records.xml 653 "Brazil" --verbose

# Bulk extraction examples
marc21-extract bulk-extract records.xml categories.json ./output --verbose
marc21-extract bulk-extract large-file.xml input.json /path/to/results -v -p 2000
```

## Library Usage

### TypeScript/JavaScript

```typescript
import { Marc21Parser, CategoryResults } from '@the_library/marc21';

async function extractCategories() {
  const parser = new Marc21Parser({
    verbose: true,
    progressInterval: 1000
  });

  try {
    const results: CategoryResults = await parser.parseFile('records.xml');
    
    console.log(`Processed ${results.totalRecords} records`);
    console.log(`Found ${results.subjectTerms.length} subject terms`);
    console.log(`Found ${results.keywords.length} keywords`);
    
    // Top 10 most common categories
    const topCategories = results.subjectTerms.slice(0, 10);
    topCategories.forEach(cat => {
      console.log(`${cat.name}: ${cat.count} books`);
    });
    
  } catch (error) {
    console.error('Parsing failed:', error);
  }
}

extractCategories();
```

### CommonJS

```javascript
const { Marc21Parser } = require('@the_library/marc21');

const parser = new Marc21Parser({ verbose: true });
parser.parseFile('records.xml').then(results => {
  console.log('Categories extracted:', results);
});
```

## Output Format

The tool outputs a JSON object with the following structure:

```json
{
  "subjectTerms": [
    {
      "name": "The Arts",
      "count": 891,
      "field": "650"
    }
  ],
  "keywords": [
    {
      "name": "performance",
      "count": 89,
      "field": "653"
    }
  ],
  "totalRecords": 15420,
  "processingTime": 12500
}
```

## API Reference

### Marc21Parser

#### Constructor

```typescript
new Marc21Parser(options?: ParseOptions)
```

**Options:**
- `verbose?: boolean` - Enable verbose logging
- `progressInterval?: number` - Progress report interval (default: 1000)
- `minCount?: number` - Minimum count for categories to be included (default: 0)

#### Methods

##### parseFile(filePath: string): Promise<CategoryResults>

Parse a MARC21 XML file and extract categories.

**Parameters:**
- `filePath` - Path to the MARC21 XML file

**Returns:** Promise resolving to CategoryResults object

### Types

#### CategoryData
```typescript
interface CategoryData {
  name: string;      // Category name/value
  code?: string;     // Category code (optional)
  count: number;     // Number of books in this category
  field: string;     // MARC field ('650' or '653')
}
```

#### CategoryResults
```typescript
interface CategoryResults {
  subjectTerms: CategoryData[];     // Field 650 categories  
  keywords: CategoryData[];         // Field 653 categories
  totalRecords: number;             // Total records processed
  processingTime: number;           // Processing time in milliseconds
}
```

#### BookRecord
```typescript
interface BookRecord {
  title: string;                // Book title from field 245
  language: string | null;      // Language from field 546
  authors: string[];            // Authors from fields 100/700
  nbPages: number | null;       // Number of pages from field 300
  publicationDate: string | null; // Publication date from field 260
  bookUrl: string;              // Download URL from field 856
  ISBN: string | null;          // ISBN from field 020
  description: string | null;   // Description from field 520
  publisher: string;            // Publisher from field 260
  licence: string | null;       // License from field 540
  thumnail: string | null;      // Thumbnail/cover URL from field 856
}
```

#### ExtractResults
```typescript
interface ExtractResults {
  field: string;                    // Search field (650, 653)
  name: string;                     // Search term
  matchingRecords: BookRecord[];    // Extracted book records
  totalMatches: number;             // Number of matching records
  processingTime: number;           // Processing time in milliseconds
  outputFile: string;               // Generated filename
}
```

## MARC21 Fields Supported

- **Field 020**: International Standard Book Number
  - Subfield $a: International Standard Book Number

- **Field 100/700**: Main Entry/Added Entry - Personal Name
  - Subfield $a: Personal name (authors)

- **Field 245**: Title Statement
  - Subfield $a: Title
  - Subfield $b: Remainder of title

- **Field 260**: Publication, Distribution, etc.
  - Subfield $b: Name of publisher
  - Subfield $c: Date of publication

- **Field 300**: Physical Description
  - Subfield $a: Extent (number of pages, physical format)

- **Field 520**: Summary, etc.
  - Subfield $a: Summary (book description)

- **Field 540**: Terms Governing Use and Reproduction
  - Subfield $a: Terms governing use and reproduction
  - Subfield $f: Authorization (license information)

- **Field 546**: Language Note
  - Subfield $a: Language note

- **Field 650**: Subject Added Entry-Topical Term
  - Subfield $a: Topical term or geographic name entry element

- **Field 653**: Index Term-Uncontrolled  
  - Subfield $a: Uncontrolled term

- **Field 856**: Electronic Location and Access
  - Subfield $u: Uniform Resource Identifier (download URL or thumbnail URL)
  - Subfield $z: Description (used to detect thumbnails when containing keywords like "thumbnail", "cover", or "image")

## Performance

The library is optimized for large files:

- **Memory Usage**: Constant memory usage regardless of file size
- **Streaming**: Processes records one at a time
- **Speed**: Approximately 1000-5000 records/second depending on hardware
- **Large Files**: Tested with 300MB+ XML files

## Error Handling

The library provides comprehensive error handling:

- Invalid XML structure warnings
- File access errors
- Malformed record recovery
- Progress reporting for long-running operations

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests
5. Submit a pull request

## License

ISC License - see LICENSE file for details.

## Changelog

### 1.1.0
- Added `extract-records` command for extracting complete book records
- Enhanced CLI with subcommand structure (`categories` and `extract-records`)
- Added BookRecord and ExtractResults interfaces
- Implemented automatic `/extracted/` directory creation
- Added smart filename generation: `${field}_${name}_${count}.json`
- Enhanced parser with record filtering and extraction capabilities
- Added comprehensive metadata extraction (ISBN, title, author, publisher)
- Updated documentation with new functionality examples

### 1.0.0
- Initial release
- Streaming XML parsing
- CLI interface for category extraction
- Library API
- TypeScript support
- Memory-efficient processing