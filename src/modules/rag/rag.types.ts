import type { Prisma } from '../../generated/prisma/client.js';

export type RagSourceType = 'PROJECT' | 'TASK' | 'COMMENT' | 'ACTIVITY_LOG' | 'DOCUMENT';

export interface IEmbeddingProvider {
  readonly name: string;
  readonly dimension: number;
  generateEmbedding(text: string): Promise<number[]>;
  generateEmbeddings(texts: string[]): Promise<number[][]>;
}

export interface CreateKnowledgeChunkInput {
  organizationId: string;
  sourceType: RagSourceType;
  sourceId: string;
  chunkIndex: number;
  totalChunks: number;
  title?: string | null;
  content: string;
  metadata?: Prisma.InputJsonValue;
  embedding: number[];
}

export interface RagKnowledgeDocumentResponse {
  id: string;
  organizationId: string;
  sourceType: RagSourceType;
  sourceId: string;
  chunkIndex: number;
  totalChunks: number;
  title: string | null;
  content: string;
  metadata: Prisma.JsonValue | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface EntityIngestionResult {
  sourceType: RagSourceType;
  sourceId: string;
  chunksCreated: number;
  success: boolean;
}

export interface BatchIngestionSummary {
  organizationId: string;
  projectsIndexed: number;
  tasksIndexed: number;
  commentsIndexed: number;
  activitiesIndexed: number;
  totalChunks: number;
}

export interface RagStatsResponse {
  totalDocuments: number;
  bySourceType: Record<string, number>;
}

export interface RagRetrieveOptions {
  organizationId: string;
  query: string;
  topK?: number;
  minSimilarity?: number;
  sourceTypes?: RagSourceType[];
  projectId?: string;
}

export interface RagRetrievedChunk {
  id: string;
  organizationId: string;
  sourceType: RagSourceType;
  sourceId: string;
  chunkIndex: number;
  totalChunks: number;
  title: string | null;
  content: string;
  metadata: Prisma.JsonValue | null;
  similarityScore: number;
}

export interface RagRetrievalResponse {
  query: string;
  totalMatches: number;
  results: RagRetrievedChunk[];
}

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LlmOptions {
  temperature?: number;
  maxTokens?: number;
}

export interface ILlmProvider {
  readonly name: string;
  generateResponse(messages: LlmMessage[], options?: LlmOptions): Promise<string>;
}

export interface RagQueryOptions {
  organizationId: string;
  query: string;
  topK?: number;
  minSimilarity?: number;
  sourceTypes?: RagSourceType[];
  projectId?: string;
}

export interface RagSourceReference {
  id: string;
  sourceType: RagSourceType;
  sourceId: string;
  title: string | null;
  chunkIndex: number;
  similarityScore: number;
  metadata?: Prisma.JsonValue | null;
}

export interface RagQueryResponse {
  query: string;
  answer: string;
  sources: RagSourceReference[];
}
