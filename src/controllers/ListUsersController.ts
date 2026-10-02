import { asyncHandler } from '../middleware/asyncHandler';
import { UserService } from '../services/UserService';

export class ListUsersController {
  constructor(private readonly userService: UserService) {}

  handle = asyncHandler(async (request, response) => {
    const result = await this.userService.listUsers(request.query);

    response.status(200).json(result);
  });
}
