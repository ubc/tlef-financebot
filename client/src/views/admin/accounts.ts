import { renderAdminUsers } from './users.js';
import type { RouteParams } from '../../router.js';

/** Existing bookmarks and tutorial replay share the unified user directory. */
export function renderAdminAccounts(outlet: HTMLElement, params: RouteParams): void {
  renderAdminUsers(outlet, params);
}
