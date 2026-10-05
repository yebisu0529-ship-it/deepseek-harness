import { defineStore } from '@deepseek-ai/dsh-client-store'

/**
 * Keep the selected run key per Session; workflow facts remain in the Chat projection.
 * @returns a handle shared by the in-chat card and the sidebar tab in the same Session scope.
 */
export function createWorkflowBoardStore() {
  return defineStore({
    init: (): { selectedKey: string | null } => ({ selectedKey: null }),
    persist: 'dsh:workflow-board',
    actions: {
      select: (draft, key: string) => { draft.selectedKey = key },
    },
  })
}
