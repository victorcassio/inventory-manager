import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FakeMailService } from './fake-mail.service';

const MESSAGE = {
  to: 'maria@example.com',
  subject: 'Convite de acesso — Inventory Manager',
  html: '<a href="http://localhost:5173/activate-account#token=SECRET_TOKEN">x</a>',
  text: 'http://localhost:5173/activate-account#token=SECRET_TOKEN',
};

function serviceFor(nodeEnv: string) {
  const config = { get: jest.fn().mockReturnValue(nodeEnv) } as unknown as ConfigService;
  return new FakeMailService(config);
}

describe('FakeMailService', () => {
  describe('in the test environment', () => {
    it('keeps sent messages in memory for inspection', async () => {
      const service = serviceFor('test');
      await service.send(MESSAGE);
      expect(service.sent).toHaveLength(1);
      expect(service.sent[0].to).toBe('maria@example.com');
    });

    it('reset() clears the inspector', async () => {
      const service = serviceFor('test');
      await service.send(MESSAGE);
      service.reset();
      expect(service.sent).toHaveLength(0);
    });
  });

  describe('in development', () => {
    it('does not retain messages in memory', async () => {
      const service = serviceFor('development');
      await service.send(MESSAGE);
      expect(service.sent).toHaveLength(0);
    });

    it('logs the recipient and subject but never the token or the URL', async () => {
      const service = serviceFor('development');
      const spy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);

      await service.send(MESSAGE);

      expect(spy).toHaveBeenCalledTimes(1);
      const logged = String(spy.mock.calls[0][0]);
      expect(logged).toContain('maria@example.com');
      expect(logged).toContain('Convite de acesso');
      expect(logged).not.toContain('SECRET_TOKEN');
      expect(logged).not.toContain('#token=');
      expect(logged).not.toContain('activate-account');

      spy.mockRestore();
    });
  });
});
