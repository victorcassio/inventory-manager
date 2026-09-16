import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { User, UserActionTokenType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService, Tx } from '../audit/audit.service';
import { PaginatedResult } from '../../common/types/paginated-result.interface';
import { UserActionTokensService } from '../user-action-tokens/user-action-tokens.service';
import { InvitationsService } from './invitations.service';
import { USER_SELECT, UserResponse, toUserResponse } from './user-response.mapper';
import { ListUsersDto } from './dto/list-users.dto';
import { CreateUserDto, INVITABLE_ROLES } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: UserActionTokensService,
    private readonly invitations: InvitationsService,
    private readonly audit: AuditService,
  ) {}

  /** Used by AuthService — returns the full row including the password hash. */
  async findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({
      where: { email: email.toLowerCase().trim() },
    });
  }

  /** Used by JwtStrategy — returns the full row including the password hash. */
  async findById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id } });
  }

  async findAllPaginated(query: ListUsersDto): Promise<PaginatedResult<UserResponse>> {
    // PaginationDto arrives as strings through an intersection type — coerce.
    const page = Number(query.page) || 1;
    const limit = Number(query.limit) || 20;
    const skip = (page - 1) * limit;

    const where: any = {};

    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { email: { contains: query.search.toLowerCase(), mode: 'insensitive' } },
      ];
    }

    if (query.role) where.role = query.role;
    if (query.status) where.isActive = query.status === 'active';

    const [rows, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        select: USER_SELECT,
        skip,
        take: limit,
        orderBy: { name: 'asc' },
      }),
      this.prisma.user.count({ where }),
    ]);

    // One query for the whole page instead of one per row.
    const invitations = await this.tokens.findLatest(
      rows.map(r => r.id),
      UserActionTokenType.invitation,
    );

    return {
      data: rows.map(r => toUserResponse(r, invitations.get(r.id))),
      total,
      page,
      limit,
    };
  }

  async findByIdOrFail(id: string): Promise<UserResponse> {
    const user = await this.prisma.user.findUnique({ where: { id }, select: USER_SELECT });
    if (!user) throw new NotFoundException('Usuário não encontrado');

    const invitations = await this.tokens.findLatest([id], UserActionTokenType.invitation);
    return toUserResponse(user, invitations.get(id));
  }

  async create(
    dto: CreateUserDto,
    actorId: string,
    ipAddress?: string,
  ): Promise<{ user: UserResponse; invitationEmailSent: boolean }> {
    // The DTO already restricts this, but a DTO is not a security boundary.
    if (!INVITABLE_ROLES.includes(dto.role as any)) {
      throw new ForbiddenException('Não é permitido criar usuários administradores por este fluxo');
    }

    const email = dto.email.trim().toLowerCase();

    const existing = await this.prisma.user.findFirst({
      where: { email: { equals: email, mode: 'insensitive' } },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException('Já existe um usuário com este e-mail');
    }

    let created: { id: string };
    try {
      created = await this.prisma.$transaction(async (tx: Tx) => {
        const user = await tx.user.create({
          data: {
            name: dto.name,
            email,
            role: dto.role,
            // No password: the user sets it through the invitation link.
            password: null,
            isActive: true,
          },
          select: { id: true },
        });

        await this.audit.log(
          {
            userId: actorId,
            action: 'create_user',
            entity: 'User',
            entityId: user.id,
            payload: { role: dto.role },
            ipAddress,
          },
          tx,
        );

        return user;
      });
    } catch (error: any) {
      // Loses the race against the functional unique index — same 409.
      if (error?.code === 'P2002') {
        throw new ConflictException('Já existe um usuário com este e-mail');
      }
      throw error;
    }

    // Delivery happens after the commit, so a mail failure cannot roll back the
    // user. The token stays valid and the admin can resend on the same row.
    const invitationEmailSent = await this.invitations.sendInvitation(created.id);

    if (!invitationEmailSent) {
      await this.audit.log({
        userId: actorId,
        action: 'invitation_email_failed',
        entity: 'User',
        entityId: created.id,
        payload: { invitationEmailSent: false },
        ipAddress,
      });
    }

    return { user: await this.findByIdOrFail(created.id), invitationEmailSent };
  }

  async update(
    id: string,
    dto: UpdateUserDto,
    actorId: string,
    ipAddress?: string,
  ): Promise<UserResponse> {
    const target = await this.requireManageableTarget(id);

    // Same reasoning as create(): the DTO restricts this, but a DTO is not a
    // security boundary. Any internal caller that bypasses the HTTP pipe would
    // otherwise be able to write role: 'admin' straight into the row.
    if (dto.role !== undefined && !INVITABLE_ROLES.includes(dto.role as any)) {
      throw new ForbiddenException('Não é permitido atribuir o perfil de administrador por este fluxo');
    }

    if (dto.role && id === actorId) {
      throw new ForbiddenException('Você não pode alterar seu próprio perfil por este fluxo');
    }

    const roleChanged = Boolean(dto.role && dto.role !== target.role);

    await this.prisma.$transaction(async (tx: Tx) => {
      await tx.user.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.role !== undefined ? { role: dto.role } : {}),
        },
      });

      if (roleChanged) {
        // The effective role already comes from the database on every request;
        // this exists so the frontend's cached role cannot linger in the UI.
        await tx.refreshToken.updateMany({
          where: { userId: id, revoked: false },
          data: { revoked: true },
        });
      }

      await this.audit.log(
        {
          userId: actorId,
          action: 'update_user',
          entity: 'User',
          entityId: id,
          payload: { ...(dto.role ? { role: dto.role } : {}) },
          ipAddress,
        },
        tx,
      );
    });

    return this.findByIdOrFail(id);
  }

  async setStatus(
    id: string,
    isActive: boolean,
    actorId: string,
    ipAddress?: string,
  ): Promise<UserResponse> {
    if (id === actorId) {
      throw new ForbiddenException('Você não pode alterar o status da sua própria conta');
    }

    const target = await this.requireManageableTarget(id);

    if (!isActive) {
      await this.assertNotLastActiveAdmin(target);
    }

    await this.prisma.$transaction(async (tx: Tx) => {
      await tx.user.update({ where: { id }, data: { isActive } });

      if (!isActive) {
        // Otherwise a disabled account keeps renewable sessions.
        await tx.refreshToken.updateMany({
          where: { userId: id, revoked: false },
          data: { revoked: true },
        });
      }

      await this.audit.log(
        {
          userId: actorId,
          action: 'update_user_status',
          entity: 'User',
          entityId: id,
          payload: { isActive },
          ipAddress,
        },
        tx,
      );
    });

    return this.findByIdOrFail(id);
  }

  async resendInvitation(
    id: string,
    actorId: string,
    ipAddress?: string,
  ): Promise<{ user: UserResponse; invitationEmailSent: boolean }> {
    const target = await this.requireManageableTarget(id);

    if (target.passwordSetAt) {
      throw new ConflictException('Este usuário já ativou a conta');
    }

    if (!target.isActive) {
      // Never silently reactivate — the admin must do that explicitly.
      throw new ConflictException('Reative o usuário antes de reenviar o convite');
    }

    const invitationEmailSent = await this.invitations.sendInvitation(id);

    await this.audit.log({
      userId: actorId,
      action: 'resend_user_invitation',
      entity: 'User',
      entityId: id,
      payload: { invitationEmailSent },
      ipAddress,
    });

    return { user: await this.findByIdOrFail(id), invitationEmailSent };
  }

  async revokeInvitation(id: string, actorId: string, ipAddress?: string): Promise<void> {
    await this.requireManageableTarget(id);
    await this.invitations.revoke(id, actorId, ipAddress);
  }

  /** 404 when absent, 403 when the target is an admin (admin management is out of scope). */
  private async requireManageableTarget(id: string) {
    const target = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true, role: true, isActive: true, passwordSetAt: true },
    });

    if (!target) throw new NotFoundException('Usuário não encontrado');

    if (target.role === 'admin') {
      throw new ForbiddenException('Gerenciamento de administradores não é permitido por este fluxo');
    }

    return target;
  }

  /**
   * Unreachable while admin targets are refused above — implemented and wired
   * so it is live the day admin management is enabled.
   */
  private async assertNotLastActiveAdmin(target: { id: string; role: string }): Promise<void> {
    if (target.role !== 'admin') return;

    const activeAdmins = await this.prisma.user.count({
      where: { role: 'admin', isActive: true, id: { not: target.id } },
    });

    if (activeAdmins === 0) {
      throw new ForbiddenException(
        'Não é possível desativar o último administrador ativo do sistema',
      );
    }
  }
}
