import { asyncHandler } from '../middleware/asyncHandler';
import { AuthService } from '../services/AuthService';

export class LogoutAllController {
  constructor(private readonly authService: AuthService) {}

  handle = asyncHandler(async (request, response) => {
    const revokedSessions = await this.authService.logoutAll(request.userId);

    response
      .status(200)
      .json({ message: 'Logged out of all sessions', revokedSessions });
  });
}
