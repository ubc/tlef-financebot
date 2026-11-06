import type { Difficulty } from './domain';

/** Historical v2-pilot authoring intent; read-only on stored versions. */
export type AuthoringIntent = 'edit-existing' | 'create-variant' | 'create-independent-task';

/** Pedagogical task descriptor recorded on a question version. */
export interface PedagogicalTaskDescriptor {
  concepts: string[];
  requiredInference: string;
  solutionPath: string[];
  misconception: string;
  targetDifficulty: Difficulty;
  achievedDifficulty?: Difficulty;
  passageIds: string[];
  intent: AuthoringIntent;
}
