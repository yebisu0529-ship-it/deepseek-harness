import { useId, useLayoutEffect, useRef } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import { shallowEqual } from '@deepseek-ai/dsh-client-store'
import type { WorkflowRunPanelProps } from './WorkflowRunPanel.tsx'
import type { WorkflowRunChatData, WorkflowRunStatus } from './workflow-definition.ts'
import { navigableMembers } from './navigation.ts'
import css from './WorkflowBoard.module.css'

const STATUSES: readonly WorkflowRunStatus[] = ['running', 'completed', 'failed', 'cancelled', 'interrupted']

/** Only the navigation and live status inputs required by the board. */
export type WorkflowBoardInputs = Pick<WorkflowRunPanelProps,
  'sessionId' | 'useSessions' | 'useSessionStatus' | 'openSession' | 't'>

/**
 * Render started members by their durable status, without task controls or invented queue entries.
 * @param props - the run identity, current projected facts, and scoped navigation inputs.
 * @returns a read-only responsive board with completed/started progress.
 */
export function WorkflowBoard({ runId, data, sessionId, useSessions, useSessionStatus, openSession, t }:
  WorkflowBoardInputs & { readonly runId: string; readonly data: WorkflowRunChatData }) {
  const labelId = useId()
  const boardRef = useRef<HTMLElement>(null)
  const focusedMember = useRef<string | null>(null)
  const statuses = useSessionStatus(value => value)
  const navigable = useSessions(sessions => navigableMembers(sessions, data.phases, sessionId, statuses), shallowEqual)
  const members = data.phases.flatMap(phase => phase.members.map(member => ({ member, phase: phase.phase })))
  const completed = members.filter(({ member }) => member.status === 'completed').length
  useLayoutEffect(() => {
    const board = boardRef.current
    if (board === null || focusedMember.current === null || board.contains(board.ownerDocument.activeElement)) return
    const card = [...board.querySelectorAll<HTMLElement>('[data-board-member]')]
      .find(element => element.dataset.boardMember === focusedMember.current)
    if (card !== undefined) (card.querySelector<HTMLButtonElement>('button') ?? card).focus()
  }, [data, navigable])
  return (
    <section ref={boardRef} className={css.board} data-workflow-board={runId} aria-label={t('board.title')}
      onFocusCapture={event => {
        focusedMember.current = event.target.closest<HTMLElement>('[data-board-member]')?.dataset.boardMember ?? null
      }}
      onBlurCapture={event => {
        if (!event.currentTarget.contains(event.relatedTarget)) focusedMember.current = null
      }}>
      <div className={css.progress}>
        <span id={labelId}>{t('board.progress', { completed, total: members.length })}</span>
        <progress aria-labelledby={labelId} max={Math.max(1, members.length)} value={completed} />
      </div>
      {members.length === 0 && <p>{t('run.empty')}</p>}
      <div className={css.columns}>
        {STATUSES.map(status => {
          const column = members.filter(({ member }) => member.status === status)
          return (
            <section key={status} className={css.column} data-board-status={status} aria-label={t(`status.${status}`)}>
              <h3>{t(`status.${status}`)} <span>{column.length}</span></h3>
              {column.map(({ member, phase }) => (
                <article key={member.seq} className={css.card}
                  tabIndex={-1}
                  data-board-member={`${runId.length}:${runId}:${member.seq}`}>
                  <dl>
                    <dt>{t('board.assignee')}</dt>
                    <dd>{member.label === '' ? t('member.empty') : member.label}</dd>
                    <dt>{t('board.phase')}</dt>
                    <dd>{phase === null ? t('phase.unassigned') : phase === '' ? t('phase.empty') : phase}</dd>
                  </dl>
                  {navigable.includes(member.childId) && (
                    <Button size="sm" variant="ghost" className={css.link}
                      aria-label={t('member.open', { name: member.label === '' ? t('member.empty') : member.label })}
                      onClick={() => { openSession({ parentSessionId: sessionId, childSessionId: member.childId, mode: 'one-shot' }) }}>
                      {t('board.child')}
                    </Button>
                  )}
                </article>
              ))}
            </section>
          )
        })}
      </div>
    </section>
  )
}
