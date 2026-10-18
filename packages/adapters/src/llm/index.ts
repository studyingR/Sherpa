import OpenAI from 'openai';

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LlmRequest {
  messages: LlmMessage[];
  temperature?: number;
  maxTokens?: number;
  /** Structured output: the model must return JSON matching this schema. */
  json?: { name: string; schema: Record<string, unknown> };
}

export interface LlmResult {
  text: string;
  usage?: { input: number; output: number };
  latencyMs: number;
}

/** Low-level chat provider (docs/02 §3). Route through the enterprise gateway by setting baseURL/headers. */
export interface LlmProvider {
  readonly name: 'openai' | 'gateway';
  readonly model: string;
  complete(req: LlmRequest): Promise<LlmResult>;
}

export interface OpenAiLlmOptions {
  apiKey: string;
  model: string;
  timeoutMs: number;
  /** M9: enterprise LLM gateway variant. */
  baseURL?: string;
  defaultHeaders?: Record<string, string>;
}

export class OpenAiLlmProvider implements LlmProvider {
  readonly name: 'openai' | 'gateway';
  readonly model: string;
  private client: OpenAI;

  constructor(opts: OpenAiLlmOptions) {
    this.name = opts.baseURL ? 'gateway' : 'openai';
    this.model = opts.model;
    this.client = new OpenAI({
      apiKey: opts.apiKey,
      timeout: opts.timeoutMs,
      maxRetries: 1,
      ...(opts.baseURL ? { baseURL: opts.baseURL } : {}),
      ...(opts.defaultHeaders ? { defaultHeaders: opts.defaultHeaders } : {}),
    });
  }

  async complete(req: LlmRequest): Promise<LlmResult> {
    const started = Date.now();
    const res = await this.client.chat.completions.create({
      model: this.model,
      messages: req.messages,
      ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
      ...(req.maxTokens ? { max_completion_tokens: req.maxTokens } : {}),
      ...(req.json
        ? { response_format: { type: 'json_schema' as const, json_schema: { name: req.json.name, schema: req.json.schema, strict: true } } }
        : {}),
    });
    const text = res.choices[0]?.message?.content ?? '';
    return {
      text,
      usage: res.usage ? { input: res.usage.prompt_tokens, output: res.usage.completion_tokens } : undefined,
      latencyMs: Date.now() - started,
    };
  }
}
