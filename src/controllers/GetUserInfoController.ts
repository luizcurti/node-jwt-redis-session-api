import { asyncHandler } from '../middleware/asyncHandler';
import { UserService } from '../services/UserService';

// GET /v1/users/me — the profile is always the caller's own, taken from the
// authenticated session, so there is no `:id` to validate or to mismatch
// (and no IDOR surface to defend with a 403).
export class GetUserInfoController {
  constructor(private readonly userService: UserService) {}

  handle = asyncHandler(async (request, response) => {
    const profile = await this.userService.getUserProfile(request.userId);

    response.status(200).json(profile);
  });
}
