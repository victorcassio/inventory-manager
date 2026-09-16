import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { UsersService } from '../../users/users.service';

export interface JwtPayload {
  sub: string;
  email: string;
  role: string;
  iat?: number;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    private readonly configService: ConfigService,
    private readonly usersService: UsersService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('app.jwt.accessSecret'),
    });
  }

  async validate(payload: JwtPayload) {
    const user = await this.usersService.findById(payload.sub);

    // The user is reloaded on every authenticated request, so deactivation and
    // role changes take effect immediately rather than after the access token
    // expires. The `role` claim in the token is informational and is never used
    // for authorization — RolesGuard reads req.user.role, which is this row.
    if (!user || !user.isActive || !user.emailVerifiedAt || !user.password) {
      throw new UnauthorizedException('Usuário não encontrado ou inativo');
    }

    // A password change or reset must end EVERY session, not just the refreshable
    // ones. Access tokens are stateless, so the only way to invalidate one is to
    // reject it here: any token issued before the last password change is dead.
    // The null guard is essential — the migration deliberately left
    // passwordChangedAt NULL for every pre-existing user, and without it they
    // would all be locked out instantly.
    if (
      user.passwordChangedAt &&
      payload.iat &&
      payload.iat * 1000 < user.passwordChangedAt.getTime()
    ) {
      throw new UnauthorizedException('Usuário não encontrado ou inativo');
    }

    return user;
  }
}
