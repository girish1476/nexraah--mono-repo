import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  health() {
    return { service: 'vendor-api', status: 'ok', timestamp: new Date().toISOString() };
  }
}
