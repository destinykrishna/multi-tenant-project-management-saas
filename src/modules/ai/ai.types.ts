export type LlmMessageRole = 'system' | 'user' | 'assistant' | 'tool';

export interface LlmMessage {
  role: LlmMessageRole;
  content: string;
  name?: string;
  toolCallId?: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export interface LlmToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface LlmUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface LlmResponse {
  content: string;
  toolCalls?: LlmToolCall[];
  usage?: LlmUsage;
  finishReason?: 'stop' | 'tool_calls' | 'length' | 'error';
}

export interface LlmGenerationOptions {
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  tools?: ToolDefinition[];
  stopSequences?: string[];
}

export interface ILlmProvider {
  readonly name: string;
  generate(messages: LlmMessage[], options?: LlmGenerationOptions): Promise<LlmResponse>;
}

export interface AgentExecutionLimits {
  maxSteps: number;
  maxToolCalls: number;
  maxContextTokens: number;
  maxOutputTokens: number;
  timeoutMs: number;
}

export interface AgentDefinition {
  name: string;
  description: string;
  systemInstructions: string;
  availableTools?: ToolDefinition[];
  limits?: Partial<AgentExecutionLimits>;
}

export interface AiRequestContext {
  organizationId: string;
  userId: string;
  userRole: string;
  agent?: AgentDefinition;
}

export interface AiGenerateRequest {
  prompt: string;
  systemInstruction?: string;
  includeRagContext?: boolean;
  ragQuery?: string;
  topK?: number;
  minSimilarity?: number;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
}

export interface AiSourceReference {
  id: string;
  sourceType: string;
  sourceId: string;
  title: string | null;
  similarityScore: number;
}

export interface AiGenerateResponse {
  content: string;
  toolCalls?: LlmToolCall[];
  sources?: AiSourceReference[];
  usage?: LlmUsage;
}
