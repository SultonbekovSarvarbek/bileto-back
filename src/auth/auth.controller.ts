import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { LoginDto, RegisterDto } from './dto/login.dto';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /** Регистрация: имя, номер телефона, пароль и роль. Возвращает JWT. */
  @Post('register')
  @HttpCode(200)
  register(@Body() dto: RegisterDto) {
    return this.auth.register(dto.name, dto.phone, dto.password, dto.role);
  }

  /** Вход по номеру телефона и паролю. Возвращает JWT. */
  @Post('login')
  @HttpCode(200)
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto.phone, dto.password);
  }
}
