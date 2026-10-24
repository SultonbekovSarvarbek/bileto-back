export type JwtPayload = { sub: string };

// То, что JwtStrategy кладёт в request.user
export type AuthUser = { id: string };
