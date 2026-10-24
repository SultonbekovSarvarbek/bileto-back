import { BadRequestException, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { normalizeUzPhone } from '../common/utils/phone';
import { JwtPayload } from '../common/types/auth-user.type';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  // Регистрация и вход одним запросом: имя + телефон, без SMS-подтверждения.
  async login(name: string, rawPhone: string) {
    const phone = normalizeUzPhone(rawPhone);
    if (!phone) throw new BadRequestException('Неверный номер телефона');
    const user = await this.prisma.user.upsert({
      where: { phone },
      update: { name: name.trim() },
      create: { phone, name: name.trim() },
      select: {
        id: true,
        phone: true,
        name: true,
        lang: true,
        verified: true,
        createdAt: true,
      },
    });
    const payload: JwtPayload = { sub: user.id };
    return { token: await this.jwt.signAsync(payload), user };
  }
}
