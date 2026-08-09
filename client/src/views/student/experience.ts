import {
  ApiError,
  bookmarkPreviewQuestion,
  bookmarkQuestion,
  deferSessionSummary,
  endPreviewSessionSummary,
  enrollInCourse,
  flagPracticeQuestion,
  flagPreviewQuestion,
  getCourseHome,
  getCourseTree,
  getNextPracticeQuestion,
  getNextPreviewQuestion,
  getPreviewCourseHome,
  getPreviewReviewBook,
  getPreviewSessionSummary,
  getReviewBook,
  getSessionSummary,
  listEnrollments,
  removePreviewReviewBookEntry,
  removeReviewBookEntry,
  skipLo,
  skipPreviewLo,
  submitAttempt,
  submitPreviewAttempt,
  unbookmarkPreviewQuestion,
  unbookmarkQuestion,
  type AttemptResult,
  type CourseHomeTheme,
  type Enrollment,
  type EnrollmentResult,
  type PracticeQuestion,
  type ReviewBookGroup,
  type ReviewBookSort,
  type SessionEndSummary,
  type SessionSummaryForStart,
  type SubmitAttemptInput,
} from '../../api.js';
import { broadcastNotificationsChanged } from '../../notification-sync.js';
import { broadcastFlagsChanged } from '../../flag-sync.js';

export interface StudentRoutes {
  courses(courseId?: string): string;
  course(courseId: string): string;
  theme(courseId: string, themeId: string): string;
  practiceTheme(courseId: string, themeId: string, mode?: string): string;
  practice(courseId: string, loId: string, query?: string): string;
  reviewBook(courseId: string): string;
  summary(courseId: string, since?: Date): string;
}

export interface StudentExperience {
  readonly preview: boolean;
  readonly routes: StudentRoutes;
  listEnrollments(courseId?: string): Promise<Enrollment[]>;
  enroll(code: string, courseId?: string): Promise<EnrollmentResult>;
  getHome(courseId: string): Promise<CourseHomeTheme[]>;
  getNextQuestion(
    courseId: string,
    input: { loId: string; sessionServedIds: string[] },
  ): Promise<PracticeQuestion>;
  submit(courseId: string, input: SubmitAttemptInput): Promise<AttemptResult>;
  // `duplicate` is optional because only the live student path reports it —
  // the Preview implementation below dedupes per preview session and returns
  // `testQueued` instead. An absent value reads as "a new flag was recorded",
  // which is the right default for Preview.
  flag(
    courseId: string,
    questionId: string,
    reason?: string,
  ): Promise<{ flagged: true; duplicate?: boolean }>;
  skip(courseId: string, loId: string, attempted: boolean): Promise<void>;
  getSessionStart(courseId: string): Promise<SessionSummaryForStart>;
  endSession(courseId: string, since: Date): Promise<SessionEndSummary>;
  getReviewBook(courseId: string, sort: ReviewBookSort): Promise<ReviewBookGroup[]>;
  bookmark(courseId: string, questionId: string): Promise<{ bookmarked: boolean }>;
  unbookmark(courseId: string, questionId: string): Promise<{ bookmarked: boolean }>;
  removeReviewEntry(courseId: string, entryId: string): Promise<void>;
  materialHref(courseId: string, loId: string, materialId: string): string;
}

export const LIVE_STUDENT_ROUTES: StudentRoutes = {
  courses: () => '#/',
  course: (courseId) => `#/course/${encodeURIComponent(courseId)}`,
  theme: (courseId, themeId) =>
    `#/course/${encodeURIComponent(courseId)}/theme/${encodeURIComponent(themeId)}`,
  practiceTheme: (courseId, themeId, mode) =>
    `#/course/${encodeURIComponent(courseId)}/practice-theme/${encodeURIComponent(themeId)}${mode ? `?mode=${encodeURIComponent(mode)}` : ''}`,
  practice: (courseId, loId, query) =>
    `#/course/${encodeURIComponent(courseId)}/practice/${encodeURIComponent(loId)}${query ? `?${query}` : ''}`,
  reviewBook: (courseId) =>
    `#/course/${encodeURIComponent(courseId)}/review-book`,
  summary: (courseId, since) =>
    `#/course/${encodeURIComponent(courseId)}/summary${since ? `?since=${encodeURIComponent(since.toISOString())}` : ''}`,
};

export const LIVE_STUDENT_EXPERIENCE: StudentExperience = {
  preview: false,
  routes: LIVE_STUDENT_ROUTES,
  listEnrollments: () => listEnrollments(),
  enroll: (code) => enrollInCourse(code),
  getHome: getCourseHome,
  getNextQuestion: getNextPracticeQuestion,
  submit: (_courseId, input) => submitAttempt(input),
  flag: (_courseId, questionId, reason) => flagPracticeQuestion(questionId, reason),
  skip: skipLo,
  getSessionStart: getSessionSummary,
  endSession: deferSessionSummary,
  getReviewBook,
  bookmark: (_courseId, questionId) => bookmarkQuestion(questionId),
  unbookmark: (_courseId, questionId) => unbookmarkQuestion(questionId),
  removeReviewEntry: (_courseId, entryId) => removeReviewBookEntry(entryId),
  materialHref: (courseId, loId, materialId) =>
    `/api/courses/${encodeURIComponent(courseId)}/los/${encodeURIComponent(loId)}/materials/${encodeURIComponent(materialId)}/source`,
};

export function previewStudentRoutes(): StudentRoutes {
  const base = (courseId: string): string =>
    `/preview/course/${encodeURIComponent(courseId)}`;
  return {
    courses: (courseId) => `#${base(courseId ?? '')}/courses`,
    course: (courseId) => `#${base(courseId)}`,
    theme: (courseId, themeId) =>
      `#${base(courseId)}/theme/${encodeURIComponent(themeId)}`,
    practiceTheme: (courseId, themeId, mode) =>
      `#${base(courseId)}/practice-theme/${encodeURIComponent(themeId)}${mode ? `?mode=${encodeURIComponent(mode)}` : ''}`,
    practice: (courseId, loId, query) =>
      `#${base(courseId)}/practice/${encodeURIComponent(loId)}${query ? `?${query}` : ''}`,
    reviewBook: (courseId) => `#${base(courseId)}/review-book`,
    summary: (courseId, since) =>
      `#${base(courseId)}/summary${since ? `?since=${encodeURIComponent(since.toISOString())}` : ''}`,
  };
}

export function createPreviewStudentExperience(
  previewSessionId: string,
): StudentExperience {
  const routes = previewStudentRoutes();
  return {
    preview: true,
    routes,
    listEnrollments: async (courseId) => {
      if (!courseId) return [];
      const { course } = await getCourseTree(courseId);
      return [{
        courseId,
        name: course.name,
        courseCode: course.courseCode,
        term: course.term,
        active: true,
      }];
    },
    enroll: async (code, courseId) => {
      if (!courseId) throw new ApiError('No Preview course is selected.', 409);
      const { course } = await getCourseTree(courseId);
      if (course.registrationCode?.toUpperCase() !== code.trim().toUpperCase()) {
        throw new ApiError('That registration code does not match this Preview course.', 404);
      }
      return { courseId, name: course.name, courseCode: course.courseCode };
    },
    getHome: (courseId) => getPreviewCourseHome(courseId, previewSessionId),
    getNextQuestion: (courseId, input) =>
      getNextPreviewQuestion(courseId, previewSessionId, input),
    submit: (courseId, input) =>
      submitPreviewAttempt(courseId, previewSessionId, input),
    // Always TEST-queued. Preview exists to exercise the real flag loop end to
    // end, and the alternative — a flag written only to
    // `previewStudentSessions.flags`, which nothing reads and which the 24h TTL
    // discards — is indistinguishable from not flagging at all. The instructor
    // who wants that already has it by not opening this form. The API keeps its
    // optional parameter defaulting to false for the live student path; this is
    // the one caller that opts in, unconditionally (2026-08-08 Task 4).
    flag: async (courseId, questionId, reason) => {
      const result = await flagPreviewQuestion(
        courseId,
        previewSessionId,
        questionId,
        reason,
        true,
      );
      if (result.testQueued) {
        broadcastNotificationsChanged();
        broadcastFlagsChanged();
      }
      return result;
    },
    skip: (courseId, loId, attempted) =>
      skipPreviewLo(courseId, previewSessionId, loId, attempted),
    getSessionStart: (courseId) =>
      getPreviewSessionSummary(courseId, previewSessionId),
    endSession: (courseId, since) =>
      endPreviewSessionSummary(courseId, previewSessionId, since),
    getReviewBook: (courseId, sort) =>
      getPreviewReviewBook(courseId, previewSessionId, sort),
    bookmark: (courseId, questionId) =>
      bookmarkPreviewQuestion(courseId, previewSessionId, questionId),
    unbookmark: (courseId, questionId) =>
      unbookmarkPreviewQuestion(courseId, previewSessionId, questionId),
    removeReviewEntry: (courseId, entryId) =>
      removePreviewReviewBookEntry(courseId, previewSessionId, entryId),
    materialHref: (courseId, loId, materialId) =>
      `/api/courses/${encodeURIComponent(courseId)}/preview/los/${encodeURIComponent(loId)}/materials/${encodeURIComponent(materialId)}/source`,
  };
}
