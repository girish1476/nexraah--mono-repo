import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsString, MaxLength, MinLength, ValidateNested } from 'class-validator';

/** One turn of the conversation as the console holds it: what was asked, or what was answered. */
export class AssistantTurnDto {
  @IsIn(['user', 'assistant']) role!: 'user' | 'assistant';
  @IsString() @MinLength(1) @MaxLength(4000) content!: string;
}

/**
 * `POST /assistant/chat` — the conversation so far, ending with the question
 * being asked now. The console keeps the conversation; the server keeps
 * nothing between questions.
 */
export class AssistantChatDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(30) @ValidateNested({ each: true }) @Type(() => AssistantTurnDto)
  messages!: AssistantTurnDto[];
}

/** A record an answer was drawn from, as a link the reader can open to check it. */
export interface AssistantSource {
  label: string;
  /** A path in the console — `/orders/1004`. */
  href: string;
}

export interface AssistantAnswer {
  answer: string;
  sources: AssistantSource[];
}
