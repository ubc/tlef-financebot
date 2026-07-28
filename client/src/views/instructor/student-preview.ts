import type { Route } from '../../router.js';
import { renderStudentCourses } from '../home.js';
import { renderCourseHomeWithExperience } from '../student/course-home.js';
import type { StudentExperience } from '../student/experience.js';
import { renderLoListWithExperience } from '../student/lo-list.js';
import { renderPracticeWithExperience } from '../student/practice.js';
import { renderReviewBookWithExperience } from '../student/review-book.js';
import { renderSessionSummaryWithExperience } from '../student/session-summary.js';

/**
 * Preview uses the real student renderers and route structure. The only
 * difference is the `/preview` namespace and the injected isolated data
 * adapter; no alternate topic-card HTML or Preview-only layout exists.
 */
export function previewStudentRoutes(experience: StudentExperience): Route[] {
  return [
    {
      path: '/preview/course/:id/practice-theme/:themeId',
      render: (outlet, params) => renderPracticeWithExperience(outlet, params, experience),
    },
    {
      path: '/preview/course/:id/practice/:loId',
      render: (outlet, params) => renderPracticeWithExperience(outlet, params, experience),
    },
    {
      path: '/preview/course/:id/review-book',
      render: (outlet, params) => renderReviewBookWithExperience(outlet, params, experience),
    },
    {
      path: '/preview/course/:id/summary',
      render: (outlet, params) => renderSessionSummaryWithExperience(outlet, params, experience),
    },
    {
      path: '/preview/course/:id/theme/:themeId',
      render: (outlet, params) => renderLoListWithExperience(outlet, params, experience),
    },
    {
      path: '/preview/course/:id/courses',
      render: (outlet, params) => renderStudentCourses(outlet, experience, params.id),
    },
    {
      path: '/preview/course/:id',
      render: (outlet, params) => renderCourseHomeWithExperience(outlet, params, experience),
    },
  ];
}
