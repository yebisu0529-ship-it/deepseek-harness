import { useSyncExternalStore } from 'react'
import { PluginArtworkSubagent } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { ChatNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { WorkflowRunInjected } from './WorkflowRunPanel.tsx'
import type { createWorkflowBoardStore } from './board-store.ts'
import { WorkflowBoard } from './WorkflowBoard.tsx'
import css from './WorkflowBoard.module.css'

/** Session-scoped sidebar board using the existing per-key Chat source. */
export type WorkflowBoardTabProps = PropsRuntime<'sidebar.right.pane.tab'> & PropsLocale<'workflowRun'>
  & PropsStore<ReturnType<typeof createWorkflowBoardStore>> & Pick<WorkflowRunInjected, 'openSession'>

const noSubscription = (): (() => void) => () => {}
const noNode = () => undefined

/**
 * Restore the selected run identity and subscribe to its live Chat projection.
 * @param props - the Session-scoped tab, selected identity, and existing navigation.
 * @returns the selected run board, or an empty state when its facts are not loaded.
 */
export function WorkflowBoardTab({ useStore, useChat, t, ...inputs }: WorkflowBoardTabProps) {
  const key = useStore(state => state.selectedKey)
  const source = useChat(snapshot => typeof key === 'string' ? snapshot.nodes.source(key) : undefined)
  const node = useSyncExternalStore(source?.subscribe ?? noSubscription, source?.getSnapshot ?? noNode)
  if (node?.kind !== 'workflow-run') return <p className={css.sidebar}>{t('board.unavailable')}</p>
  // Chat's keyed reader is untyped; this registered kind is owned by workflowRunDefinition.
  const workflow = node as ChatNode<'workflow-run'>
  return <div className={css.sidebar}>
    <h2>{workflow.data.name}</h2>
    <WorkflowBoard {...inputs} t={t} runId={workflow.id} data={workflow.data} />
  </div>
}

/**
 * Render the board tab's icon and localized title.
 * @param props - the localized copy seat.
 * @returns the standard member icon and board title.
 */
export function WorkflowBoardTabTitle({ t }: PropsLocale<'workflowRun'>) {
  return <><PluginArtworkSubagent size={16} />{t('board.title')}</>
}
