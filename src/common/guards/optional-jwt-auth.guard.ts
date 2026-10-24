import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

// Пускает и гостей: если токен есть и валиден — request.user заполнен, иначе undefined.
@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard('jwt') {
  handleRequest<T>(_err: unknown, user: T) {
    return user || (undefined as T);
  }
}
