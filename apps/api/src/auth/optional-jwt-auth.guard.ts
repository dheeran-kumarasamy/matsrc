import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';

@Injectable()
export class OptionalJwtAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    
    // Try JWT first
    const authHeader = request.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      try {
        const token = authHeader.substring(7);
        // In dev mode, use token as user ID
        request.user = {
          userId: token,
          email: request.headers['x-user-email'] || token,
          role: request.headers['x-user-role'] || 'SUPPLIER',
          name: request.headers['x-user-name'],
        };
        return true;
      } catch (err) {
        // Fall through to header-based auth
      }
    }

    // Fall back to header-based auth (for dev/proxy)
    const userId = request.headers['x-user-id'];
    const userEmail = request.headers['x-user-email'];

    if (!userId || !userEmail) {
      throw new UnauthorizedException('No authentication provided');
    }

    request.user = {
      userId,
      email: userEmail,
      role: request.headers['x-user-role'] || 'SUPPLIER',
      name: request.headers['x-user-name'],
    };

    return true;
  }
}
