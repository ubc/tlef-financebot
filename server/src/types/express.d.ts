import type { User as DomainUser } from './domain';

// req.user is the domain User (see passport deserializeUser in
// components/auth/index.ts, which reloads it from MongoDB by PUID).
declare global {
  namespace Express {
    interface User extends DomainUser {}
  }
}

export {};
