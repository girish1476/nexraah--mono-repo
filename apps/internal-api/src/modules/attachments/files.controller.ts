import { Controller, Get, NotFoundException, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import { getObject, openFileLink, s3Config } from '../../lib/object-store';

/**
 * `GET /files/:token` — one stored file, through a link this API signed
 * (`lib/object-store.ts` `fileLink`) after checking the caller may see the row
 * it belongs to. **No guard on purpose**, like a storage signed URL: the
 * token, which names one path and runs out in 15 minutes, is the permission.
 * An altered or expired token is a plain 404 — it says nothing about whether
 * the file exists.
 */
@Controller('files')
export class FilesController {
  private readonly s3 = s3Config();

  @Get(':token')
  async file(@Param('token') token: string, @Res() res: Response): Promise<void> {
    const path = this.s3 ? openFileLink(this.s3, token) : null;
    if (!this.s3 || !path) throw new NotFoundException('This link has expired. Open the file again from the console.');
    const object = await getObject(this.s3, path).catch(() => null);
    if (!object) throw new NotFoundException('This file is no longer available.');
    res.set({
      'Content-Type': object.mime,
      'Content-Length': String(object.body.length),
      'Content-Disposition': 'inline',
      'Cache-Control': 'private, max-age=600',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(object.body);
  }
}
