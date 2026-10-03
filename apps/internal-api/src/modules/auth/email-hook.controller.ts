import { Body, Controller, Headers, HttpCode, HttpException, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { HookSignatureError, readHookPayload, SendEmailHookPayload, verifyHookSignature } from './send-email-hook';
import { renderSignInEmail } from './sign-in-email';
import { EmailNotConfiguredError, sendWithResend } from './resend';

/**
 * `POST /api/v1/auth/email-hook` — Supabase Auth's "Send Email" hook.
 *
 * No JWT: the caller is Supabase, not a signed-in person. It is authenticated
 * by the Standard Webhooks signature instead (SEND_EMAIL_HOOK_SECRET), and
 * refused when that is missing or wrong. Errors go back in the shape the hook
 * expects (`{ error: { http_code, message } }`), so Supabase shows the reason
 * and the sign-in screen says the code could not be sent.
 */
@Controller('auth')
export class EmailHookController {
  @Post('email-hook')
  @HttpCode(200)
  async sendEmail(
    @Req() request: Request & { rawBody?: Buffer },
    @Headers('webhook-id') id: string | undefined,
    @Headers('webhook-timestamp') timestamp: string | undefined,
    @Headers('webhook-signature') signature: string | undefined,
    @Body() body: SendEmailHookPayload,
  ) {
    const secret = process.env.SEND_EMAIL_HOOK_SECRET;
    if (!secret) throw hookError(503, 'The email hook is not configured on the server.');
    if (!request.rawBody) throw hookError(500, 'The server cannot verify this request.');

    try {
      verifyHookSignature({ id, timestamp, signature }, request.rawBody, secret);
    } catch (e) {
      if (e instanceof HookSignatureError) throw hookError(401, e.message);
      throw e;
    }

    let to: { email: string; code: string };
    try {
      to = readHookPayload(body);
    } catch (e) {
      throw hookError(400, (e as Error).message);
    }

    const email = renderSignInEmail({ code: to.code, email: to.email, logoUrl: process.env.EMAIL_LOGO_URL ?? null });
    try {
      await sendWithResend({ to: to.email, ...email, idempotencyKey: id });
    } catch (e) {
      if (e instanceof EmailNotConfiguredError) throw hookError(503, e.message);
      throw hookError(502, (e as Error).message);
    }
    return {};
  }
}

function hookError(httpCode: number, message: string) {
  return new HttpException({ error: { http_code: httpCode, message } }, httpCode);
}
