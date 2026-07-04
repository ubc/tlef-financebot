// Minimal type declarations for passport-ubcshib (0.1.x), which ships no types.
// Only the surface this project uses is declared. See the package README:
// https://github.com/ubc/passport-ubcshib
declare module 'passport-ubcshib' {
  import type { Strategy as PassportStrategy } from 'passport';
  import type { RequestHandler } from 'express';

  export interface UBCStrategyOptions {
    /** Service Provider entity ID. Must match the SP entry in the IdP. */
    issuer: string;
    /** Assertion Consumer Service URL the IdP posts back to. */
    callbackUrl: string;
    /** IdP public signing certificate (PEM or base64). Required in practice. */
    cert: string | string[];
    /** IdP SSO endpoint. Overrides the SAML_ENVIRONMENT preset. */
    entryPoint?: string;
    /** IdP single-logout endpoint. */
    logoutUrl?: string;
    /** IdP metadata URL (used only for optional cert auto-fetch). */
    metadataUrl?: string;
    /** Path to the SP private key for signing requests (optional; not needed for LOCAL). */
    privateKeyPath?: string;
    /** Friendly attribute names to request/map from the IdP. */
    attributeConfig?: string[];
    enableSLO?: boolean;
    validateInResponseTo?: boolean;
    acceptedClockSkewMs?: number;
    signatureAlgorithm?: string;
    digestAlgorithm?: string;
    identifierFormat?: string | null;
  }

  export interface UBCProfile {
    nameID: string;
    nameIDFormat?: string;
    /** Mapped attributes (present when attributeConfig is provided). */
    attributes?: Record<string, unknown>;
    [key: string]: unknown;
  }

  export type UBCVerifyCallback = (
    profile: UBCProfile,
    done: (err: unknown, user?: unknown) => void,
  ) => void;

  export class Strategy implements PassportStrategy {
    constructor(options: UBCStrategyOptions, verify: UBCVerifyCallback);
    name?: string;
    authenticate(req: unknown, options?: unknown): unknown;
  }

  export function ensureAuthenticated(options?: { loginUrl?: string }): RequestHandler;
  export function conditionalAuth(check: (req: unknown) => boolean): RequestHandler;
  export function logout(returnUrl?: string): RequestHandler;
  export const UBC_CONFIG: Record<
    string,
    { entryPoint: string; logoutUrl: string; metadataUrl: string }
  >;
}
