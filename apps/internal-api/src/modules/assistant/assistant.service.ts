import { HttpException, Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { DomainException } from '../../common/domain-exception';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import type { AssistantAnswer, AssistantChatDto, AssistantSource } from './assistant.dto';
import { ASSISTANT_SYSTEM, callerContext } from './assistant.prompt';
import { AssistantTools } from './assistant.tools';

/** How many rounds of lookups one question may take before the assistant has to answer with what it has. */
const MAX_ROUNDS = 8;
/** The most links shown under one answer. */
const MAX_SOURCES = 8;
/** A single lookup's result is cut here, so one huge record cannot crowd the rest out. */
const MAX_RESULT_CHARS = 60_000;

const ROLE_LABEL: Record<string, string> = {
  OPS: 'Operations',
  COMPLIANCE: 'Compliance',
  FINANCE: 'Finance',
  BD: 'Business development',
  LEADERSHIP: 'Leadership',
  ADMIN: 'Administrator',
  LOADING_SUPERVISOR: 'Loading supervisor',
};

/**
 * The console's assistant: answers a staff member's question from the records,
 * by looking them up.
 *
 * It holds no knowledge of the company's data. The model is given a set of
 * read-only lookups (`AssistantTools`) — the same service calls the screens
 * make, run as the person asking — and told to answer only from what they
 * return. That is where the accuracy comes from: an answer is a reading of
 * live records, with the records linked underneath so it can be checked, not a
 * recollection.
 *
 * Nothing is stored between questions; the console sends the conversation each
 * time. Off until `ANTHROPIC_API_KEY` is set.
 */
@Injectable()
export class AssistantService {
  private readonly logger = new Logger(AssistantService.name);
  private client: Anthropic | null = null;

  constructor(private readonly tools: AssistantTools) {}

  async chat(dto: AssistantChatDto, user: AuthenticatedUser): Promise<AssistantAnswer> {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new DomainException(503, 'ASSISTANT_NOT_SET_UP', 'The assistant is not set up yet.');
    }
    if (dto.messages[dto.messages.length - 1].role !== 'user') {
      throw new DomainException(400, 'VALIDATION_ERROR', 'The conversation has to end with a question.');
    }

    const messages: Anthropic.MessageParam[] = dto.messages.map((m) => ({ role: m.role, content: m.content }));
    const tools = this.tools.definitionsFor(user);
    const system: Anthropic.TextBlockParam[] = [
      // Identical on every request, so it — and the lookups before it — is cached.
      { type: 'text', text: ASSISTANT_SYSTEM, cache_control: { type: 'ephemeral' } },
      {
        type: 'text',
        text: callerContext(
          {
            name: user.name,
            roleLabel: user.customRole?.name ?? ROLE_LABEL[user.role] ?? user.role,
            branchName: user.branch?.name ?? null,
          },
          new Date(),
        ),
      },
    ];

    const sources: AssistantSource[] = [];

    for (let round = 0; round < MAX_ROUNDS; round++) {
      const response = await this.ask({ system, tools, messages });

      if (response.stop_reason === 'refusal') {
        return { answer: 'I can’t help with that one. Try asking it another way, or raise a ticket.', sources: [] };
      }

      const calls = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
      if (response.stop_reason !== 'tool_use' || calls.length === 0) {
        const answer = response.content
          .filter((b): b is Anthropic.TextBlock => b.type === 'text')
          .map((b) => b.text)
          .join('\n')
          .trim();
        return {
          answer: answer || 'I could not find an answer to that. Try asking it another way.',
          sources: distinct(sources).slice(0, MAX_SOURCES),
        };
      }

      // The model's own turn goes back exactly as it came, then every result in one message.
      messages.push({ role: 'assistant', content: response.content });
      const results = await Promise.all(calls.map((call) => this.lookup(call, user, sources)));
      messages.push({ role: 'user', content: results });
    }

    // Out of rounds: it is asked to answer from what it has already read. The
    // lookups stay declared — the conversation above refers to them — but a
    // further call is not run; whatever it writes is the answer.
    messages.push({
      role: 'user',
      content: 'Answer now from what you have looked up so far, and say what you could not check. Do not look anything else up.',
    });
    const last = await this.ask({ system, tools, messages });
    const answer = last.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();
    return {
      answer: answer || 'That needed more looking up than I can do in one go. Ask about one order or one transporter at a time.',
      sources: distinct(sources).slice(0, MAX_SOURCES),
    };
  }

  /** One lookup, as a result block. A failure is reported to the model as a failure, never dropped. */
  private async lookup(
    call: Anthropic.ToolUseBlock,
    user: AuthenticatedUser,
    sources: AssistantSource[],
  ): Promise<Anthropic.ToolResultBlockParam> {
    try {
      const result = await this.tools.run(call.name, call.input, user);
      sources.push(...result.sources);
      const body = JSON.stringify(result.data);
      return {
        type: 'tool_result',
        tool_use_id: call.id,
        content:
          body.length > MAX_RESULT_CHARS
            ? `${body.slice(0, MAX_RESULT_CHARS)}\n[Cut off here — the record is longer than this. Say so if the answer may lie in the part not shown.]`
            : body,
      };
    } catch (error) {
      // A "not found" or "no access" from the service is an answer in itself; anything else is logged.
      const message = error instanceof HttpException || error instanceof Error ? error.message : 'The lookup failed.';
      if (!(error instanceof HttpException)) this.logger.warn(`Assistant lookup ${call.name} failed: ${message}`);
      return { type: 'tool_result', tool_use_id: call.id, content: `Lookup failed: ${message}`, is_error: true };
    }
  }

  private async ask(request: {
    system: Anthropic.TextBlockParam[];
    tools: Anthropic.Tool[];
    messages: Anthropic.MessageParam[];
  }): Promise<Anthropic.Message> {
    try {
      return await this.anthropic().messages.create({
        model: 'claude-opus-5-5',
        max_tokens: 16000,
        output_config: { effort: 'medium' },
        system: request.system,
        tools: request.tools,
        messages: request.messages,
      });
    } catch (error) {
      if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
        this.logger.error(`Assistant credentials rejected: ${error.message}`);
        throw new DomainException(503, 'ASSISTANT_NOT_SET_UP', 'The assistant is not set up correctly.');
      }
      if (error instanceof Anthropic.RateLimitError) {
        throw new DomainException(429, 'ASSISTANT_BUSY', 'The assistant is busy just now. Try again in a minute.');
      }
      if (error instanceof Anthropic.APIError) {
        this.logger.error(`Assistant request failed: ${error.status} ${error.message}`);
        throw new DomainException(502, 'ASSISTANT_FAILED', 'The assistant could not answer just now. Try again.');
      }
      throw error;
    }
  }

  /** Made on first use, so a deployment without the key starts and runs as before. */
  private anthropic(): Anthropic {
    this.client ??= new Anthropic();
    return this.client;
  }
}

function distinct(sources: AssistantSource[]): AssistantSource[] {
  const seen = new Set<string>();
  return sources.filter((s) => (seen.has(s.href) ? false : (seen.add(s.href), true)));
}
