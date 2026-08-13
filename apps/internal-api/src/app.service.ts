import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  health() {
    return { service: 'internal-api', status: 'ok', timestamp: new Date().toISOString() };
  }
}
