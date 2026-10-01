# Canvas integration
Use the UBC LMS toolkit for OAuth, paginated API reads and bounded file downloads.
Tokens are encrypted with the deployment's CANVAS_TOKEN_KEY. Never log tokens,
SAML assertions, raw rosters or OAuth codes. Only the configured Canvas origin
is allowed. Business logic and course authorization belong in the service/routes.

Role sync also requests the read-only courses/:course_id/enrollments scope.
Existing OAuth connections must reconnect after the Developer Key is updated.
Use the toolkit paginated API for role reads; no credentials leave the backend.
