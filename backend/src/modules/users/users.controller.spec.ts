import { Test, TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { ForbiddenException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { RolesGuard } from '../../common/guards/roles.guard';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';

const mockUsersService = {
  findAllPaginated: jest.fn(),
  findByIdOrFail: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  setStatus: jest.fn(),
  resendInvitation: jest.fn(),
  revokeInvitation: jest.fn(),
};

function contextFor(role: UserRole, handler: Function) {
  return {
    getHandler: () => handler,
    getClass: () => UsersController,
    switchToHttp: () => ({ getRequest: () => ({ user: { id: 'actor-1', role } }) }),
  } as any;
}

describe('UsersController', () => {
  let controller: UsersController;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [{ provide: UsersService, useValue: mockUsersService }],
    }).compile();
    controller = module.get(UsersController);
  });

  describe('authorization metadata', () => {
    it('requires JwtAuthGuard and RolesGuard on the controller', () => {
      const guards = Reflect.getMetadata('__guards__', UsersController) ?? [];
      const names = guards.map((g: any) => g.name ?? g.constructor?.name);
      expect(names).toContain(JwtAuthGuard.name);
      expect(names).toContain(RolesGuard.name);
    });

    it.each([
      'findAll',
      'create',
      'findById',
      'update',
      'updateStatus',
      'resendInvitation',
      'revokeInvitation',
    ])('restricts %s to admin', method => {
      const roles = Reflect.getMetadata(ROLES_KEY, (UsersController.prototype as any)[method]);
      expect(roles).toEqual([UserRole.admin]);
    });

    it.each([UserRole.attendant, UserRole.financial])('RolesGuard rejects %s', role => {
      const guard = new RolesGuard(new Reflector());
      expect(() =>
        guard.canActivate(contextFor(role, UsersController.prototype.findAll)),
      ).toThrow(ForbiddenException);
    });

    it('RolesGuard allows admin', () => {
      const guard = new RolesGuard(new Reflector());
      expect(guard.canActivate(contextFor(UserRole.admin, UsersController.prototype.findAll))).toBe(
        true,
      );
    });
  });

  describe('delegation', () => {
    it('passes the actor id from the request to create', async () => {
      mockUsersService.create.mockResolvedValue({ user: { id: 'u1' }, invitationEmailSent: true });
      const dto = { name: 'Maria', email: 'maria@test.com', role: UserRole.attendant as any };

      const result = await controller.create(dto, { user: { id: 'actor-1' } } as any, '127.0.0.1');

      expect(mockUsersService.create).toHaveBeenCalledWith(dto, 'actor-1', '127.0.0.1');
      expect(result).toEqual({ user: { id: 'u1' }, invitationEmailSent: true });
    });

    it('passes the actor id to updateStatus', async () => {
      mockUsersService.setStatus.mockResolvedValue({ id: 'u1' });
      await controller.updateStatus(
        'u1',
        { isActive: false },
        { user: { id: 'actor-1' } } as any,
        '127.0.0.1',
      );
      expect(mockUsersService.setStatus).toHaveBeenCalledWith('u1', false, 'actor-1', '127.0.0.1');
    });

    it('returns nothing from revokeInvitation', async () => {
      mockUsersService.revokeInvitation.mockResolvedValue(undefined);
      await expect(
        controller.revokeInvitation('u1', { user: { id: 'actor-1' } } as any, '127.0.0.1'),
      ).resolves.toBeUndefined();
    });
  });
});
