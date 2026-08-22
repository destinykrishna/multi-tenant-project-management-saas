export interface ChunkOptions {
  maxChunkSize?: number;
  overlap?: number;
}

export function chunkText(text: string, options: ChunkOptions = {}): string[] {
  const maxChunkSize = options.maxChunkSize ?? 1000;
  const overlap = options.overlap ?? 150;

  const cleanText = text.trim();
  if (!cleanText) return [];

  if (cleanText.length <= maxChunkSize) {
    return [cleanText];
  }

  const chunks: string[] = [];
  let startIndex = 0;

  while (startIndex < cleanText.length) {
    let endIndex = startIndex + maxChunkSize;

    if (endIndex >= cleanText.length) {
      chunks.push(cleanText.slice(startIndex).trim());
      break;
    }

    // Try to break cleanly on a period, newline, or whitespace
    const lookback = cleanText.slice(startIndex + maxChunkSize - 100, endIndex);
    const splitOffset =
      lookback.lastIndexOf('\n') !== -1
        ? lookback.lastIndexOf('\n')
        : lookback.lastIndexOf('. ') !== -1
          ? lookback.lastIndexOf('. ') + 1
          : lookback.lastIndexOf(' ') !== -1
            ? lookback.lastIndexOf(' ')
            : -1;

    if (splitOffset !== -1) {
      endIndex = startIndex + maxChunkSize - 100 + splitOffset;
    }

    const chunk = cleanText.slice(startIndex, endIndex).trim();
    if (chunk.length > 0) {
      chunks.push(chunk);
    }

    startIndex = endIndex - overlap;
    if (startIndex >= cleanText.length - overlap) {
      break;
    }
  }

  return chunks.length > 0 ? chunks : [cleanText];
}
