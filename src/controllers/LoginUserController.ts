import { asyncHandler } from '../middleware/asyncHandler';
import { AuthService } from '../services/AuthService';

export class LoginUserController {
  constructor(private readonly authService: AuthService) {}

  handle = asyncHandler(async (request, response) => {
    const { accessToken, refreshToken, user } = await this.authService.login(
      request.body
    );

    response.status(200).json({
      message: 'Login successful',
      accessToken,
      refreshToken,
      user,
    });
  });
}
