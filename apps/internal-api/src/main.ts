// Must run before any other import: db/pools.ts (imported transitively via
// AppModule → InternalDbModule) constructs its `Pool`s from `process.env` at
// module-load time, not inside a Nest provider factory. `ConfigModule.forRoot()`
// only populates `process.env` once Nest's DI starts — well after this file's
// `import` statements have already been evaluated — so `.env` has to be
// loaded here, synchronously, first.
import 'dotenv/config';

import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';

async function bootstrap() {
  // `rawBody: true` preserves the exact request bytes on `req.rawBody`
  // alongside the normal parsed `req.body` — `TelematicsHmacGuard` needs the
  // untouched bytes to verify a provider's HMAC signature; re-serializing
  // the parsed JSON would produce a different byte sequence and fail
  // verification for no real reason.
  const app = await NestFactory.create(AppModule, { rawBody: true });

  app.setGlobalPrefix('api/v1');
  app.enableCors();
  // `forbidNonWhitelisted`: a property the DTO does not declare is a 400, not
  // a silent drop. Without it a stray or misspelt key answered "200 OK" with
  // the data gone — four confirmed instances (vendor fleet fields, lead notes,
  // issue tripId, the portal quote's truck) before it was switched on.
  // `common/validation/validation.test.ts` builds its pipe with these same
  // options; change both together.
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalInterceptors(new TransformInterceptor());

  const port = process.env.PORT ?? 4002;
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`[internal-api] running on http://localhost:${port}/api/v1`);
}
bootstrap();
