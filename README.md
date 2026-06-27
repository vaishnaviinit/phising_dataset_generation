# Phishing Screenshot Collection Pipeline

Enterprise-grade Playwright automation pipeline that collects and organizes webpage screenshots for training a **MobileCLIP-based phishing classifier**.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                     collect.ts (entry point)                 │
│                                                             │
│  CsvParser ──► QueueItem[]                                  │
│                    │                                        │
│                    ▼                                        │
│           TaskQueue (N workers, semaphore-bounded)          │
│                    │                                        │
│          ┌─────────┴──────────┐                            │
│          ▼                    ▼                            │
│     Worker 0            Worker N-1                         │
│  BrowserPool.createContext()                               │
│       │                                                    │
│       ▼                                                    │
│  PageNavigator.navigate()                                  │
│       │                                                    │
│       ▼                                                    │
│  BrandDetector + PageDiscovery                             │
│       │                                                    │
│       ▼                                                    │
│  ScreenshotCapture (desktop/mobile/fullpage/above_fold)    │
│       │                                                    │
│       ▼                                                    │
│  QualityChecker → MetadataGenerator → MetadataStore        │
│       │                                                    │
│       ▼                                                    │
│  CheckpointManager (persist progress every N URLs)         │
└─────────────────────────────────────────────────────────────┘
```

### Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| Semaphore-based task queue | Avoids ESM-only `p-queue` dependency; gives identical concurrency semantics |
| One browser per worker | Isolates crashes; simplifies resource tracking |
| Isolated context per URL | Prevents cookie/state leakage between sites |
| dHash for deduplication | Simple, fast, no FFI; Hamming distance < 10 = near-duplicate |
| JSON Lines metadata | Streaming writes; no full-file reload needed |
| Checkpoint on every N URLs | Resumes long jobs without reprocessing |

---

## Project Structure

```
phising_detection/
├── src/
│   ├── config/            # Centralised config from env vars
│   ├── types/             # All TypeScript interfaces & types
│   ├── logger/            # Winston logger (file + console)
│   ├── parser/
│   │   ├── csvParser.ts   # Streaming CSV parser
│   │   └── urlValidator.ts
│   ├── browser/
│   │   └── browserPool.ts # N Chromium browser instances
│   ├── playwright/
│   │   ├── antiDetection.ts  # Stealth scripts + context options
│   │   ├── pageNavigator.ts  # Navigate + extract metadata
│   │   ├── screenshotCapture.ts
│   │   └── pageDiscovery.ts  # Discover login/signup/checkout
│   ├── brand/
│   │   └── brandDetector.ts  # 120+ domain → brand mappings
│   ├── image/
│   │   ├── qualityChecker.ts # Blank/small detection via Sharp
│   │   └── duplicateDetector.ts # dHash + Hamming distance
│   ├── metadata/
│   │   ├── metadataGenerator.ts
│   │   └── metadataStore.ts  # JSON Lines + CSV writer
│   ├── collector/
│   │   ├── screenshotCollector.ts  # Core worker task
│   │   └── checkpointManager.ts   # Resume support
│   ├── workers/
│   │   ├── taskQueue.ts    # Semaphore-bounded async queue
│   │   └── workerPool.ts
│   ├── storage/
│   │   └── fileStorage.ts  # Directory building + failure logs
│   ├── reports/
│   │   ├── reportGenerator.ts  # JSON + CSV + Markdown stats
│   │   └── datasetSplitter.ts  # Stratified 70/15/15 split
│   ├── retry/
│   │   └── retryManager.ts  # Exponential backoff + error classification
│   ├── utils/
│   │   ├── helpers.ts
│   │   └── progress.ts     # cli-progress live display
│   ├── data/
│   │   └── curatedUrls.ts  # 70+ manually curated legitimate URLs
│   └── scripts/            # Entry points
│       ├── collect.ts      # Main collection
│       ├── resume.ts       # Resume interrupted job
│       ├── validate.ts     # Screenshot quality audit
│       ├── validateCsv.ts  # CSV validation only
│       ├── deduplicate.ts  # Remove near-duplicate images
│       ├── splitDataset.ts # Generate split manifests
│       └── generateReport.ts
├── tests/
│   ├── parser.test.ts
│   └── brand.test.ts
├── dataset/                # Output: screenshots organised by label/brand/page
├── metadata/               # metadata.json (JSON Lines) + metadata.csv
├── checkpoints/            # progress.json for resume
├── logs/                   # error.log, combined.log, failed_urls.csv, invalid_urls.csv
├── reports/                # dataset_summary.{json,csv,md}, train/val/test CSVs
├── url/                    # ← place Mendeley CSV here
├── .env.example
├── Dockerfile
├── docker-compose.yml
└── README.md
```

---

## Installation

### Prerequisites

- Node.js ≥ 18
- npm ≥ 9

### Steps

```bash
# 1. Clone / enter project
cd "phising_detection"

# 2. Install dependencies
npm install

# 3. Install Playwright browser (Chromium)
npx playwright install chromium --with-deps

# 4. Copy environment file
cp .env.example .env
# Edit .env to configure workers, timeouts, limits, etc.
```

---

## Dataset Setup

Place the Mendeley URL-Phish CSV inside the `url/` folder:

```
url/
  Dataset.csv          # will be auto-discovered
```

The pipeline recursively scans `url/` for CSV files. If multiple CSVs exist, set:

```env
CSV_FILE=Dataset.csv
```

---

## Usage

### 1. Validate the CSV (no browser needed)

```bash
npm run validate-csv
```

Output:
```
CSV Validation
──────────────────────────────────────────
File: C:\...\url\Dataset.csv

Total rows:     111660
Valid URLs:     108921
Invalid URLs:   112
Duplicates:     2627
Legitimate:     100000
Phishing:       8921
Phish ratio:    8.9%
```

### 2. Run Full Collection

```bash
npm run collect
```

With options:

```bash
# Limit to 500 URLs for testing
npm run collect -- --max-urls 500 --workers 4
```

Live progress bar:
```
████████░░░░░░░░░ 47% | ✓ 4821  ✗ 238  ⏭ 12 | 📸 18932 | ETA: 1h 12m
```

### 3. Resume After Interruption

```bash
npm run resume
```

The checkpoint file `checkpoints/progress.json` tracks every processed URL. Restarting is safe — already-processed URLs are skipped instantly.

### 4. Validate Collected Screenshots

```bash
npm run validate
```

Reports blank, too-small, or missing screenshots.

### 5. Remove Near-Duplicate Images

```bash
npm run deduplicate
```

Uses dHash (64-bit perceptual hash). Hamming distance threshold is configurable via `DUPLICATE_HASH_THRESHOLD` (default: 10).

### 6. Generate Train/Val/Test Split

```bash
npm run split
```

Creates `reports/train.csv`, `reports/validation.csv`, `reports/test.csv`.
Split is **stratified by brand + label** — no URL appears in multiple splits.

### 7. Generate Dataset Report

```bash
npm run report
```

Produces `reports/dataset_summary.{json,csv,md}`.

---

## Configuration Reference

All settings can be overridden via `.env` or environment variables.

| Variable | Default | Description |
|----------|---------|-------------|
| `WORKERS` | `6` | Concurrent browser workers |
| `HEADLESS` | `true` | Run browsers headlessly |
| `MAX_URLS` | `0` | Max URLs to process (0 = unlimited) |
| `LABEL_FILTER` | `-1` | `-1` = both, `0` = legitimate only, `1` = phishing only |
| `PAGE_TIMEOUT_MS` | `30000` | Navigation timeout |
| `SCREENSHOT_TIMEOUT_MS` | `15000` | Screenshot timeout |
| `NETWORK_IDLE_TIMEOUT_MS` | `10000` | Wait-for-networkidle timeout |
| `MAX_RETRIES` | `3` | Retry attempts per URL |
| `RETRY_DELAY_MS` | `2000` | Base retry delay (exponential backoff) |
| `CHECKPOINT_INTERVAL` | `50` | Save checkpoint every N URLs |
| `ANTI_DETECTION` | `true` | Apply stealth scripts |
| `CAPTURE_DESKTOP` | `true` | Capture 1920×1080 viewport |
| `CAPTURE_MOBILE` | `true` | Capture 390×844 (iPhone 13) |
| `CAPTURE_FULLPAGE` | `true` | Capture full scrollable page |
| `CAPTURE_ABOVEFOLD` | `true` | Capture first viewport only |
| `DUPLICATE_HASH_THRESHOLD` | `10` | Hamming distance for near-duplicate |
| `MIN_WIDTH` | `100` | Minimum screenshot width (px) |
| `MIN_HEIGHT` | `100` | Minimum screenshot height (px) |
| `SPLIT_TRAIN` | `0.70` | Train split ratio |
| `SPLIT_VAL` | `0.15` | Validation split ratio |
| `SPLIT_TEST` | `0.15` | Test split ratio |

---

## Output Structure

```
dataset/
  legitimate/
    amazon/
      homepage/
        a1b2c3d4/
          desktop.png
          mobile.png
          fullpage.png
          above_fold.png
      login/
        e5f6a7b8/
          desktop.png
          ...
  phishing/
    amazon_fake/
      homepage/
        c9d0e1f2/
          desktop.png
          ...
    generic/
      homepage/
        ...

metadata/
  metadata.json    # JSON Lines — one record per line
  metadata.csv     # Flat CSV with all fields

reports/
  dataset_summary.json
  dataset_summary.csv
  dataset_summary.md
  train.csv
  validation.csv
  test.csv
  split_summary.json

logs/
  failed_urls.csv     # URL | label | reason | status_code | error
  invalid_urls.csv    # row | url | reason
  error.log
  combined.log

checkpoints/
  progress.json       # Resume state
```

---

## Metadata Schema

Each screenshot generates one JSON record:

```json
{
  "id": "a1b2c3d4e5f6a7b8",
  "url": "https://www.amazon.com",
  "finalUrl": "https://www.amazon.com/",
  "label": 0,
  "labelName": "legitimate",
  "brand": "Amazon",
  "brandNormalized": "amazon",
  "pageType": "homepage",
  "screenshotType": "desktop",
  "screenshotPath": "/abs/path/dataset/legitimate/amazon/homepage/a1b2c3d4/desktop.png",
  "relativePath": "legitimate/amazon/homepage/a1b2c3d4/desktop.png",
  "title": "Amazon.com: Online Shopping for Electronics, Apparel...",
  "timestamp": "2024-05-15T10:23:45.123Z",
  "viewportWidth": 1920,
  "viewportHeight": 1080,
  "statusCode": 200,
  "redirectCount": 1,
  "pageLoadTimeMs": 2341,
  "fileSizeBytes": 412891,
  "imageWidth": 1920,
  "imageHeight": 1080,
  "imageHash": "3f9a1b2c4d5e6f70",
  "isBlank": false,
  "isCaptcha": false,
  "isErrorPage": false,
  "source": "csv",
  "urlFeatures": {
    "url_len": 22,
    "dom": "amazon.com",
    "entropy": 3.81,
    "is_https": 1
  }
}
```

---

## Docker

```bash
# Build image
docker build -t phishing-collector .

# Run collection (mount url/, dataset/, etc.)
docker-compose up

# Or directly
docker run --rm \
  -v "$(pwd)/url:/app/url:ro" \
  -v "$(pwd)/dataset:/app/dataset" \
  -v "$(pwd)/checkpoints:/app/checkpoints" \
  -v "$(pwd)/logs:/app/logs" \
  -v "$(pwd)/metadata:/app/metadata" \
  -v "$(pwd)/reports:/app/reports" \
  -e WORKERS=6 \
  phishing-collector
```

---

## Error Handling

| Error Type | Behaviour |
|------------|-----------|
| DNS failure | Skip immediately (non-retryable) |
| SSL error | Skip immediately |
| Timeout | Retry with backoff up to MAX_RETRIES |
| HTTP 4xx/5xx | Log to failed_urls.csv |
| CAPTCHA | Skip immediately, log |
| Blank page | Skip (quality rejected) |
| Parked domain | Skip |
| Browser crash | Retry on next worker |

---

## Image Quality Filters

The `QualityChecker` rejects screenshots that are:
- Smaller than `MIN_WIDTH × MIN_HEIGHT` (default 100×100 px)
- > 98% white or black pixels (blank page)
- Below 500 bytes on disk (empty file)

The `DuplicateDetector` uses dHash:
1. Resize screenshot to 9×8 grayscale
2. Compare each pixel with its right neighbour (8 bits per row × 8 rows = 64-bit hash)
3. Hamming distance ≤ `DUPLICATE_HASH_THRESHOLD` → near-duplicate

---

## Page Discovery

For **legitimate** URLs, the pipeline attempts to discover and capture additional page types:

| Pattern | Captured page type |
|---------|--------------------|
| Links with text "sign in / log in" | `login` |
| Links with text "sign up / register" | `signup` |
| Links with text "forgot password" | `forgot_password` |
| Links with text "checkout / cart" | `checkout` |

For **phishing** URLs, only the homepage is captured (phishing pages are typically single-page).

> **Safety**: The pipeline never submits forms, enters credentials, or completes transactions.

---

## Extending the Pipeline

### Add a new brand to detection

Edit `src/brand/brandDetector.ts` → add to `DOMAIN_MAP`:

```typescript
'mynewbrand.com': 'MyNewBrand',
```

### Add a new page type pattern

Edit `src/playwright/pageDiscovery.ts` → add to `PAGE_PATTERNS`:

```typescript
{
  type: 'terms',
  patterns: [/\b(terms of service|privacy policy)\b/i, /\/terms|\/privacy/i],
},
```

### Change the screenshot viewport

Edit `.env`:
```env
# Mobile is fixed to iPhone 13 (390×844) in code
# Desktop viewport is set in src/config/index.ts
```

Or modify `src/config/index.ts` → `viewport.desktop`.

---

## Development

```bash
# Type-check without building
npx tsc --noEmit

# Lint
npm run lint

# Format
npm run format

# Unit tests
npm test
```

---

## Dataset

The repository may contain a partially collected dataset for testing.

To generate additional screenshots:

```bash
npm run collect

--------

## License

MIT — for academic research and defensive cybersecurity purposes only.
This pipeline must not be used to create, distribute, or deploy phishing attacks.
