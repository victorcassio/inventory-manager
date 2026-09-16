import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { User } from '@prisma/client';
import { UsersService } from '../users/users.service';
import { PrismaService } from '../../prisma/prisma.service';
import { HashingService } from '../hashing/hashing.service';

export interface TokensDto {
  accessToken: string;
  refreshToken: string;
  user?: {
    id: string;
    name: string;
    email: string;
    role: string;
    isActive: boolean;
    lastLogin: Date | null;
    emailVerifiedAt: Date | null;
    passwordSetAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  };
}

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly hashing: HashingService,
  ) {}

  async validateUser(email: string, password: string): Promise<User | null> {
    const user = await this.usersService.findByEmail(email);

    // No eligible stored password: inactive, unverified, never activated, or no
    // such user. Pay the hashing cost anyway so the four cases are not
    // distinguishable by response time, then fail generically.
    if (!user || !user.isActive || !user.password || !user.emailVerifiedAt) {
      await this.hashing.verifyDummy(password);
      return null;
    }

    const { valid, needsRehash } = await this.hashing.verify(user.password, password);
    if (valid !== true) return null;

    if (needsRehash) {
      // Conditional on the old hash so a concurrent reset/change wins instead of
      // being overwritten. passwordChangedAt is deliberately untouched: a
      // transparent rehash is not a user-initiated change. rehashLegacy() is
      // used deliberately instead of hash(): this password already predates
      // the current policy and was just accepted as correct, so it must not
      // be re-validated against the policy — that would lock the user out.
      await this.prisma.user.updateMany({
        where: { id: user.id, password: user.password },
        data: { password: await this.hashing.rehashLegacy(password) },
      });
    }

    return user;
  }

  async login(user: User): Promise<TokensDto> {
    const tokens = await this.generateTokens(user);
    await this.saveRefreshToken(user.id, tokens.refreshToken);

    // Cleanup revoked and expired tokens for this user to prevent table growth
    await this.prisma.refreshToken.deleteMany({
      where: {
        userId: user.id,
        OR: [{ revoked: true }, { expiresAt: { lt: new Date() } }],
      },
    });

    const updated = await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLogin: new Date() },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        isActive: true,
        lastLogin: true,
        emailVerifiedAt: true,
        passwordSetAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    return { ...tokens, user: updated };
  }

  async refreshTokens(refreshToken: string): Promise<TokensDto> {
    const stored = await this.prisma.refreshToken.findUnique({
      where: { token: refreshToken },
      include: { user: true },
    });

    if (!stored || stored.revoked || stored.expiresAt < new Date()) {
      throw new UnauthorizedException('Token de refresh inválido ou expirado');
    }

    const { user } = stored;
    if (!user.isActive || !user.emailVerifiedAt || !user.password) {
      // A deactivated or incomplete account must not receive a new token pair,
      // and the token it presented is burned.
      await this.prisma.refreshToken.update({
        where: { id: stored.id },
        data: { revoked: true },
      });
      throw new UnauthorizedException('Token de refresh inválido ou expirado');
    }

    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revoked: true },
    });

    const tokens = await this.generateTokens(stored.user);
    await this.saveRefreshToken(stored.user.id, tokens.refreshToken);
    return tokens;
  }

  async logout(refreshToken: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { token: refreshToken, revoked: false },
      data: { revoked: true },
    });
  }

  private async generateTokens(user: User): Promise<TokensDto> {
    const accessPayload = { sub: user.id, email: user.email, role: user.role };
    const refreshPayload = { sub: user.id, jti: randomUUID() };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(accessPayload, {
        secret: this.configService.get<string>('app.jwt.accessSecret'),
        expiresIn: this.configService.get<string>('app.jwt.accessExpiresIn') as any,
      }),
      this.jwtService.signAsync(refreshPayload, {
        secret: this.configService.get<string>('app.jwt.refreshSecret'),
        expiresIn: this.configService.get<string>('app.jwt.refreshExpiresIn') as any,
      }),
    ]);

    return { accessToken, refreshToken };
  }

  private async saveRefreshToken(userId: string, token: string): Promise<void> {
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);
    await this.prisma.refreshToken.create({
      data: { userId, token, expiresAt },
    });
  }
}
