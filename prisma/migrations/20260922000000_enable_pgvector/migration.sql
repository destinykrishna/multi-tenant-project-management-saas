-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Cleanse/nullify invalid-dimension embeddings to prevent conversion failures
UPDATE "rag_knowledge_documents"
SET "embedding" = NULL
WHERE array_length("embedding", 1) IS DISTINCT FROM 1536;

-- Alter column type to fixed-dimension PostgreSQL vector(1536)
ALTER TABLE "rag_knowledge_documents"
  ALTER COLUMN "embedding" TYPE vector(1536)
  USING ("embedding"::real[]::vector(1536));

-- Create HNSW index for high-performance cosine similarity retrieval
CREATE INDEX IF NOT EXISTS "rag_knowledge_documents_embedding_hnsw_idx"
  ON "rag_knowledge_documents"
  USING hnsw ("embedding" vector_cosine_ops);
