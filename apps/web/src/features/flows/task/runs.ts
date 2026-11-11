import type { ReactNode } from 'react';
import type { TaskArtifact } from '../../../api/task-artifacts.ts';
import type { Loaded } from '../../../api/use-load.ts';
import type { RoundSpan, TaskConversation } from '../conversations/model.ts';

/**
 * What a task's page shows of its steps' runs (S5.3b), given by the page so the design gallery can draw the same view
 * on samples: the artifacts and their bytes, and the open conversation's thread (live on the page, a sample there).
 */
export interface TaskRuns {
  readonly artifacts: Loaded<readonly TaskArtifact[]>;
  /** An artifact's bytes: a thumbnail, the viewer, a download. */
  readonly bytes: (artifact: TaskArtifact) => Promise<Blob>;
  /** The conversation's thread with its composer, in its frame (`ThreadFrame`). */
  readonly thread: (conversation: TaskConversation, span: RoundSpan | undefined) => ReactNode;
}
