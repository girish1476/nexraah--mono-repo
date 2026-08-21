import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import cors from 'cors';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { requestIdMiddleware } from './edge/request-id';
import { rateLimitMiddleware } from './edge/rate-limit';
import { portalProxy } from './edge/proxy';

async function bootstrap() {
  // No body parser, ever (ADR-02 §5: vendor-api holds no read of a response
  // or request body). Multipart streams through to internal-api unbuffered
  // (11-portal.md §1.1) — a body parser here would read the stream first and
  // there would be nothing left to proxy.
  const app = await NestFactory.create(AppModule, { bodyParser: false });

  app.setGlobalPrefix('api/v1');
  app.use(
    cors({
      origin: process.env.CORS_ORIGIN ?? 'http://localhost:3001',
      credentials: true,
    }),
  );
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalInterceptors(new TransformInterceptor());

  // Everything below runs BEFORE Nest's router. `/api/v1/portal/*` never
  // reaches a Nest controller — it is proxied at the raw Express layer so no
  // middleware ever buffers or reads the body. Anything that isn't a portal
  // path falls through to Nest's own routing (today: only `GET /api/v1/health`).
  app.use(requestIdMiddleware);
  app.use(rateLimitMiddleware);
  app.use(portalProxy);

  const port = process.env.PORT ?? 4001;
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`[vendor-api] running on http://localhost:${port}/api/v1 — proxying /portal/* only`);
}
bootstrap();
