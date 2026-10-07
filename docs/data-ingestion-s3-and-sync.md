# Data ingestion: S3, knowledge base sync, and spreadsheet indexes

How documents and spreadsheets get into the assistant: uploading through the admin console or directly to S3, what updates automatically, and how the staging and sync pipeline routes files.

---

## Two separate systems

| Concern | Bucket | How chat uses it | Updates when |
|---------|--------|------------------|--------------|
| **Knowledge base documents** (PDFs and other files) | **Knowledge bucket** (`KnowledgeSourceBucket`) | Bedrock Knowledge Base, then OpenSearch retrieval (`query_db`, `retrieve_full_document`) | After a **Knowledge Base ingestion job**, started by **Sync data now** or by the weekly schedule |
| **Spreadsheet indexes** (structured tabular data) | **Index bucket** (`ContractIndexBucket`) | `query_excel_index` tool reads rows from **DynamoDB** | An **S3 event** triggers the parser Lambda (no ingestion job) |

They are not interchangeable. Putting an `.xlsx` in the knowledge bucket does not create an index, and putting a PDF in the index bucket does nothing. The two pipelines run independently.

> **Staging layer:** data can also land in the **staging bucket** (`DataStagingBucket`) under the prefixes `documents/` and `indexes/`. The sync orchestrator then moves those files to the knowledge bucket and the index bucket. See [Sync orchestrator](#sync-orchestrator-staging-to-knowledge-base-and-index).

---

## Knowledge base documents (knowledge bucket)

### Listing versus retrieval

- The admin **Documents** tab lists objects from live S3 (`ListObjectsV2`). Adding or deleting an object in S3 (console or API) shows up on refresh, the same as an upload through the console.
- Chat retrieval uses the vector index that Bedrock builds. That index does not update on every S3 change.

### Manual S3 changes

| Action | File list in the UI | Chat and Knowledge Base answers |
|--------|---------------------|---------------------------------|
| Upload (S3 console or the app) | Reflects S3 | New documents are **not** searchable until a sync runs |
| Delete **through the admin UI** | Reflects S3 | Chunks are removed from the Knowledge Base before the S3 object is deleted, so the assistant stops citing the file right away |
| Delete **directly in S3** | Reflects S3 | Stale chunks can be returned **until the next successful sync**, because the chunk cleanup step is skipped |

The Documents tab also shows a per-document sync status (synced, syncing, failed, not yet synced), read from Bedrock's `ListKnowledgeBaseDocuments`, so you can see which uploads still need a sync.

### Upload and delete Lambda behavior

- **Upload:** the upload Lambda only returns a short-lived presigned `PutObject` URL for the knowledge bucket, so the browser uploads straight to S3. Requests for `metadata.txt`, or for any key under `indexes/`, are rejected so an admin token cannot overwrite system-managed files. File names are limited to letters, numbers, spaces and `( ) & , + . _ - /`, and `..` is not allowed.
- **Delete (admin UI):** the delete Lambda first calls Bedrock `DeleteKnowledgeBaseDocuments` to drop the file's chunks, then deletes the S3 object. If removing the chunks fails, it stops before deleting, so you can retry instead of leaving orphaned chunks in OpenSearch.

### Document summaries

An S3 event on the knowledge bucket invokes the metadata handler Lambda for every upload and delete. It writes a short summary and tags for each document to the object's metadata and rebuilds `metadata.txt`, the inventory the `fetch_metadata` tool reads.

A summary can only be written once the document's chunks exist in the Knowledge Base, and ingestion finishes minutes to hours after the upload event. So at upload time the handler finds nothing and writes no summary. An hourly EventBridge schedule re-invokes the sync orchestrator in backfill-only mode, which generates summaries for any document that now has chunks and still lacks one. Expect a summary to appear within about an hour after ingestion completes.

### Supported formats

Supported file types follow Bedrock Knowledge Base S3 data source support. Unsupported or failing files can be skipped or fail during ingestion.

Parsing uses Bedrock's default text parser. To parse PDF pages with a vision model (better for tables and checkbox forms, at extra cost), deploy with `-c kbParserModel=<model or inference profile id>` and run a sync afterwards. See the README's deployment settings.

---

## Spreadsheet indexes (index bucket)

### Key layout and trigger

- **Path pattern:** `indexes/{index_id}/latest.xlsx`
- **Trigger:** S3 notifications on the index bucket, for `OBJECT_CREATED` and `OBJECT_REMOVED`, filtered to prefix `indexes/` and suffix `.xlsx`.

The parser takes `index_id` from the path. Keys that do not match `indexes/{index_id}/...` are ignored (and logged).

### Manual S3 upload and delete

| Action | Effect |
|--------|--------|
| Put or overwrite `indexes/{id}/latest.xlsx` | The parser runs, rewrites the DynamoDB rows and updates the registry (same as an upload through the app, if the path matches) |
| Delete that object | The parser clears the DynamoDB rows for that index, sets its status to `NO_DATA`, and removes the registry entry |

### Registry and the tool description

After a successful parse, the parser writes the index's registry entry. That entry feeds the `query_excel_index` tool description, so the model knows each index's columns and row count.

- **AI-generated description:** Bedrock writes a one or two sentence description when the index has no description yet and the sheet has sample rows. Empty sheets get none. If the Bedrock call fails, the description can stay empty.
- **Display name:** derived from `index_id` (for example `snake_case` becomes Title Case), unless you change it later through the admin API (`PUT /admin/indexes/{id}`).

Creating the index first in the admin console (**Data Indexes** tab, or `POST /admin/indexes`) lets you set a friendly display name before the upload. An S3-only drop skips that step.

### Code pointers

- Parser and S3 delete handling: `lib/chatbot-api/functions/excel-index/parser/lambda_function.py`
- Registry and AI description: `lib/chatbot-api/functions/excel-index/parser/tool_registry.py`
- S3 event wiring: `lib/chatbot-api/functions/excel-index-functions.ts` (`S3EventSource` on the index bucket)
- Knowledge Base sync API: `lib/chatbot-api/functions/knowledge-management/kb-sync/lambda_function.py`
- Sync orchestrator: `lib/chatbot-api/functions/sync-orchestrator/lambda_function.py`
- Sync schedule API and EventBridge management: `lib/chatbot-api/functions/sync-schedule/lambda_function.py`
- Schedules: `lib/chatbot-api/functions/sync-functions.ts`

---

## Sync orchestrator (staging to knowledge base and index)

Knowledge Base ingestion is **not** triggered by uploads to the knowledge bucket. It starts in two ways:

1. **Manual:** the **Sync data now** button on the Documents tab (and **Sync now** on the Automation tab), which calls `POST /admin/sync-now` and asynchronously invokes the orchestrator. The older `sync-kb` endpoint still exists and only calls `StartIngestionJob`.
2. **Scheduled:** an EventBridge Scheduler schedule invokes the orchestrator weekly. The default is `cron(0 1 ? * SUN *)` in the brand timezone (`config/brand.ts`, default `America/New_York`): every Sunday at 1:00 AM. Admins can change the day and time or turn it off on the **Automation** tab (`GET` and `PUT /admin/sync-schedule`).

A second schedule runs the orchestrator **hourly in backfill-only mode** to generate document summaries (see above). It does not move files, start ingestion or write a history record.

### What a sync does

On each run the orchestrator does three things and records the run:

1. **Documents:** moves every object under `documents/` in the **staging bucket** to the **knowledge bucket** (copy, then delete from staging). The key loses the `documents/` prefix: `documents/policy.pdf` becomes `policy.pdf`.
2. **Index files:** moves every object under `indexes/` in the staging bucket to the **index bucket**, keeping the key, so `indexes/{id}/latest.xlsx` stays at the same path. The index bucket's S3 event then runs the parser.
3. **Knowledge Base ingestion:** starts an ingestion job so the moved and uploaded documents become searchable, **unless** a job is already `IN_PROGRESS` or `STARTING` (only one job should run per data source at a time).

It also backfills summaries for any knowledge-bucket file that still lacks one, and writes a record (status, document and index counts, duration, a 90-day expiry via `expiresAt`) to the sync history table, shown through `GET /admin/sync-history`.

### Notes

- **Direct admin uploads** on the Documents tab go straight to the knowledge bucket by presigned URL. They are not staged, so they become searchable at the next manual or scheduled sync.
- **Spreadsheets** do not need a Knowledge Base sync. The index bucket is event-driven. The orchestrator only moves staged index files into place, and the parser runs off the resulting S3 event.
- The staging bucket is for bulk or scripted loads (for example from a pipeline that cannot use presigned URLs). Nothing else reads from it.

---

## Quick checklist

1. **Document in the knowledge bucket:** run a sync (manual, or wait for the weekly schedule) if chat must see it.
2. **Spreadsheet index:** use the index bucket at `indexes/{index_id}/latest.xlsx`, or the **Data Indexes** tab. The parser runs on create, update and delete.
3. **Staging:** drop files under `documents/` or `indexes/` in the staging bucket and run a sync.
4. Do not rely on the Knowledge Base for spreadsheet data, and do not rely on the spreadsheet parser for PDFs.
