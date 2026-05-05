import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

@Injectable()
export class AuthService {
  constructor(private jwtService: JwtService) {}

  generateToken(userId: string, email: string, role: string, phone?: string) {
    const payload = {
      sub: userId,
      email,
      role,
      phone,
    };
    return this.jwtService.sign(payload);
  }

  verifyToken(token: string) {
    try {
      return this.jwtService.verify(token);
    } catch (error) {
      return null;
    }
  }
}
