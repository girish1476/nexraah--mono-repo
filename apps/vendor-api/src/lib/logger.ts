import { Logger } from '@nestjs/common';

/**
 * Shared library helpers live under `lib/`.
 * Framework-agnostic utilities, clients, and adapters go here.
 */
export const appLogger = new Logger('vendor-api');
