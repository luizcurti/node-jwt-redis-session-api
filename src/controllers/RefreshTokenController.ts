import { asyncHandler } from '../middleware/asyncHandler';
import { AuthService } from '../services/AuthService';

export class RefreshTokenController {
  constructor(private readonly authService: AuthService) {}

  handle = asyncHandler(async (request, response) => {
    const { accessToken, refreshToken } = await this.authService.refresh(
      request.body.refreshToken
    );

    response.status(200).json({
      message: 'Token refreshed successfully',
      accessToken,
      refreshToken,
    });
  });
}
