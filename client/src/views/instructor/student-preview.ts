import { renderDiscussion } from '../student/discussion.js';
import type { Route } from '../../router.js';
import { renderStudentCourses } from '../home.js';
import { renderCourseHomeWithExperience } from '../student/course-home.js';
import type { StudentExperience } from '../student/experience.js';
import { renderLoListWithExperience } from '../student/lo-list.js';
import { renderPracticeWithExperience } from '../student/practice.js';
import { renderReviewBookWithExperience } from '../student/review-book.js';
import { renderSessionSummaryWithExperience } from '../student/session-summary.js';
import { createPreviewAssessmentExperience } from '../../assessment-experience.js';
import { renderAssessments, renderAssessmentAttempt } from '../student/assessments.js';

/**
 * Preview uses the real student renderers and route structure. The only
 * difference is the `/preview` namespace and the injected isolated data
 * adapter; no alternate topic-card HTML or Preview-only layout exists.
 */
export function previewStudentRoutes(experience: StudentExperience, restricted = false): Route[] {
  const base = `/preview/${restricted ? 'restricted/' : ''}course/:id`;
  const assessments = createPreviewAssessmentExperience(restricted);
  return [
    { path: `${base}/assessments`, render: (outlet, params) => renderAssessments(outlet, params, assessments) },
    { path: `${base}/assessment/:attemptId`, render: (outlet, params) => renderAssessmentAttempt(outlet, params, assessments) },
    { path: `${base}/discussion`, render: (outlet, params) => renderDiscussion(outlet, params, true) },
    {
      path: `${base}/practice-theme/:themeId`,
      render: (outlet, params) => renderPracticeWithExperience(outlet, params, experience),
    },
    {
      path: `${base}/practice/:loId`,
      render: (outlet, params) => renderPracticeWithExperience(outlet, params, experience),
    },
    {
      path: `${base}/review-book`,
      render: (outlet, params) => renderReviewBookWithExperience(outlet, params, experience),
    },
    {
      path: `${base}/summary`,
      render: (outlet, params) => renderSessionSummaryWithExperience(outlet, params, experience),
    },
    {
      path: `${base}/theme/:themeId`,
      render: (outlet, params) => renderLoListWithExperience(outlet, params, experience),
    },
    {
      path: `${base}/courses`,
      render: (outlet, params) => renderStudentCourses(outlet, experience, params.id),
    },
    {
      path: base,
      render: (outlet, params) => renderCourseHomeWithExperience(outlet, params, experience),
    },
  ];
}
