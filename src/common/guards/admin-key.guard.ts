import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'crypto';

// Админские эндпоинты закрыты ключом из ADMIN_API_KEY (заголовок X-Admin-Key):
// вход в приложение без SMS, поэтому права по номеру телефона давать нельзя.
@Injectable()
export class AdminKeyGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(ctx: ExecutionContext): boolean {
    const expected = this.config.get<string>('ADMIN_API_KEY') ?? '';
    const got = ctx
      .switchToHttp()
      .getRequest<{ headers: Record<string, string | undefined> }>().headers[
      'x-admin-key'
    ];
    const ok =
      expected.length >= 16 &&
      !!got &&
      got.length === expected.length &&
      timingSafeEqual(Buffer.from(got), Buffer.from(expected));
    if (!ok) throw new UnauthorizedException();
    return true;
  }
}
