import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SessionStatusSnapshot } from '@deepseek-ai/dsh-client-ui-session/client'
import type { WorkflowRunPhaseData } from './workflow-definition.ts'

/**
 * Select running members whose running child is in the parent's direct-child catalog.
 * @param sessions - Session summaries and the parent's catalog.
 * @param phases - started members from the durable projection.
 * @param parentId - the current Session scope.
 * @param statuses - unified live child status, preferred over summaries.
 * @returns only child identities that the existing one-shot opener may receive.
 */
export function navigableMembers(
  sessions: SessionListState,
  phases: readonly WorkflowRunPhaseData[],
  parentId: SessionId,
  statuses: SessionStatusSnapshot,
): readonly SessionId[] {
  const catalog = sessions.projectionsBySession[parentId]
  const result: SessionId[] = []
  for (const phase of phases) {
    for (const member of phase.members) {
      const child = catalog?.values.subagentCatalog?.find(entry => entry.id === member.childId)
      if (member.status === 'running'
        && child !== undefined && (statuses.get(child.id)?.running ?? sessions.byId[child.id]?.running) === true) {
        result.push(member.childId)
      }
    }
  }
  return result
}
