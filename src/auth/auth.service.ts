import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createHmac, randomInt, timingSafeEqual } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { SmsService } from '../sms/sms.service';
import { normalizeUzPhone } from '../common/utils/phone';
import { JwtPayload } from '../common/types/auth-user.type';
import { addMinutes } from '../common/utils/deal-rules';

const CODE_TTL_MIN = 3;
const RESEND_AFTER_SEC = 60;
const MAX_ATTEMPTS = 5;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly sms: SmsService,
    private readonly config: ConfigService,
  ) {}

  private phoneOrThrow(raw: string) {
    const phone = normalizeUzPhone(raw);
    if (!phone) throw new BadRequestException('Неверный номер телефона');
    return phone;
  }

  private hash(phone: string, code: string) {
    return createHmac('sha256', this.config.getOrThrow<string>('JWT_SECRET'))
      .update(`${phone}:${code}`)
      .digest('hex');
  }

  async sendOtp(rawPhone: string) {
    const phone = this.phoneOrThrow(rawPhone);
    const last = await this.prisma.otpCode.findFirst({
      where: { phone },
      orderBy: { createdAt: 'desc' },
    });
    if (
      last &&
      Date.now() - last.createdAt.getTime() < RESEND_AFTER_SEC * 1000
    ) {
      throw new HttpException(
        'Повторная отправка кода через минуту',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const code = String(randomInt(0, 10_000)).padStart(4, '0');
    await this.prisma.otpCode.create({
      data: {
        phone,
        codeHash: this.hash(phone, code),
        expiresAt: addMinutes(new Date(), CODE_TTL_MIN),
      },
    });
    await this.sms.send(phone, `Bileto: код входа ${code}`);

    const echo =
      this.config.get<string>('OTP_DEV_ECHO') === 'true' &&
      this.config.get<string>('NODE_ENV') !== 'production';
    return {
      phone,
      expiresIn: CODE_TTL_MIN * 60,
      retryAfter: RESEND_AFTER_SEC,
      ...(echo ? { devCode: code } : {}),
    };
  }

  async verifyOtp(rawPhone: string, code: string) {
    const phone = this.phoneOrThrow(rawPhone);
    const otp = await this.prisma.otpCode.findFirst({
      where: { phone, usedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    if (!otp) throw new UnauthorizedException('Код истёк, запросите новый');
    if (otp.attempts >= MAX_ATTEMPTS) {
      throw new HttpException(
        'Слишком много попыток, запросите новый код',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const ok = timingSafeEqual(
      Buffer.from(otp.codeHash),
      Buffer.from(this.hash(phone, code)),
    );
    if (!ok) {
      await this.prisma.otpCode.update({
        where: { id: otp.id },
        data: { attempts: { increment: 1 } },
      });
      throw new UnauthorizedException('Неверный код');
    }

    // Атомарно гасим код: параллельный запрос с тем же кодом не пройдёт.
    const used = await this.prisma.otpCode.updateMany({
      where: { id: otp.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (!used.count) throw new UnauthorizedException('Код уже использован');

    const user = await this.prisma.user.upsert({
      where: { phone },
      update: {},
      create: { phone },
    });
    const payload: JwtPayload = { sub: user.id, role: user.role };
    return { token: await this.jwt.signAsync(payload), user };
  }
}
