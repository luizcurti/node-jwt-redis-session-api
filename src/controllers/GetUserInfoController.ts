import { ValidationError } from '../errors/AppError';
import { asyncHandler } from '../middleware/asyncHandler';
import { UserService } from '../services/UserService';

export class GetUserInfoController {
  constructor(private readonly userService: UserService) {}

  handle = asyncHandler(async (request, response) => {
    const { id } = request.params;

    if (typeof id !== 'string') {
      throw new ValidationError('User ID is required in the request.');
    }

    const profile = await this.userService.getUserProfile(request.userId, id);

    response.status(200).json(profile);
  });
}
