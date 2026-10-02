import { UserRole } from '../../types/user';

// Adding an `import` makes this file a module, so the augmentation below
// must be wrapped in `declare global` — otherwise it declares a namespace
// scoped to this module instead of actually extending Express's own types.
declare global {
  namespace Express {
    export interface Request {
      userId: string;
      sessionId: string;
      userRole: UserRole;
    }
  }
}

export {};
