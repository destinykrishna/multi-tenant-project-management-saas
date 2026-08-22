import { createHash } from 'node:crypto';
import type { IEmbeddingProvider } from '../rag.types.js';

export class MockEmbeddingProvider implements IEmbeddingProvider {
  readonly name = 'mock' as const;
  readonly dimension: number;

  constructor(dimension = 1536) {
    this.dimension = dimension;
  }

  generateEmbedding(text: string): Promise<number[]> {
    const hash = createHash('sha256').update(text).digest();
    const vector: number[] = new Array<number>(this.dimension).fill(0);

    let sumSq = 0;
    for (let i = 0; i < this.dimension; i++) {
      const byte = hash[i % hash.length] ?? 0;
      // Map to [-1, 1] range deterministically
      const val = byte / 127.5 - 1 + Math.sin(i * 0.1);
      vector[i] = val;
      sumSq += val * val;
    }

    // Normalize vector to unit length (L2 norm = 1.0)
    const norm = Math.sqrt(sumSq) || 1;
    for (let i = 0; i < this.dimension; i++) {
      vector[i] = (vector[i] ?? 0) / norm;
    }

    return Promise.resolve(vector);
  }

  async generateEmbeddings(texts: string[]): Promise<number[][]> {
    return Promise.all(texts.map((t) => this.generateEmbedding(t)));
  }
}
