import { Role } from '@prisma/client';

export type JwtPayload = { sub: string; role: Role };

// То, что JwtStrategy кладёт в request.user
export type AuthUser = { id: string; role: Role };
