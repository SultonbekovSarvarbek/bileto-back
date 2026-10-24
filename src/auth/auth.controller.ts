import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { SendOtpDto } from './dto/send-otp.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /** Отправить код входа по SMS */
  @Post('otp/send')
  @HttpCode(200)
  send(@Body() dto: SendOtpDto) {
    return this.auth.sendOtp(dto.phone);
  }

  /** Проверить код и получить JWT. Пользователь создаётся при первом входе. */
  @Post('otp/verify')
  @HttpCode(200)
  verify(@Body() dto: VerifyOtpDto) {
    return this.auth.verifyOtp(dto.phone, dto.code);
  }
}
