import { asyncHandler } from '../middleware/asyncHandler';
import { AuthService } from '../services/AuthService';

export class LogoutController {
  constructor(private readonly authService: AuthService) {}

  handle = asyncHandler(async (request, response) => {
    await this.authService.logout(request.sessionId);

    response.status(200).json({ message: 'Logout successful' });
  });
}
