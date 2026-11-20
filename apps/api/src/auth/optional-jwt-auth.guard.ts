import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  ForbiddenException,
  Optional,
  Inject,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  ServiceName,
  getServiceSecret,
  verifyServiceAssertion,
  verifyBearerToken,
  PERMITTED_SERVICE_ROLES,
} from './service-auth.util';

@Injectable()
export class OptionalJwtAuthGuard implements CanActivate {
  constructor(
    @Optional()
    @Inject(PrismaService)
    private readonly prisma?: PrismaService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const headers = request.headers;

    // 1. Try Bearer JWT first if present
    const authHeader = headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.substring(7).trim();
      const userPayload = verifyBearerToken(token);

      if (this.prisma) {
        let dbUser = await this.prisma.user.findUnique({
          where: { id: userPayload.sub },
        });
        if (!dbUser && userPayload.email) {
          dbUser = await this.prisma.user.findUnique({
            where: { email: userPayload.email.toLowerCase() },
          });
        }

        if (!dbUser) {
          throw new UnauthorizedException('User identity not found in database');
        }

        if (dbUser.email && userPayload.email && dbUser.email.toLowerCase() !== userPayload.email.toLowerCase()) {
          throw new UnauthorizedException('User identity mismatch between token and database');
        }

        if ((dbUser as any).kycStatus === 'REJECTED') {
          throw new ForbiddenException('Account is disabled or KYC rejected');
        }

        request.user = {
          userId: dbUser.id,
          email: dbUser.email || userPayload.email,
          role: dbUser.role,
          name: dbUser.name || userPayload.name,
          phone: dbUser.phone || userPayload.phone,
        };
        return true;
      }

      request.user = {
        userId: userPayload.sub,
        email: userPayload.email,
        role: userPayload.role,
        name: userPayload.name,
        phone: userPayload.phone,
      };
      return true;
    }

    // 2. Try Service-to-Service assertion
    const serviceName = headers['x-service-name'] as ServiceName | undefined;
    const serviceKey = headers['x-service-key'] as string | undefined;
    const userAssertion = headers['x-user-assertion'] as string | undefined;

    if (serviceName || serviceKey || userAssertion) {
      if (!serviceName || !serviceKey || !userAssertion) {
        throw new UnauthorizedException('Incomplete service authentication headers');
      }

      if (!['buyer', 'supplier', 'admin'].includes(serviceName)) {
        throw new UnauthorizedException(`Unknown service name: ${serviceName}`);
      }

      const expectedKey = getServiceSecret(serviceName);
      if (serviceKey !== expectedKey) {
        throw new UnauthorizedException('Invalid service credential');
      }

      const verifiedUser = verifyServiceAssertion(userAssertion, serviceName);

      if (this.prisma) {
        let dbUser = await this.prisma.user.findUnique({
          where: { id: verifiedUser.sub },
        });
        if (!dbUser && verifiedUser.email) {
          dbUser = await this.prisma.user.findUnique({
            where: { email: verifiedUser.email.toLowerCase() },
          });
        }

        if (!dbUser) {
          throw new UnauthorizedException('User identity not found in database');
        }

        if (dbUser.email && verifiedUser.email && dbUser.email.toLowerCase() !== verifiedUser.email.toLowerCase()) {
          throw new UnauthorizedException('User identity mismatch between assertion and database');
        }

        if ((dbUser as any).kycStatus === 'REJECTED') {
          throw new ForbiddenException('Account is disabled or KYC rejected');
        }

        if (dbUser.role !== verifiedUser.role) {
          throw new ForbiddenException(
            `Database role mismatch: user has role '${dbUser.role}' but assertion claims '${verifiedUser.role}'`
          );
        }

        const allowedRoles = PERMITTED_SERVICE_ROLES[serviceName];
        if (!allowedRoles || !allowedRoles.includes(dbUser.role)) {
          throw new ForbiddenException(
            `Service '${serviceName}' is not authorized to assert database role '${dbUser.role}'`
          );
        }

        request.user = {
          userId: dbUser.id,
          email: dbUser.email || verifiedUser.email,
          role: dbUser.role,
          name: dbUser.name || verifiedUser.name,
          phone: dbUser.phone || verifiedUser.phone,
        };
        return true;
      }

      request.user = {
        userId: verifiedUser.sub,
        email: verifiedUser.email,
        role: verifiedUser.role,
        name: verifiedUser.name,
        phone: verifiedUser.phone,
      };
      return true;
    }

    // 3. Reject direct unauthenticated user headers
    if (headers['x-user-id'] || headers['x-user-email'] || headers['x-user-role']) {
      throw new UnauthorizedException('Direct unauthenticated user identity headers are not permitted');
    }

    // 4. No credentials provided
    throw new UnauthorizedException('No authentication provided');
  }
}
