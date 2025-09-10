import { createWriteStream, existsSync } from 'fs';
import { readFile, writeFile, mkdir, readdir, stat } from 'fs/promises';
import { resolve, join, extname } from 'path';
import https from 'https';
import http from 'http';
import { URL } from 'url';
import type {
  DownloadOptions,
  DownloadIndex,
  IndexEntry,
  DownloadResult,
  DownloadProgress,
  BookRecord,
  ExtractResults
} from './types.js';

/**
 * Download manager for bulk downloading PDFs from MARC21 extracted records
 * Supports concurrent downloads, resume functionality, and error handling
 */
export class DownloadManager {
  private index: DownloadIndex = {};
  private indexPath: string;
  private currentDownloads = 0;
  private downloadQueue: string[] = [];

  constructor(private options: DownloadOptions) {
    this.options.concurrency = this.options.concurrency || 5;
    this.options.timeout = this.options.timeout || 300;
    this.indexPath = join(this.options.destinationFolder, 'index.json');
  }

  /**
   * Start the bulk download process
   */
  async startDownload(): Promise<void> {
    if (this.options.verbose) {
      console.log('🚀 Starting bulk PDF download...');
      console.log(`📁 Input folder: ${this.options.inputFolder}`);
      console.log(`💾 Destination folder: ${this.options.destinationFolder}`);
      console.log(`⚡ Concurrency: ${this.options.concurrency}`);
      console.log(`⏱️  Timeout: ${this.options.timeout}s`);
    }

    try {
      // Create destination folder
      await this.ensureDestinationFolder();
      
      // Load existing index or create new one
      await this.loadOrCreateIndex();
      
      // Process JSON files from input folder
      await this.processInputFolder();
      
      // Start downloads
      await this.executeDownloads();
      
      // Retry failed downloads
      await this.retryFailedDownloads();
      
      if (this.options.verbose) {
        const progress = this.getProgress();
        console.log('\n🎉 Download process completed!');
        console.log(`📊 Total: ${progress.total}`);
        console.log(`✅ Completed: ${progress.completed}`);
        console.log(`❌ Failed: ${progress.failed}`);
      }
      
    } catch (error) {
      throw new Error(`Download process failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Ensure destination folder exists
   */
  private async ensureDestinationFolder(): Promise<void> {
    try {
      await mkdir(this.options.destinationFolder, { recursive: true });
    } catch (error) {
      throw new Error(`Failed to create destination folder: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Load existing index.json or create a new one
   */
  private async loadOrCreateIndex(): Promise<void> {
    if (existsSync(this.indexPath)) {
      try {
        const indexContent = await readFile(this.indexPath, 'utf8');
        this.index = JSON.parse(indexContent);
        
        // Reset downloading and error states to pending for reprocessing
        let resetCount = 0;
        for (const isbn in this.index) {
          const entry = this.index[isbn];
          if (entry.downloadState === 'downloading' || entry.downloadState === 'error') {
            entry.downloadState = 'pending';
            // Clear error message when resetting
            if (entry.errorMessage) {
              delete entry.errorMessage;
            }
            resetCount++;
          }
        }
        
        if (this.options.verbose) {
          const existing = Object.keys(this.index).length;
          console.log(`📋 Loaded existing index with ${existing} entries`);
          if (resetCount > 0) {
            console.log(`🔄 Reset ${resetCount} entries from 'downloading'/'error' to 'pending'`);
          }
        }
      } catch (error) {
        if (this.options.verbose) {
          console.log('⚠️  Failed to load existing index, creating new one');
        }
        this.index = {};
      }
    } else {
      this.index = {};
      if (this.options.verbose) {
        console.log('📋 Creating new index file');
      }
    }
  }

  /**
   * Process all JSON files in the input folder
   */
  private async processInputFolder(): Promise<void> {
    try {
      const files = await readdir(this.options.inputFolder);
      const jsonFiles = files.filter(file => extname(file) === '.json');

      if (jsonFiles.length === 0) {
        throw new Error('No JSON files found in input folder');
      }

      if (this.options.verbose) {
        console.log(`📄 Found ${jsonFiles.length} JSON files to process`);
      }

      for (const file of jsonFiles) {
        await this.processJsonFile(join(this.options.inputFolder, file));
      }

      await this.saveIndex();
    } catch (error) {
      throw new Error(`Failed to process input folder: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Process a single JSON file and add records to index
   */
  private async processJsonFile(filePath: string): Promise<void> {
    try {
      const content = await readFile(filePath, 'utf8');
      const extractResults: ExtractResults = JSON.parse(content);

      for (const record of extractResults.matchingRecords) {
        if (record.ISBN && record.bookUrl) {
          const isbn = this.sanitizeISBN(record.ISBN);
          
          if (!this.index[isbn]) {
            // New record
            this.index[isbn] = {
              record,
              downloadState: 'pending'
            };
          } else {
            // Update existing record if needed
            this.index[isbn].record = record;
          }
        }
      }
    } catch (error) {
      if (this.options.verbose) {
        console.log(`⚠️  Failed to process ${filePath}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }
  }

  /**
   * Execute downloads with concurrency control
   */
  private async executeDownloads(): Promise<void> {
    // Build queue of pending downloads
    this.downloadQueue = Object.keys(this.index).filter(isbn => {
      const entry = this.index[isbn];
      return entry.downloadState === 'pending' && entry.record.bookUrl;
    });

    if (this.downloadQueue.length === 0) {
      if (this.options.verbose) {
        console.log('📋 No pending downloads found');
      }
      return;
    }

    if (this.options.verbose) {
      console.log(`🔄 Starting download of ${this.downloadQueue.length} files...`);
    }

    // Start initial downloads up to concurrency limit
    const initialBatch = Math.min(this.options.concurrency!, this.downloadQueue.length);
    const promises = [];
    
    for (let i = 0; i < initialBatch; i++) {
      promises.push(this.processDownloadQueue());
    }

    await Promise.all(promises);
  }

  /**
   * Process download queue with concurrency control
   */
  private async processDownloadQueue(): Promise<void> {
    while (this.downloadQueue.length > 0) {
      const isbn = this.downloadQueue.shift();
      if (!isbn) break;

      this.currentDownloads++;
      
      try {
        const result = await this.downloadFile(isbn);
        await this.updateIndexEntry(isbn, result);
        
        if (this.options.verbose) {
          const progress = this.getProgress();
          const status = result.success ? '✅' : '❌';
          if (result.success && result.fileSize && result.downloadTime) {
            const sizeInMB = (result.fileSize / (1024 * 1024)).toFixed(2);
            const timeInSeconds = (result.downloadTime / 1000).toFixed(1);
            console.log(`${status} [${progress.completed + progress.failed}/${progress.total}] ${isbn}.pdf completed (${sizeInMB} MB, ${timeInSeconds}s)`);
          } else {
            console.log(`${status} [${progress.completed + progress.failed}/${progress.total}] ${isbn}.pdf ${result.success ? 'completed' : `failed: ${result.errorMessage}`}`);
          }
        }
      } catch (error) {
        if (this.options.verbose) {
          console.log(`❌ Failed to download ${isbn}: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
      }
      
      this.currentDownloads--;
    }
  }

  /**
   * Download a single PDF file
   */
  private async downloadFile(isbn: string): Promise<DownloadResult> {
    const entry = this.index[isbn];
    const startTime = Date.now();
    
    if (!entry || !entry.record.bookUrl) {
      return {
        isbn,
        success: false,
        errorMessage: 'No download URL available'
      };
    }

    const filename = `${isbn}.pdf`;
    const filePath = join(this.options.destinationFolder, filename);
    
    // Check if file already exists
    if (existsSync(filePath)) {
      const stats = await stat(filePath);
      if (stats.size > 0) {
        return {
          isbn,
          success: true,
          filePath,
          downloadTime: Date.now() - startTime
        };
      }
    }

    // Update state to downloading
    entry.downloadState = 'downloading';
    await this.saveIndex();

    return this.downloadWithRedirects(entry.record.bookUrl, filePath, isbn, startTime);
  }

  /**
   * Download file with automatic redirect handling
   */
  private async downloadWithRedirects(
    urlString: string, 
    filePath: string, 
    isbn: string, 
    startTime: number, 
    redirectCount: number = 0
  ): Promise<DownloadResult> {
    const maxRedirects = 10; // Prevent infinite redirect loops
    
    if (redirectCount > maxRedirects) {
      return {
        isbn,
        success: false,
        errorMessage: 'Too many redirects (maximum 10)'
      };
    }

    return new Promise((resolve) => {
      try {
        const url = new URL(urlString);
        const client = url.protocol === 'https:' ? https : http;
        
        const request = client.get(url, {
          timeout: this.options.timeout! * 1000,
          headers: {
            'User-Agent': 'MARC21-Downloader/1.0'
          }
        }, async (response) => {
          // Handle redirects
          if (response.statusCode && [301, 302, 307, 308].includes(response.statusCode)) {
            const location = response.headers.location;
            if (location) {
              // Resolve relative URLs
              const redirectUrl = new URL(location, url).toString();
              
              
              // Follow the redirect
              const result = await this.downloadWithRedirects(
                redirectUrl, 
                filePath, 
                isbn, 
                startTime, 
                redirectCount + 1
              );
              resolve(result);
              return;
            } else {
              resolve({
                isbn,
                success: false,
                errorMessage: `HTTP ${response.statusCode}: Redirect without location header`
              });
              return;
            }
          }

          // Handle successful response
          if (response.statusCode === 200) {
            const writeStream = createWriteStream(filePath);
            response.pipe(writeStream);

            writeStream.on('finish', async () => {
              try {
                const stats = await stat(filePath);
                resolve({
                  isbn,
                  success: true,
                  filePath,
                  downloadTime: Date.now() - startTime,
                  fileSize: stats.size
                });
              } catch (error) {
                resolve({
                  isbn,
                  success: true,
                  filePath,
                  downloadTime: Date.now() - startTime
                });
              }
            });

            writeStream.on('error', (error) => {
              resolve({
                isbn,
                success: false,
                errorMessage: `Write error: ${error.message}`
              });
            });
            return;
          }

          // Handle other error status codes
          resolve({
            isbn,
            success: false,
            errorMessage: `HTTP ${response.statusCode}: ${response.statusMessage}`
          });
        });

        request.on('error', (error) => {
          resolve({
            isbn,
            success: false,
            errorMessage: `Request error: ${error.message}`
          });
        });

        request.on('timeout', () => {
          request.destroy();
          resolve({
            isbn,
            success: false,
            errorMessage: 'Request timeout'
          });
        });

      } catch (error) {
        resolve({
          isbn,
          success: false,
          errorMessage: `Download error: ${error instanceof Error ? error.message : 'Unknown error'}`
        });
      }
    });
  }

  /**
   * Update index entry with download result
   */
  private async updateIndexEntry(isbn: string, result: DownloadResult): Promise<void> {
    if (this.index[isbn]) {
      if (result.success) {
        this.index[isbn].downloadState = 'done';
        this.index[isbn].filePath = result.filePath;
        this.index[isbn].downloadedAt = new Date().toISOString();
        this.index[isbn].errorMessage = undefined;
      } else {
        this.index[isbn].downloadState = 'error';
        this.index[isbn].errorMessage = result.errorMessage;
      }
    }
    
    await this.saveIndex();
  }

  /**
   * Retry failed downloads
   */
  private async retryFailedDownloads(): Promise<void> {
    const failedDownloads = Object.keys(this.index).filter(isbn => 
      this.index[isbn].downloadState === 'error'
    );

    if (failedDownloads.length === 0) {
      return;
    }

    if (this.options.verbose) {
      console.log(`\n🔄 Retrying ${failedDownloads.length} failed downloads...`);
    }

    for (const isbn of failedDownloads) {
      this.index[isbn].downloadState = 'pending';
    }

    this.downloadQueue = [...failedDownloads];
    await this.processDownloadQueue();
  }

  /**
   * Get current download progress
   */
  private getProgress(): DownloadProgress {
    const states = Object.values(this.index).map(entry => entry.downloadState);
    
    return {
      total: states.length,
      completed: states.filter(state => state === 'done').length,
      failed: states.filter(state => state === 'error').length,
      pending: states.filter(state => state === 'pending').length,
      downloading: states.filter(state => state === 'downloading').length
    };
  }

  /**
   * Save index to file
   */
  private async saveIndex(): Promise<void> {
    try {
      const content = JSON.stringify(this.index, null, 2);
      await writeFile(this.indexPath, content, 'utf8');
    } catch (error) {
      if (this.options.verbose) {
        console.log(`⚠️  Failed to save index: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }
  }

  /**
   * Sanitize ISBN for use as filename
   */
  private sanitizeISBN(isbn: string): string {
    return isbn.replace(/[^a-zA-Z0-9]/g, '');
  }
}