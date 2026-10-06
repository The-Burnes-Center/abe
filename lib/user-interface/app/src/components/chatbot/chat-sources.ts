/** Source/citation data helpers shared by the chat message components. */

export interface SourceItem {
  chunkIndex: number | null;
  title: string;
  uri: string | null;
  excerpt: string | null;
  score: number | null;
  page: number | null;
  s3Key: string | null;
  sourceType: "knowledgeBase" | "excelIndex";
  cited?: boolean;
}

export interface MergedCard {
  chunkIndices: number[];
  excerpt: string | null;
  score: number | null;
  cited: boolean;
  page: number | null;
  uri: string | null;
}

export interface SourceGroup {
  documentTitle: string;
  s3Key: string | null;
  sourceType: "knowledgeBase" | "excelIndex";
  cards: MergedCard[];
}

/** More distinct pages than this collapse into a count plus range. */
const MAX_LISTED_PAGES = 5;

// Bedrock KB stores page indices as 0-based (page 0 = first page), but
// readers expect 'Page 1' to be the first page. Shift to 1-based for any
// user-facing label.
export function displayPage(page: number): number {
  return page + 1;
}

// When the LLM calls retrieve_full_document, it pulls many chunks from one
// file, so the cited-pages list can balloon. Collapse anything past a few
// distinct pages into a count with the page range, and detect the
// contiguous-from-start case as 'Full document'.
export function formatPageList(pages: number[]): string {
  if (pages.length === 0) return "";
  const display = pages.map(displayPage);
  if (display.length === 1) return `Page ${display[0]}`;
  if (display.length <= MAX_LISTED_PAGES) return `Pages ${display.join(", ")}`;
  const min = display[0];
  const max = display[display.length - 1];
  const isContiguous = max - min + 1 === display.length;
  if (isContiguous && min <= 2) {
    return `Full document · ${display.length} pages`;
  }
  return `${display.length} pages cited · ${min}–${max}`;
}

/**
 * metadata.txt is an internal KB summary index, not a real reference doc.
 * Drop it so it disappears from both the inline [N] badges and the sources
 * panel. Excel index lookups always pass through.
 */
export function visibleSources(sources: SourceItem[] | undefined): SourceItem[] {
  if (!sources) return [];
  return sources.filter((s) => {
    if (s.sourceType !== "knowledgeBase") return true;
    const name = (s.title || s.s3Key || "").toLowerCase();
    return name !== "metadata.txt" && !name.endsWith("/metadata.txt");
  });
}

export function groupSources(sources: SourceItem[]): SourceGroup[] {
  const docGroups = new Map<
    string,
    { title: string; s3Key: string | null; sourceType: SourceItem["sourceType"]; items: SourceItem[] }
  >();
  for (const src of sources) {
    const key = src.s3Key || `__excel__${src.title}`;
    if (!docGroups.has(key)) {
      docGroups.set(key, { title: src.title, s3Key: src.s3Key, sourceType: src.sourceType, items: [] });
    }
    docGroups.get(key)!.items.push(src);
  }

  const result: SourceGroup[] = [];
  for (const doc of docGroups.values()) {
    const pageMap = new Map<string, SourceItem[]>();
    for (const item of doc.items) {
      const pageKey = item.page != null ? String(item.page) : `__chunk_${item.chunkIndex}`;
      if (!pageMap.has(pageKey)) pageMap.set(pageKey, []);
      pageMap.get(pageKey)!.push(item);
    }

    const cards: MergedCard[] = [];
    for (const items of pageMap.values()) {
      const indices = [
        ...new Set(items.map((i) => i.chunkIndex).filter((i): i is number => i != null)),
      ].sort((a, b) => a - b);
      const bestScore = items.reduce<number | null>((best, i) => {
        if (i.score == null) return best;
        return best == null || i.score > best ? i.score : best;
      }, null);
      const excerpts = items.map((i) => i.excerpt).filter((e): e is string => !!e);
      cards.push({
        chunkIndices: indices,
        excerpt: excerpts.length > 1 ? excerpts.join(" ... ") : excerpts[0] ?? null,
        score: bestScore,
        cited: items.some((i) => i.cited === true),
        page: items[0].page,
        uri: items[0].uri,
      });
    }
    result.push({ documentTitle: doc.title, s3Key: doc.s3Key, sourceType: doc.sourceType, cards });
  }
  return result;
}
