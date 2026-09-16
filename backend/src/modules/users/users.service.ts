import { Injectable, NotFoundException } from '@nestjs/common';
import { User, UserActionTokenType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { PaginatedResult } from '../../common/types/paginated-result.interface';
import { UserActionTokensService } from '../user-action-tokens/user-action-tokens.service';
import { InvitationsService } from './invitations.service';
import { USER_SELECT, UserResponse, toUserResponse } from './user-response.mapper';
import { ListUsersDto } from './dto/list-users.dto';

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
}
