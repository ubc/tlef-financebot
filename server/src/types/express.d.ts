import type { AppUser } from '../components/auth/strategies/shibboleth';

// Make req.user the shape we store in the session (see passport serialize/
// deserialize in components/auth/index.ts).
declare global {
  namespace Express {
    interface User extends AppUser {}
  }
}

export {};
