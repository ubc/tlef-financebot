jest.mock('../../server/src/config/env', () => ({ env: {
  llmDefaultModel: 'gpt-6-luna', llmModelGenerator: 'gpt-6-luna', llmModelReviewer: 'gpt-6-luna',
  llmModelMasteryEvaluator: 'gpt-6-luna', llmModelOutlineOrganizer: 'campus-env-model',
} }));
// Course instructors choose supported models per step (spec 2026-11-23-instructor-course-models-design.md).
const findPlatformSettings = jest.fn();
const findCourse = jest.fn();
const updateCourse = jest.fn();
const insertAudit = jest.fn();
jest.mock('../../server/src/components/mongodb/collections', () => ({
  auditCol: jest.fn(() => ({ insertOne: insertAudit })),
  coursesCol: jest.fn(() => ({ findOne: findCourse, updateOne: updateCourse })),
  capabilitySettingsCol: jest.fn(), platformInstructorGrantsCol: jest.fn(),
  platformSettingsCol: jest.fn(() => ({ findOne: findPlatformSettings })), usersCol: jest.fn(),
}));

import { ObjectId } from 'mongodb';
import {
  getInstructorCourseModels, getPlatformSettings, instructorSelectableModels, outlineOrganizerStepConfig, saveAdminCourseModels, saveInstructorCourseModels,
} from '../../server/src/services/admin.service';

const courseId = new ObjectId();
let course: { _id: ObjectId; llmModelSettings?: unknown };
beforeEach(() => {
  [findPlatformSettings, findCourse, updateCourse, insertAudit].forEach(mock => mock.mockReset());
  findPlatformSettings.mockResolvedValue({ _id: 'platform', models: {}, customModels: [{ id: 'campus-custom', profile: 'reasoning-fixed' }] });
  course = { _id: courseId };
  findCourse.mockImplementation(async () => course);
  updateCourse.mockImplementation(async (_filter, update) => { Object.assign(course, update.$set); return { matchedCount: 1 }; });
});

describe('instructor course model selection', () => {
  it('offers built-in models and environment defaults, never admin custom models', () => {
    const ids = instructorSelectableModels().map(model => model.id);
    expect(ids).toEqual(expect.arrayContaining(['gpt-5.4-nano', 'gpt-5.6-luna', 'gpt-6-luna', 'gpt-6.1-sol', 'campus-env-model']));
    expect(ids).not.toContain('campus-custom');
    expect(new Set(ids).size).toBe(ids.length);
    expect(instructorSelectableModels().find(model => model.id === 'gpt-6.1-sol')!.profile).toBe('reasoning-required');
  });
  it('lets an instructor set every step, including the outline organizer, and audits the scope', async () => {
    const view = await saveInstructorCourseModels(courseId, 0, { generator: 'gpt-6.1-sol', outlineOrganizer: 'gpt-6.1-sol', masteryEvaluator: 'gpt-6-luna' }, 'PROF');
    expect(view).toMatchObject({ revision: 1, overrides: { generator: 'gpt-6.1-sol', outlineOrganizer: 'gpt-6.1-sol', masteryEvaluator: 'gpt-6-luna' } });
    expect(view).not.toHaveProperty('availableModels');
    expect(view.selectableModels.map(model => model.id)).not.toContain('campus-custom');
    await expect(outlineOrganizerStepConfig(courseId)).resolves.toMatchObject({ model: 'gpt-6.1-sol' });
    expect((await getPlatformSettings(courseId)).models.generator.model).toBe('gpt-6.1-sol');
    expect(insertAudit).toHaveBeenCalledWith(expect.objectContaining({ actorPuid: 'PROF', action: 'course-models.update', detail: expect.objectContaining({ scope: 'instructor' }) }));
  });
  it('rejects a custom or unknown model from an instructor but not from an admin', async () => {
    await expect(saveInstructorCourseModels(courseId, 0, { generator: 'campus-custom' }, 'PROF')).rejects.toThrow('invalid-model-selector');
    await expect(saveInstructorCourseModels(courseId, 0, { generator: 'my-own-model' }, 'PROF')).rejects.toThrow('invalid-model-selector');
    expect(updateCourse).not.toHaveBeenCalled();
    await expect(saveAdminCourseModels(courseId, 0, { generator: 'campus-custom' }, 'ADMIN')).resolves.toMatchObject({ overrides: { generator: 'campus-custom' } });
  });
  it('keeps an unchanged admin-assigned custom model when an instructor saves other steps', async () => {
    await saveAdminCourseModels(courseId, 0, { generator: 'campus-custom' }, 'ADMIN');
    const view = await saveInstructorCourseModels(courseId, 1, { generator: 'campus-custom', reviewer: 'gpt-5.6-luna' }, 'PROF');
    expect(view.overrides).toEqual({ generator: 'campus-custom', reviewer: 'gpt-5.6-luna' });
    expect((await getPlatformSettings(courseId)).models.generator).toMatchObject({ model: 'campus-custom', capabilityProfile: 'reasoning-fixed' });
  });
  it('returns a step to the platform default when its choice is cleared, and enforces the revision', async () => {
    await saveInstructorCourseModels(courseId, 0, { reviewer: 'gpt-5.6-luna' }, 'PROF');
    await expect(saveInstructorCourseModels(courseId, 0, {}, 'PROF')).rejects.toThrow('course-models-conflict');
    const cleared = await saveInstructorCourseModels(courseId, 1, {}, 'PROF');
    expect(cleared).toMatchObject({ revision: 2, overrides: {} });
    const view = await getInstructorCourseModels(courseId);
    expect(view.effectiveModels.reviewer.model).toBe('gpt-6-luna');
    expect(view.platformModels.outlineOrganizer.model).toBe('campus-env-model');
  });
});
