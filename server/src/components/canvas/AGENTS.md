# Canvas integration
Use the UBC LMS toolkit for OAuth, paginated API reads and bounded file downloads.
Tokens are encrypted with the deployment's CANVAS_TOKEN_KEY. Never log tokens,
SAML assertions, raw rosters or OAuth codes. Only the configured Canvas origin
is allowed. Business logic and course authorization belong in the service/routes.
