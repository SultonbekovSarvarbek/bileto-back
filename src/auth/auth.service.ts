import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { normalizeUzPhone } from '../common/utils/phone';
import { hashPassword, verifyPassword } from '../common/utils/password';
import { JwtPayload } from '../common/types/auth-user.type';

const USER_SELECT = {
  id: true,
  phone: true,
  name: true,
  role: true,
  lang: true,
  verified: true,
  createdAt: true,
};

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  // Регистрация по номеру и паролю, без SMS-подтверждения. Аккаунт, заведённый
  // до появления паролей (passwordHash = null), получает пароль при регистрации.
  async register(
    name: string,
    rawPhone: string,
    password: string,
    role: UserRole,
  ) {
    const phone = this.phone(rawPhone);
    const existing = await this.prisma.user.findUnique({ where: { phone } });
    if (existing?.passwordHash)
      throw new ConflictException('Номер уже зарегистрирован — войдите');
    // Номер подтверждён в Telegram-боте: пароль задаётся только там, иначе аккаунт займёт кто угодно.
    if (existing?.telegramId)
      throw new ConflictException(
        'Номер уже привязан к боту Bileto в Telegram — нажмите там «🔑 Вход в приложение», задайте пароль и войдите',
      );
    const data = {
      name: name.trim(),
      role,
      passwordHash: await hashPassword(password),
    };
    const user = await this.prisma.user.upsert({
      where: { phone },
      update: data,
      create: { phone, ...data },
      select: USER_SELECT,
    });
    await this.claimRequests(user.id, phone);
    return this.session(user);
  }

  async login(rawPhone: string, password: string) {
    const phone = this.phone(rawPhone);
    const found = await this.prisma.user.findUnique({
      where: { phone },
      select: { ...USER_SELECT, passwordHash: true },
    });
    const passwordHash = found?.passwordHash;
    if (!passwordHash || !(await verifyPassword(password, passwordHash)))
      throw new UnauthorizedException('Неверный номер или пароль');
    return this.session({ ...found, passwordHash: undefined });
  }

  // Заявки, оставленные без входа с этого номера, становятся видны в «Мои заявки».
  claimRequests(userId: string, phone: string) {
    return this.prisma.purchaseRequest.updateMany({
      where: { phone, userId: null },
      data: { userId },
    });
  }

  private phone(raw: string) {
    const phone = normalizeUzPhone(raw);
    if (!phone) throw new BadRequestException('Неверный номер телефона');
    return phone;
  }

  private async session<T extends { id: string }>(user: T) {
    const payload: JwtPayload = { sub: user.id };
    return { token: await this.jwt.signAsync(payload), user };
  }
}
