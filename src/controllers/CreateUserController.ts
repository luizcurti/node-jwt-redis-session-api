import { asyncHandler } from '../middleware/asyncHandler';
import { UserService } from '../services/UserService';

export class CreateUserController {
  constructor(private readonly userService: UserService) {}

  handle = asyncHandler(async (request, response) => {
    const { id } = await this.userService.createUser(request.body);

    response
      .status(201)
      .json({ message: 'User created successfully', userId: id });
  });
}
