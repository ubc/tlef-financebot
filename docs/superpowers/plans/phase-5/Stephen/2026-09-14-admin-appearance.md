# Admin appearance and local persona — Stephen

Goal: Admin accounts display an explicit Admin identity and a black sidebar with switchable light/dark content; add the local IdP admin/admin test persona.

- [x] Apply Admin-only neutral light/dark tokens and a fixed black sidebar and role identity, retaining other role theme preferences and real Student/TA preview chrome.
- [x] Add a unique local IdP persona matching the existing configured Admin PUID; verify actual SAML login and server isAdmin projection.
- [x] Verify Admin pages at desktop/mobile, accessibility, navigation and non-Admin theme restoration. Preserve previous local loading changes.
- [x] Record verification and sync Stephen plans. No application commits or pushes.

Verification: typecheck, lint, build and whitespace checks passed. Real local
SAML admin/admin login returned uid admin, PUID PUID-ADMIN-0001 and isAdmin true.
All four Admin pages plus mobile navigation passed WCAG A/AA axe; logout restored
the previously saved light preference. IdP PHP syntax check passed. No Admin
directory/settings mutations and no application commit/push. IdP file lives in
/Users/fanhaocheng/tlef/services/docker-simple-saml/config/simplesamlphp/authsources.php.
The existing local allowlist already matched this PUID, so no env edits/restart.

User correction: Admin retains a theme toggle; only the sidebar stays black. Both themes persist across refresh and are verified on all four Admin pages and mobile navigation.
