// @vitest-environment jsdom
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { GlobalStandardProps } from '@deepseek-ai/dsh-client-ui-slots'
import { Context } from '@deepseek-ai/cordis'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ConversationNodeAssembler, UiConversation,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {
  ConversationMatch, ConversationNodeDefinition, ConversationStartMatch,
  ConversationViewDefinition,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ChatConversationViewNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {
  SessionListState, SessionLiveEventEntry,
} from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session/types'
import { apply as applyLocale, inject as localeInject } from '@deepseek-ai/dsh-client-locale/client'
import {
  chatSnapshot as emptyChatSnapshot, conversationSnapshot, makeTranslate, sessionSnapshot,
  stubConfigForm, TestSessions, workspaceSnapshot,
} from '@deepseek-ai/dsh-client-test-runtime'
import {
  WorkflowRunPanel, type WorkflowRunInjected, type WorkflowRunPanelProps,
} from '../src/client/WorkflowRunPanel.tsx'
import { apply, inject } from '../src/client/index.ts'
import { zh } from '../src/client/locales.ts'
import {
  workflowRunDefinition, type WorkflowRunChatData,
} from '../src/client/workflow-definition.ts'
import { apply as applyNode } from '../src/index.ts'
import type {} from '../src/client/index.ts'
import { WorkflowBoard } from '../src/client/WorkflowBoard.tsx'
import { WorkflowBoardTab, type WorkflowBoardTabProps } from '../src/client/WorkflowBoardTab.tsx'
import { createWorkflowBoardStore } from '../src/client/board-store.ts'
import { en } from '../src/client/locales.ts'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import { SidebarRightTabRegistry } from '../../ui-sidebar-right/src/client/tab-registry.ts'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

// Every session-scope fixture carries the resource hook the resources plugin merges into GlobalStandardProps.
const useResource = (() => ({ status: 'none' as const, value: undefined, failure: undefined, reload: () => {} })) as GlobalStandardProps['useResource']
const usePanelInfo: GlobalStandardProps['usePanelInfo'] = selector => selector({ activePanelId: null })

afterEach(cleanup)


const PARENT_ID = 'parent' as SessionId
const CHILD_ID = 'child-1' as SessionId
const SECOND_ID = 'child-2' as SessionId

type TrajectoryState = Parameters<Parameters<WorkflowRunPanelProps['useTrajectory']>[0]>[0]

const panelSession = sessionSnapshot(PARENT_ID)
const panelAttention = new Map<SessionId, never>()
const panelWorkspace = workspaceSnapshot()
const panelConversation = conversationSnapshot()
const panelChat = emptyChatSnapshot()
const panelTrajectory: TrajectoryState = {
  eventNodes: [],
  eventLocations: new Map(),
  requests: [],
  callSchemas: new Map(),
  partial: null,
  runningCalls: [],
}

interface ChatSnapshot {
  readonly nodes: ReadonlyMap<string, ChatConversationViewNode>
}

class TestEventDefinitions {
  entries(): readonly ConversationNodeDefinition[] { return [workflowRunDefinition] }
  fallbackEntry(): undefined { return undefined }
}

class TestViewDefinitions {
  entries(): readonly ConversationViewDefinition[] { return [chatViewDefinition] }
}

const chatViewDefinition: ConversationViewDefinition<ChatConversationViewNode, ChatSnapshot> = {
  target: 'chat',
  create: () => {
    let nodes = new Map<string, ChatConversationViewNode>()
    const snapshot = (): ChatSnapshot => ({ nodes })
    return {
      empty: snapshot(),
      replace: ({ nodes: values }) => {
        nodes = new Map(values.map(node => [node.key, node]))
        return snapshot()
      },
      apply: ({ upserts }) => {
        nodes = new Map(nodes)
        for (const node of upserts) nodes.set(node.key, node)
        return snapshot()
      },
    }
  },
}

function at(seq: number, type: string, data: unknown): SessionLiveEventEntry {
  return { type: 'event', event: { seq, time: seq * 100, type, data } as SessionEvent }
}

function matched(input: SessionLiveEventEntry, role: 'start'): ConversationStartMatch
function matched(input: SessionLiveEventEntry, role: 'update'): ConversationMatch
function matched(input: SessionLiveEventEntry, role: ConversationMatch['role']): ConversationMatch {
  return { event: input.event, role, location: { kind: 'unresolved' } }
}

function assembler(entries: readonly SessionLiveEventEntry[], hasMore = false): ConversationNodeAssembler {
  const value = new ConversationNodeAssembler(new TestEventDefinitions(), new TestViewDefinitions())
  value.replaceWindow(entries, hasMore)
  value.activateTarget('chat')
  return value
}

function workflowData(value: ConversationNodeAssembler): WorkflowRunChatData | undefined {
  const snapshot = value.snapshot('chat') as ChatSnapshot
  return [...snapshot.nodes.values()][0]?.data as WorkflowRunChatData | undefined
}

function completeEvents(): SessionLiveEventEntry[] {
  return [
    at(1, 'turn/start', { turn: 1 }),
    at(2, 'step/start', { turn: 1, step: 1 }),
    at(3, 'tool-workflow/run-start', { runId: 'run-1', name: 'audit' }),
    at(4, 'tool-workflow/agent-start', {
      runId: 'run-1', seq: 1, label: 'first', phase: '', childId: 'child-1',
    }),
    at(5, 'tool-workflow/agent-start', {
      runId: 'run-1', seq: 2, label: 'second', childId: 'child-2',
    }),
    at(6, 'tool-workflow/agent-end', { runId: 'run-1', seq: 1, outcome: 'completed' }),
    at(7, 'tool-workflow/agent-end', { runId: 'run-1', seq: 2, outcome: 'failed' }),
    at(8, 'tool-workflow/run-end', { runId: 'run-1', stopReason: 'error' }),
    at(9, 'step/end', { turn: 1, step: 1 }),
    at(10, 'turn/end', { turn: 1, reason: { kind: 'completed' } }),
  ]
}

describe('workflow-run Conversation Definition', () => {
  it('groups exact phase identities in first-member order and preserves terminal members', () => {
    const value = assembler(completeEvents())
    const data = workflowData(value)
    expect(data).toEqual({
      name: 'audit',
      status: 'failed',
      phases: [
        {
          key: 'value:0:', phase: '',
          members: [{ seq: 1, label: 'first', childId: 'child-1', status: 'completed' }],
        },
        {
          key: 'missing', phase: null,
          members: [{ seq: 2, label: 'second', childId: 'child-2', status: 'failed' }],
        },
      ],
    })
    const node = [...(value.snapshot('chat') as ChatSnapshot).nodes.values()][0]!
    expect(node.anchorSeq).toBe(3)
    expect(node.kind).toBe('workflow-run')
  })

  it('keeps an update-only tail pending until prepend supplies the unique start', () => {
    const tail = completeEvents().slice(3)
    const value = assembler(tail, true)
    expect(workflowData(value)).toBeUndefined()
    value.prepend(completeEvents().slice(0, 3), false)
    value.flush()
    expect(workflowData(value)).toEqual(workflowData(assembler(completeEvents())))
  })

  it('produces the same final data through live append as complete replay', () => {
    const events = completeEvents()
    const value = assembler(events.slice(0, 3))
    for (const event of events.slice(3)) value.append(event)
    value.flush()
    expect(workflowData(value)).toEqual(workflowData(assembler(events)))
  })

  it('shows missing terminal facts as interrupted only after the owning Location closes', () => {
    const value = assembler([
      at(1, 'turn/start', { turn: 1 }),
      at(2, 'step/start', { turn: 1, step: 1 }),
      at(3, 'tool-workflow/run-start', { runId: 'run-1', name: 'audit' }),
      at(4, 'tool-workflow/agent-start', {
        runId: 'run-1', seq: 1, label: 'worker', childId: 'child-1',
      }),
    ])
    expect(workflowData(value)?.status).toBe('running')
    value.append(at(5, 'step/end', { turn: 1, step: 1 }))
    value.flush()
    expect(workflowData(value)).toMatchObject({
      status: 'interrupted',
      phases: [{ members: [{ status: 'interrupted' }] }],
    })
  })

  it('retains a zero-member run as its own completed node', () => {
    const value = assembler([
      at(1, 'turn/start', { turn: 1 }),
      at(2, 'step/start', { turn: 1, step: 1 }),
      at(3, 'tool-workflow/run-start', { runId: 'empty', name: 'empty' }),
      at(4, 'tool-workflow/run-end', { runId: 'empty', stopReason: 'completed' }),
    ])
    expect(workflowData(value)).toEqual({
      name: 'empty', status: 'completed', phases: [],
    })
  })

  it('folds same-phase cancellation and a turn-level interruption', () => {
    const cancelled = assembler([
      at(1, 'turn/start', { turn: 1 }),
      at(2, 'tool-workflow/run-start', { runId: 'cancelled', name: 'cancelled' }),
      at(3, 'tool-workflow/agent-start', {
        runId: 'cancelled', seq: 1, label: 'one', phase: 'Research', childId: 'child-1',
      }),
      at(4, 'tool-workflow/agent-start', {
        runId: 'cancelled', seq: 2, label: 'two', phase: 'Research', childId: 'child-2',
      }),
      at(5, 'tool-workflow/agent-end', { runId: 'cancelled', seq: 1, outcome: 'cancelled' }),
      at(6, 'tool-workflow/agent-end', { runId: 'cancelled', seq: 2, outcome: 'completed' }),
      at(7, 'tool-workflow/run-end', { runId: 'cancelled', stopReason: 'cancelled' }),
    ])
    expect(workflowData(cancelled)).toMatchObject({
      status: 'cancelled',
      phases: [{ phase: 'Research', members: [{ status: 'cancelled' }, { status: 'completed' }] }],
    })

    const interruptedTurn = assembler([
      at(1, 'turn/start', { turn: 1 }),
      at(2, 'tool-workflow/run-start', { runId: 'turn', name: 'turn' }),
      at(3, 'tool-workflow/agent-start', {
        runId: 'turn', seq: 1, label: 'open', childId: 'child-1',
      }),
      at(4, 'turn/end', { turn: 1, reason: { kind: 'completed' } }),
    ])
    expect(workflowData(interruptedTurn)?.status).toBe('interrupted')
  })

  it('handles session/unresolved placement and defensive Definition calls', () => {
    const sessionLevel = assembler([
      at(1, 'tool-workflow/run-start', { runId: 'session', name: 'session' }),
      at(2, 'tool-workflow/agent-start', {
        runId: 'session', seq: 1, label: 'open', childId: 'child-1',
      }),
    ])
    expect(workflowData(sessionLevel)?.status).toBe('running')

    const invalidStart = matched(at(1, 'tool-workflow/agent-start', {
      runId: 'direct', seq: 1, label: 'member', childId: 'child-1',
    }), 'start')
    const emptyContext: Parameters<typeof workflowRunDefinition.start>[0] = {
      key: 'workflow-run:direct', kind: 'workflow-run', id: 'direct',
      matches: [invalidStart], start: invalidStart, state: undefined, current: new Map(),
    }
    const reader: Parameters<typeof workflowRunDefinition.start>[2] = { previous: () => undefined }
    expect(() => workflowRunDefinition.start(emptyContext, invalidStart, reader))
      .toThrow('workflow-run start requires tool-workflow/run-start')

    const start = matched(at(2, 'tool-workflow/run-start', { runId: 'direct', name: 'direct' }), 'start')
    const startedContext = { ...emptyContext, matches: [start], start }
    const state = workflowRunDefinition.start(startedContext, start, reader)
    const updateContext: Parameters<typeof workflowRunDefinition.update>[0] = { ...startedContext, state }
    const unrelated = matched(at(3, 'turn/start', { turn: 1 }), 'update')
    expect(workflowRunDefinition.update(updateContext, unrelated)).toBe(state)
    expect(workflowRunDefinition.target).toBe('chat')
    expect(workflowRunDefinition.buildViewNode?.({
      ...updateContext, matches: [], start: undefined,
    })).toBeNull()
    const directNode = workflowRunDefinition.buildViewNode?.(updateContext) as ChatConversationViewNode | null | undefined
    if (directNode === null) throw new Error('expected direct workflow Chat node')
    if (directNode === undefined) throw new Error('expected workflow Chat view builder')
    expect(directNode.kind).toBe('workflow-run')
    expect((directNode.data as WorkflowRunChatData).status).toBe('running')
  })
})

function node(data: WorkflowRunChatData): WorkflowRunPanelProps['node'] {
  return {
    key: '12:workflow-runrun-1',
    kind: 'workflow-run',
    id: 'run-1',
    target: 'chat',
    anchorSeq: 3,
    location: { kind: 'unresolved' },
    visibility: 'visible',
    data,
  }
}

const phase = (overrides: Partial<WorkflowRunChatData['phases'][number]> = {}): WorkflowRunChatData['phases'][number] => ({
  key: 'missing',
  phase: null,
  members: [{ seq: 1, label: 'worker', childId: 'child-1' as SessionId, status: 'running' }],
  ...overrides,
})

const listState = (overrides: Partial<SessionListState> = {}): SessionListState => ({
  ids: [PARENT_ID, CHILD_ID],
  byId: {
    [PARENT_ID]: {
      id: PARENT_ID, displayTitle: 'parent', running: true, retainedBy: {}, blank: false, updatedAt: 0,
    },
    [CHILD_ID]: {
      id: CHILD_ID, displayTitle: 'child', parentId: PARENT_ID, origin: 'subagent',
      running: true, retainedBy: {}, blank: false, updatedAt: 0,
    },
  },
  phase: 'ready',
  projectionsBySession: { [PARENT_ID]: { state: 'ready', error: null, values: { subagentCatalog: [
    { createdAt: 1, id: CHILD_ID, mode: 'one-shot' },
  ] } } },
  ...overrides,
})

function panelProps(data: WorkflowRunChatData, sessions = listState(), openSession = vi.fn()): WorkflowRunPanelProps {
  return {
    node: node(data),
    sessionId: PARENT_ID,
    useSessions: selector => selector(sessions),
    usePanelInfo, useResource,
    useSessionStatus: selector => selector(panelAttention),
    useSessionRetainInfo: () => undefined,
    useSession: selector => selector(panelSession),
    useProjection: () => undefined,
    useConversation: selector => selector(panelConversation),
    useChat: selector => selector(panelChat),
    useTrajectory: selector => selector(panelTrajectory),
    useInput: () => { throw new Error('unused') },
    inputActions: {
      captureInsertion: () => ({ start: 0, end: 0, draftRev: 0 }),
      insertText: () => false,
      setDraft: () => {},
      addAttachments: () => false,
      removeAttachment: () => {},
      pruneAttachments: () => {},
      submit: () => {},
    },
    useWorkspaces: selector => selector(panelWorkspace),
    useTurnData: () => undefined,
    useDisclosure: () => { throw new Error('unused') },
    openSkill: vi.fn(),
    openFile: () => {},
    inspectCall: () => {},
    forkAt: () => {},
    loadImage: () => Promise.reject(new Error('not used')),
    renderMessageImages: () => null,
    fileMentions: () => undefined,
    openSession,
    openBoard: vi.fn(),
    useStore: selector => selector({ selectedKey: null }),
    actions: { select: vi.fn() },
    t: makeTranslate(zh),
  }
}

describe('WorkflowRunPanel', () => {
  it('keeps live run and phase controls manual across ordinary updates and outer hiding', () => {
    const running: WorkflowRunChatData = {
      name: 'audit', status: 'running', phases: [phase({ key: 'research', phase: 'Research' })],
    }
    const view = render(<WorkflowRunPanel {...panelProps(running)} />)
    const runHeader = screen.getByRole('button', { name: /^audit/ })
    const phaseHeader = screen.getByRole('button', { name: /Research/ })
    expect(runHeader.getAttribute('aria-expanded')).toBe('true')
    expect(phaseHeader.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByText('worker')).toBeTruthy()

    fireEvent.click(phaseHeader)
    expect(phaseHeader.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByText('worker')).toBeNull()
    fireEvent.click(runHeader)
    expect(runHeader.getAttribute('aria-expanded')).toBe('false')

    view.rerender(<WorkflowRunPanel {...panelProps({
      ...running,
      phases: [phase({
        key: 'research', phase: 'Research',
        members: [
          { seq: 1, label: 'worker', childId: CHILD_ID, status: 'running' },
          { seq: 2, label: 'second', childId: 'child-2' as SessionId, status: 'running' },
        ],
      })],
    })} />)
    expect(runHeader.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('button', { name: /Research/ })).toBeNull()
    fireEvent.keyDown(runHeader, { key: 'ArrowDown' })
    expect(runHeader.getAttribute('aria-expanded')).toBe('false')
    fireEvent.keyDown(runHeader, { key: ' ' })
    const updatedPhase = screen.getByRole('button', { name: /Research/ })
    expect(updatedPhase.getAttribute('aria-expanded')).toBe('false')
    expect(screen.getByText('运行中 2')).toBeTruthy()
    fireEvent.keyDown(updatedPhase, { key: 'Enter' })
    expect(screen.getByText('worker')).toBeTruthy()
    expect(screen.getByText('second')).toBeTruthy()

    fireEvent.click(runHeader)
    expect(runHeader.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('button', { name: /Research/ })).toBeNull()
    fireEvent.keyDown(runHeader, { key: ' ' })
    expect(screen.getByRole('button', { name: /Research/ }).getAttribute('aria-expanded')).toBe('true')
  })

  it('folds each normal completion once and opens a new same-key activity cycle', () => {
    const running: WorkflowRunChatData = {
      name: 'audit', status: 'running', phases: [phase()],
    }
    const view = render(<WorkflowRunPanel {...panelProps(running)} />)
    const runningPhase = screen.getByRole('button', { name: /未分阶段/ })
    fireEvent.click(runningPhase)
    fireEvent.keyDown(runningPhase, { key: 'Enter' })
    expect(screen.getByText('worker')).toBeTruthy()

    const phaseCompleted: WorkflowRunChatData = {
      ...running,
      phases: [phase({
        members: [{
          seq: 1, label: 'done', childId: 'child-1' as SessionId, status: 'completed',
        }],
      })],
    }
    view.rerender(<WorkflowRunPanel {...panelProps(phaseCompleted)} />)
    const phaseHeader = screen.getByRole('button', { name: /未分阶段/ })
    expect(phaseHeader.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByText('done')).toBeNull()
    fireEvent.click(phaseHeader)
    expect(screen.getByText('done')).toBeTruthy()

    const cleanUpdate: WorkflowRunChatData = {
      ...phaseCompleted,
      phases: [phase({
        members: [{
          seq: 1, label: 'reviewed', childId: 'child-1' as SessionId, status: 'completed',
        }],
      })],
    }
    view.rerender(<WorkflowRunPanel {...panelProps(cleanUpdate)} />)
    expect(screen.getByText('reviewed')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /未分阶段/ }))
    const runHeader = screen.getByRole('button', { name: /^audit/ })
    fireEvent.click(runHeader)
    const renewed: WorkflowRunChatData = {
      name: 'audit', status: 'running',
      phases: [phase({
        members: [
          { seq: 1, label: 'reviewed', childId: CHILD_ID, status: 'completed' },
          { seq: 2, label: 'new', childId: 'child-2' as SessionId, status: 'running' },
        ],
      })],
    }
    view.rerender(<WorkflowRunPanel {...panelProps(renewed)} />)
    expect(screen.getByRole('button', { name: /^audit/ }).getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByRole('button', { name: /未分阶段/ }).getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByText('new')).toBeTruthy()

    const renewedPhaseCompleted: WorkflowRunChatData = {
      ...renewed,
      phases: [phase({
        members: [
          { seq: 1, label: 'reviewed', childId: CHILD_ID, status: 'completed' },
          { seq: 2, label: 'new', childId: 'child-2' as SessionId, status: 'completed' },
        ],
      })],
    }
    view.rerender(<WorkflowRunPanel {...panelProps(renewedPhaseCompleted)} />)
    expect(screen.getByRole('button', { name: /^audit/ }).getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByRole('button', { name: /未分阶段/ }).getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(screen.getByRole('button', { name: /未分阶段/ }))

    view.rerender(<WorkflowRunPanel {...panelProps({
      ...renewedPhaseCompleted,
      status: 'completed',
    })} />)
    expect(screen.getByRole('button', { name: /^audit/ }).getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(screen.getByRole('button', { name: /^audit/ }))
    expect(screen.getByRole('button', { name: /未分阶段/ }).getAttribute('aria-expanded')).toBe('true')
  })

  it('refolds a phase when a complete activity cycle arrives as one clean update', () => {
    const firstMember = {
      seq: 1, label: 'first', childId: 'child-1' as SessionId, status: 'completed' as const,
    }
    const phaseClean: WorkflowRunChatData = {
      name: 'phase-cycle', status: 'running',
      phases: [phase({ members: [firstMember] })],
    }
    const phaseView = render(<WorkflowRunPanel {...panelProps(phaseClean)} />)
    fireEvent.click(screen.getByRole('button', { name: /未分阶段/ }))
    expect(screen.getByText('first')).toBeTruthy()
    const runHeader = screen.getByRole('button', { name: /^phase-cycle/ })
    fireEvent.click(runHeader)
    expect(runHeader.getAttribute('aria-expanded')).toBe('false')
    phaseView.rerender(<WorkflowRunPanel {...panelProps({
      ...phaseClean,
      phases: [phase({ members: [firstMember, {
        seq: 2, label: 'second', childId: 'child-2' as SessionId, status: 'completed',
      }] })],
    })} />)
    expect(runHeader.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByRole('button', { name: /未分阶段/ }).getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByText('first')).toBeNull()
    expect(screen.queryByText('second')).toBeNull()

    phaseView.rerender(<WorkflowRunPanel {...panelProps({
      ...phaseClean,
      status: 'completed',
      phases: [phase({ members: [firstMember, {
        seq: 2, label: 'second', childId: SECOND_ID, status: 'completed',
      }, {
        seq: 3, label: 'final', childId: 'child-3' as SessionId, status: 'completed',
      }] })],
    })} />)
    expect(runHeader.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('button', { name: /未分阶段/ })).toBeNull()
  })

  it('initializes a newly observed phase before it becomes interactive', () => {
    const running: WorkflowRunChatData = {
      name: 'dynamic-phase', status: 'running',
      phases: [phase({ key: 'research', phase: 'Research' })],
    }
    const view = render(<WorkflowRunPanel {...panelProps(running)} />)
    view.rerender(<WorkflowRunPanel {...panelProps({
      ...running,
      phases: [
        ...running.phases,
        phase({
          key: 'build', phase: 'Build',
          members: [{ seq: 2, label: 'builder', childId: SECOND_ID, status: 'running' }],
        }),
      ],
    })} />)
    const build = screen.getByRole('button', { name: /Build/ })
    expect(build.getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(build)
    expect(build.getAttribute('aria-expanded')).toBe('false')
  })

  it('derives the zero-member running and completed states from the current run status', () => {
    const running: WorkflowRunChatData = { name: 'empty', status: 'running', phases: [] }
    const view = render(<WorkflowRunPanel {...panelProps(running)} />)
    expect(screen.getByRole('button', { name: /^empty/ }).getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByText('没有启动成员')).toBeTruthy()
    view.rerender(<WorkflowRunPanel {...panelProps({ ...running, status: 'completed' })} />)
    const header = screen.getByRole('button', { name: /^empty/ })
    expect(header.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByText('没有启动成员')).toBeNull()
    fireEvent.click(header)
    expect(screen.getByText('没有启动成员')).toBeTruthy()
  })

  it.each(['failed', 'cancelled', 'interrupted'] as const)(
    'initializes %s attention as an expanded disclosure that remains manually collapsible',
    (status) => {
      render(<WorkflowRunPanel {...panelProps({
        name: 'member-outcome', status,
        phases: [phase({
          members: [{ seq: 1, label: status, childId: CHILD_ID, status }],
        })],
      })} />)
      const runHeader = screen.getByRole('button', { name: /^member-outcome/ })
      const phaseHeader = screen.getByRole('button', { name: /未分阶段/ })
      expect(runHeader.getAttribute('aria-expanded')).toBe('true')
      expect(phaseHeader.getAttribute('aria-expanded')).toBe('true')
      expect(screen.getByText(status)).toBeTruthy()
      fireEvent.click(phaseHeader)
      fireEvent.click(runHeader)
      expect(runHeader.getAttribute('aria-expanded')).toBe('false')
    },
  )

  it('opens the first abnormal edge once and preserves later abnormal choices', () => {
    const running: WorkflowRunChatData = {
      name: 'audit', status: 'running', phases: [phase()],
    }
    const view = render(<WorkflowRunPanel {...panelProps(running)} />)
    fireEvent.click(screen.getByRole('button', { name: /未分阶段/ }))
    fireEvent.click(screen.getByRole('button', { name: /^audit/ }))

    const failed: WorkflowRunChatData = {
      name: 'audit', status: 'running',
      phases: [phase({
        members: [{ seq: 1, label: 'failed', childId: CHILD_ID, status: 'failed' }],
      })],
    }
    view.rerender(<WorkflowRunPanel {...panelProps(failed)} />)
    expect(screen.getByRole('button', { name: /^audit/ }).getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByRole('button', { name: /未分阶段/ }).getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: /未分阶段/ }))
    fireEvent.click(screen.getByRole('button', { name: /^audit/ }))

    view.rerender(<WorkflowRunPanel {...panelProps({
      ...failed,
      phases: [phase({
        members: [
          { seq: 1, label: 'failed', childId: CHILD_ID, status: 'failed' },
          { seq: 2, label: 'cancelled', childId: 'child-2' as SessionId, status: 'cancelled' },
        ],
      })],
    })} />)
    expect(screen.getByRole('button', { name: /^audit/ }).getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(screen.getByRole('button', { name: /^audit/ }))
    expect(screen.getByRole('button', { name: /未分阶段/ }).getAttribute('aria-expanded')).toBe('false')
    expect(screen.getByText('失败 1 · 已取消 1')).toBeTruthy()
  })

  it('keeps clean sibling phases independent and preserves empty versus absent names', () => {
    render(<WorkflowRunPanel {...panelProps({
      name: 'audit', status: 'completed',
      phases: [
        phase({ key: 'value:0:', phase: '', members: [{
          seq: 1, label: '', childId: 'child-1' as SessionId, status: 'completed',
        }] }),
        phase({ key: 'missing', phase: null, members: [{
          seq: 2, label: 'second', childId: 'child-2' as SessionId, status: 'running',
        }] }),
      ],
    })} />)
    const runHeader = screen.getByRole('button', { name: /^audit/ })
    expect(runHeader.getAttribute('aria-expanded')).toBe('true')
    const cleanPhase = screen.getByRole('button', { name: /空阶段名/ })
    expect(cleanPhase.getAttribute('aria-expanded')).toBe('false')
    const activePhase = screen.getByRole('button', { name: /未分阶段/ })
    expect(activePhase.getAttribute('aria-expanded')).toBe('true')
    expect(screen.queryByText('空成员名')).toBeNull()
    expect(screen.getByText('second')).toBeTruthy()
    fireEvent.click(cleanPhase)
    expect(screen.getByText('空成员名')).toBeTruthy()
    expect(screen.getByText('second')).toBeTruthy()
    fireEvent.click(activePhase)
    expect(screen.queryByText('second')).toBeNull()
    expect(screen.getByText('空成员名')).toBeTruthy()
    fireEvent.click(runHeader)
    fireEvent.click(runHeader)
    expect(screen.getByRole('button', { name: /空阶段名/ }).getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByRole('button', { name: /未分阶段/ }).getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(screen.getByRole('button', { name: /空阶段名/ }))
    expect(screen.queryByText('空成员名')).toBeNull()
  })

  it('renders mixed and interrupted aggregate status while attention stays visible', () => {
    const mixed: WorkflowRunChatData = {
      name: 'repo-audit', status: 'failed',
      phases: [phase({
        members: [
          { seq: 1, label: 'failed', childId: 'child-1' as SessionId, status: 'failed' },
          { seq: 2, label: 'cancelled', childId: 'child-2' as SessionId, status: 'cancelled' },
        ],
      })],
    }
    const mixedView = render(<WorkflowRunPanel {...panelProps(mixed)} />)
    expect(screen.getByText('失败 1 · 已取消 1')).toBeTruthy()
    expect([...mixedView.container.querySelectorAll('[data-member-status]')]
      .map(row => row.getAttribute('data-member-status'))).toEqual(['failed', 'cancelled'])
    expect(mixedView.container.querySelectorAll('[data-state="error"]')).toHaveLength(2)
    expect(mixedView.container.querySelectorAll('[data-state="warning"]')).toHaveLength(1)
    mixedView.unmount()

    const interruptedView = render(<WorkflowRunPanel {...panelProps({
      name: 'repo-audit', status: 'interrupted',
      phases: [phase({
        members: [
          { seq: 1, label: 'done', childId: 'child-1' as SessionId, status: 'completed' },
          { seq: 2, label: 'interrupted', childId: 'child-2' as SessionId, status: 'interrupted' },
        ],
      })],
    })} />)
    expect(screen.getByText('已完成 1 · 已中断 1')).toBeTruthy()
    expect(interruptedView.container.querySelector('[data-run-status="interrupted"]')).toBeTruthy()
    expect(interruptedView.container.querySelectorAll('[data-state="warning"]')).toHaveLength(2)
  })

  it('defers normal completion collapse until focused member content loses focus', () => {
    const sessions = listState({
      ids: [PARENT_ID, CHILD_ID, SECOND_ID],
      projectionsBySession: { [PARENT_ID]: { state: 'ready', error: null, values: { subagentCatalog: [
        { createdAt: 1, id: CHILD_ID, mode: 'one-shot' },
        { createdAt: 1, id: SECOND_ID, mode: 'one-shot' },
      ] } } },
      byId: {
        ...listState().byId,
        [SECOND_ID]: {
          id: SECOND_ID, displayTitle: 'second', parentId: PARENT_ID, origin: 'subagent',
          running: true, blank: false, updatedAt: 0,
        },
      },
    })
    const running: WorkflowRunChatData = {
      name: 'audit', status: 'running', phases: [phase({
        members: [
          { seq: 1, label: 'worker', childId: CHILD_ID, status: 'running' },
          { seq: 2, label: 'second', childId: SECOND_ID, status: 'running' },
        ],
      })],
    }
    const view = render(<WorkflowRunPanel {...panelProps(running, sessions)} />)
    const member = screen.getByRole('button', { name: '打开 worker' })
    const second = screen.getByRole('button', { name: '打开 second' })
    const runHeader = screen.getByRole('button', { name: /^audit/ })
    const phaseHeader = screen.getByRole('button', { name: /未分阶段/ })
    member.focus()
    expect(document.activeElement).toBe(member)
    fireEvent.blur(member, { relatedTarget: second })
    second.focus()
    expect(runHeader.getAttribute('aria-expanded')).toBe('true')
    expect(phaseHeader.getAttribute('aria-expanded')).toBe('true')

    const outside = document.createElement('button')
    document.body.append(outside)
    fireEvent.blur(second, { relatedTarget: outside })
    outside.focus()
    expect(runHeader.getAttribute('aria-expanded')).toBe('true')
    expect(phaseHeader.getAttribute('aria-expanded')).toBe('true')
    member.focus()

    view.rerender(<WorkflowRunPanel {...panelProps({
      name: 'audit', status: 'completed',
      phases: [phase({
        members: [
          { seq: 1, label: 'worker', childId: CHILD_ID, status: 'completed' },
          { seq: 2, label: 'second', childId: SECOND_ID, status: 'completed' },
        ],
      })],
    }, sessions)} />)
    expect(runHeader.getAttribute('aria-expanded')).toBe('true')
    expect(phaseHeader.getAttribute('aria-expanded')).toBe('true')
    const retained = screen.getByRole('button', { name: 'worker' })
    expect(retained.getAttribute('aria-disabled')).toBe('true')
    expect(document.activeElement).toBe(retained)

    fireEvent.blur(retained, { relatedTarget: outside })
    outside.focus()
    expect(document.activeElement).toBe(outside)
    expect(runHeader.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(runHeader)
    const completedPhase = screen.getByRole('button', { name: /未分阶段/ })
    expect(completedPhase.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(completedPhase)
    expect(screen.queryByRole('button', { name: '打开 worker' })).toBeNull()
    expect(screen.getByText('worker')).toBeTruthy()
    outside.remove()
  })

  it('handles a pointer blur and header click as one pending-completion close', () => {
    const running: WorkflowRunChatData = {
      name: 'audit', status: 'running', phases: [phase()],
    }
    const view = render(<WorkflowRunPanel {...panelProps(running)} />)
    const member = screen.getByRole('button', { name: '打开 worker' })
    member.focus()
    view.rerender(<WorkflowRunPanel {...panelProps({
      name: 'audit', status: 'completed',
      phases: [phase({
        members: [{ seq: 1, label: 'worker', childId: CHILD_ID, status: 'completed' }],
      })],
    })} />)
    const retained = screen.getByRole('button', { name: 'worker' })
    const phaseHeader = screen.getByRole('button', { name: /未分阶段/ })
    const runHeader = screen.getByRole('button', { name: /^audit/ })

    expect(fireEvent.mouseDown(retained)).toBe(true)
    expect(document.activeElement).toBe(retained)
    expect(fireEvent.mouseDown(phaseHeader)).toBe(false)
    fireEvent.click(phaseHeader)
    expect(phaseHeader.getAttribute('aria-expanded')).toBe('false')
    expect(runHeader.getAttribute('aria-expanded')).toBe('true')

    expect(fireEvent.mouseDown(runHeader)).toBe(false)
    fireEvent.click(runHeader)
    expect(runHeader.getAttribute('aria-expanded')).toBe('false')
  })

  it('settles pending completion when keyboard focus moves from content to its header', () => {
    const running: WorkflowRunChatData = {
      name: 'audit', status: 'running', phases: [phase()],
    }
    const view = render(<WorkflowRunPanel {...panelProps(running)} />)
    const member = screen.getByRole('button', { name: '打开 worker' })
    member.focus()
    view.rerender(<WorkflowRunPanel {...panelProps({
      ...running,
      phases: [phase({
        members: [{ seq: 1, label: 'worker', childId: CHILD_ID, status: 'completed' }],
      })],
    })} />)
    const retained = screen.getByRole('button', { name: 'worker' })
    const phaseHeader = screen.getByRole('button', { name: /未分阶段/ })
    const runHeader = screen.getByRole('button', { name: /^audit/ })
    fireEvent.blur(retained, { relatedTarget: phaseHeader })
    phaseHeader.focus()
    expect(phaseHeader.getAttribute('aria-expanded')).toBe('false')
    expect(runHeader.getAttribute('aria-expanded')).toBe('true')

    view.rerender(<WorkflowRunPanel {...panelProps({
      ...running,
      status: 'completed',
      phases: [phase({
        members: [{ seq: 1, label: 'worker', childId: CHILD_ID, status: 'completed' }],
      })],
    })} />)
    expect(runHeader.getAttribute('aria-expanded')).toBe('true')
    fireEvent.blur(phaseHeader, { relatedTarget: runHeader })
    runHeader.focus()
    expect(runHeader.getAttribute('aria-expanded')).toBe('false')
  })

  it('settles a deferred phase close when the user hides the outer run', () => {
    const running: WorkflowRunChatData = {
      name: 'audit', status: 'running', phases: [phase()],
    }
    const view = render(<WorkflowRunPanel {...panelProps(running)} />)
    const member = screen.getByRole('button', { name: '打开 worker' })
    member.focus()
    view.rerender(<WorkflowRunPanel {...panelProps({
      ...running,
      phases: [phase({
        members: [{ seq: 1, label: 'worker', childId: CHILD_ID, status: 'completed' }],
      })],
    })} />)
    const runHeader = screen.getByRole('button', { name: /^audit/ })
    expect(screen.getByRole('button', { name: /未分阶段/ }).getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(runHeader)
    expect(runHeader.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(runHeader)
    expect(screen.getByRole('button', { name: /未分阶段/ }).getAttribute('aria-expanded')).toBe('false')
  })

  it('reinitializes manual choices from durable facts after a renderer remount', () => {
    const data: WorkflowRunChatData = {
      name: 'audit', status: 'running', phases: [phase()],
    }
    const view = render(<WorkflowRunPanel {...panelProps(data)} />)
    fireEvent.click(screen.getByRole('button', { name: /未分阶段/ }))
    fireEvent.click(screen.getByRole('button', { name: /^audit/ }))
    view.unmount()
    render(<WorkflowRunPanel {...panelProps(data)} />)
    expect(screen.getByRole('button', { name: /^audit/ }).getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByRole('button', { name: /未分阶段/ }).getAttribute('aria-expanded')).toBe('true')
  })

  it('opens a running member confirmed by the direct parent catalog', () => {
    const data: WorkflowRunChatData = {
      name: 'audit', status: 'running', phases: [phase()],
    }
    const openSession = vi.fn()
    const sessions = listState()
    render(<WorkflowRunPanel {...panelProps(data, sessions, openSession)} />)
    fireEvent.click(screen.getByRole('button', { name: '打开 worker' }))
    expect(openSession).toHaveBeenCalledWith({
      parentSessionId: PARENT_ID,
      childSessionId: CHILD_ID,
      mode: 'one-shot',
    })
  })

  it('uses observed running state for a catalog-only member', () => {
    const data: WorkflowRunChatData = { name: 'audit', status: 'running', phases: [phase()] }
    const sessions = listState({
      ids: [PARENT_ID],
      byId: { ...listState().byId, [CHILD_ID]: { ...listState().byId[CHILD_ID]!, running: false } },
    })
    const openSession = vi.fn()
    let statuses = new Map([[CHILD_ID, { running: true, pendingInteraction: undefined, completionUnread: false }]])
    const props: WorkflowRunPanelProps = { ...panelProps(data, sessions, openSession),
      useSessionStatus: select => select(statuses),
    }
    const view = render(<WorkflowRunPanel {...props} />)
    fireEvent.click(screen.getByRole('button', { name: '打开 worker' }))
    expect(openSession).toHaveBeenCalledWith({ parentSessionId: PARENT_ID, childSessionId: CHILD_ID, mode: 'one-shot' })
    statuses = new Map([[CHILD_ID, { running: false, pendingInteraction: undefined, completionUnread: false }]])
    view.rerender(<WorkflowRunPanel {...props} />)
    expect(screen.queryByRole('button', { name: '打开 worker' })).toBeNull()
  })

  it('promotes a running member when its parent catalog arrives', () => {
    const data: WorkflowRunChatData = {
      name: 'audit', status: 'running', phases: [phase()],
    }
    const view = render(<WorkflowRunPanel {...panelProps(data, listState({ projectionsBySession: {} }))} />)
    expect(screen.queryByRole('button', { name: '打开 worker' })).toBeNull()
    view.rerender(<WorkflowRunPanel {...panelProps(data, listState())} />)
    expect(screen.getByRole('button', { name: '打开 worker' })).toBeTruthy()
  })

  it.each([
    ['catalog absent', listState({ projectionsBySession: {} }), 'running'],
    ['catalog empty', listState({ projectionsBySession: { [PARENT_ID]: { state: 'ready', error: null, values: { subagentCatalog: [] } } } }), 'running'],
    ['wrong parent', listState({ projectionsBySession: { ['other' as SessionId]: { state: 'ready', error: null, values: { subagentCatalog: [{ createdAt: 1, id: CHILD_ID, mode: 'one-shot' }] } } } }), 'running'],
    ['child inactive', listState({ byId: { ...listState().byId, [CHILD_ID]: { ...listState().byId[CHILD_ID]!, running: false } } }), 'running'],
    ['member terminal', listState(), 'completed'],
  ] as const)('does not navigate when %s', (_name, sessions, memberStatus) => {
    const data: WorkflowRunChatData = {
      name: 'audit', status: 'running',
      phases: [phase({
        members: [{
          seq: 1, label: 'worker', childId: 'child-1' as SessionId, status: memberStatus,
        }],
      })],
    }
    render(<WorkflowRunPanel {...panelProps(data, sessions)} />)
    expect(screen.queryByRole('button', { name: '打开 worker' })).toBeNull()
    cleanup()
  })
})

describe('workflow board durable and live inputs', () => {
  it('recovers a rejected raw live reversal through the existing ordered reconnect window', () => {
    const events = completeEvents()
    const live = assembler(events.slice(0, 5))
    live.append(events[6]!)
    expect(() => live.append(events[5]!)).toThrow('non-appended Match')
    live.replaceWindow([...events].reverse(), false)
    live.flush()
    expect(workflowData(live)).toEqual(workflowData(assembler(events)))
  })

  it('replays a reversed persisted window and reconnects to the same two-member board', () => {
    const events = completeEvents()
    const expected = workflowData(assembler(events))
    expect(workflowData(assembler([...events].reverse()))).toEqual(expected)
    const live = assembler(events.slice(0, 3))
    for (const event of events.slice(3)) {
      live.append(event)
      live.append(event)
    }
    live.flush()
    expect(workflowData(live)).toEqual(expected)
    live.replaceWindow(events, false)
    live.flush()
    expect(workflowData(live)).toEqual(expected)
  })

  it('keeps one card per run/member and does not reopen terminal state on delayed events', () => {
    const events = completeEvents()
    const live = assembler(events)
    live.append(at(11, 'tool-workflow/agent-start', {
      runId: 'run-1', seq: 1, label: 'duplicate', phase: 'wrong', childId: 'foreign',
    }))
    live.append(at(12, 'tool-workflow/agent-end', { runId: 'run-1', seq: 1, outcome: 'failed' }))
    live.append(at(13, 'tool-workflow/run-end', { runId: 'run-1', stopReason: 'completed' }))
    live.append(at(14, 'tool-workflow/agent-start', { runId: 'run-1', seq: 3, label: 'too late', childId: 'late' }))
    live.flush()
    expect(workflowData(live)).toEqual(workflowData(assembler(events)))
    const duringRun = assembler(events.slice(0, 5))
    duringRun.append(at(6, 'tool-workflow/agent-start', {
      runId: 'run-1', seq: 1, label: 'duplicate', childId: 'foreign',
    }))
    duringRun.flush()
    expect(workflowData(duringRun)?.phases.flatMap(value => value.members)).toHaveLength(2)
  })

  it.each(['completed', 'cancelled', 'error'])('shows a missing member ending as interrupted after run %s', (stopReason) => {
    const live = assembler(completeEvents().slice(0, 5))
    live.append(at(6, 'tool-workflow/agent-end', { runId: 'run-1', seq: 1, outcome: 'completed' }))
    live.append(at(7, 'tool-workflow/run-end', { runId: 'run-1', stopReason }))
    live.flush()
    expect(workflowData(live)?.phases.flatMap(value => value.members).map(member => member.status))
      .toEqual(['completed', 'interrupted'])
    live.append(at(8, 'tool-workflow/agent-end', { runId: 'run-1', seq: 2, outcome: 'cancelled' }))
    live.flush()
    expect(workflowData(live)?.phases[1]?.members[0]?.status).toBe('cancelled')
  })

  it('separates the same member sequence across runs', () => {
    const live = assembler([
      at(1, 'tool-workflow/run-start', { runId: 'a', name: 'first' }),
      at(2, 'tool-workflow/agent-start', { runId: 'a', seq: 1, label: 'A', childId: 'a-child' }),
      at(3, 'tool-workflow/run-start', { runId: 'b', name: 'second' }),
      at(4, 'tool-workflow/agent-start', { runId: 'b', seq: 1, label: 'B', childId: 'b-child' }),
      at(5, 'tool-workflow/agent-end', { runId: 'b', seq: 1, outcome: 'failed' }),
    ])
    const nodes = [...(live.snapshot('chat') as ChatSnapshot).nodes.values()]
    expect(nodes.map(value => [value.id, (value.data as WorkflowRunChatData).phases[0]?.members[0]?.status]))
      .toEqual([['a', 'running'], ['b', 'failed']])
  })
})

describe('read-only workflow board', () => {
  const englishProps = (data: WorkflowRunChatData, sessions = listState(), openSession = vi.fn()) => ({
    ...panelProps(data, sessions, openSession), runId: 'run-1', data, t: makeTranslate(en),
  })

  it('shows recorded phases, stable IDs, exact started counts and escaped arbitrary labels', () => {
    const data = workflowData(assembler(completeEvents()))!
    const malicious = '<img src=x onerror=alert(1)> & "member"'
    const input = { ...data, phases: [
      phase({ members: [{ seq: 1, label: malicious, childId: CHILD_ID, status: 'running' }] }),
      phase({ key: 'value:0:', phase: '', members: [{ seq: 2, label: 'done', childId: SECOND_ID, status: 'completed' }] }),
    ] }
    const view = render(<WorkflowBoard {...englishProps(input)} />)
    expect(screen.getByText(malicious)).toBeTruthy()
    expect(view.container.querySelector('img')).toBeNull()
    expect(screen.getByText('Unphased')).toBeTruthy()
    expect(screen.getByText('Empty phase name')).toBeTruthy()
    expect(screen.getByRole('progressbar').getAttribute('value')).toBe('1')
    expect(screen.getByRole('progressbar').getAttribute('max')).toBe('2')
    expect([...view.container.querySelectorAll('[data-board-member]')].map(value => value.getAttribute('data-board-member')))
      .toEqual(['5:run-1:1', '5:run-1:2'])
    expect(view.container.querySelectorAll('[data-board-status]')).toHaveLength(5)
    expect(screen.queryByText(/queued|artifact|7 tasks|4 agents/i)).toBeNull()
  })

  it('updates columns live and preserves recorded failure and cancellation after a remount', () => {
    const live = workflowData(assembler(completeEvents().slice(0, 5)))!
    const view = render(<WorkflowBoard {...englishProps(live)} />)
    expect(view.container.querySelector('[data-board-status="running"]')?.querySelectorAll('article')).toHaveLength(2)
    const settled = workflowData(assembler(completeEvents()))!
    view.rerender(<WorkflowBoard {...englishProps(settled)} />)
    expect(view.container.querySelector('[data-board-status="completed"]')?.querySelectorAll('article')).toHaveLength(1)
    expect(view.container.querySelector('[data-board-status="failed"]')?.querySelectorAll('article')).toHaveLength(1)
    expect(view.container.querySelector('[data-board-status="running"]')?.querySelectorAll('article')).toHaveLength(0)
    view.unmount()
    const restored = render(<WorkflowBoard {...englishProps(settled)} />)
    expect([...restored.container.querySelectorAll('[data-board-status]')].map(column => column.textContent))
      .toMatchInlineSnapshot(`
        [
          "Running 0",
          "Completed 1MemberfirstPhaseEmpty phase name",
          "Failed 1MembersecondPhaseUnphased",
          "Cancelled 0",
          "Interrupted 0",
        ]
      `)
  })

  it('opens only a catalog-owned running member with the canonical one-shot target', () => {
    const data: WorkflowRunChatData = { name: 'audit', status: 'running', phases: [phase()] }
    const open = vi.fn()
    const view = render(<WorkflowBoard {...englishProps(data, listState(), open)} />)
    fireEvent.click(screen.getByRole('button', { name: 'Open worker' }))
    expect(open).toHaveBeenCalledExactlyOnceWith({ parentSessionId: PARENT_ID, childSessionId: CHILD_ID, mode: 'one-shot' })
    view.rerender(<WorkflowBoard {...englishProps(data, listState({ projectionsBySession: {} }), open)} />)
    expect(screen.queryByRole('button')).toBeNull()
    view.rerender(<WorkflowBoard {...englishProps(data, listState({ byId: { [CHILD_ID]: { ...listState().byId[CHILD_ID]!, running: false } } }), open)} />)
    expect(screen.queryByRole('button')).toBeNull()
    view.rerender(<WorkflowBoard {...englishProps({ ...data, phases: [phase({ members: [{ seq: 1, label: 'worker', childId: CHILD_ID, status: 'completed' }] })] }, listState(), open)} />)
    expect(screen.queryByRole('button')).toBeNull()
    expect(open).toHaveBeenCalledTimes(1)
  })

  it('provides a collapsible in-chat board and opens the selected run in the sidebar', () => {
    const props = { ...panelProps(workflowData(assembler(completeEvents()))!), t: makeTranslate(en) }
    const view = render(<WorkflowRunPanel {...props} />)
    expect(view.container.querySelector('[data-workflow-board]')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Workflow board' }))
    expect(view.container.querySelector('[data-workflow-board]')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Open in sidebar' }))
    expect(props.actions.select).toHaveBeenCalledExactlyOnceWith(props.node.key)
    expect(props.openBoard).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Workflow board' }))
    expect(view.container.querySelector('[data-workflow-board]')).toBeNull()
  })

  it('restores only a selected identity per Session and reads current facts from a keyed source', () => {
    const first = createWorkflowBoardStore().create('board-test-parent')
    first.actions.select('restored-key')
    const restored = createWorkflowBoardStore().create('board-test-parent')
    expect(restored.store.getSnapshot()).toEqual({ selectedKey: 'restored-key' })
    expect(createWorkflowBoardStore().create('other-parent').store.getSnapshot()).toEqual({ selectedKey: null })
    const data = workflowData(assembler(completeEvents()))!
    const source = createSnapshotStore<WorkflowRunPanelProps['node'] | undefined>(node(data))
    const props: WorkflowBoardTabProps = { ...englishProps(data),
      actions: restored.actions,
      useStore: selector => selector(restored.store.getSnapshot()),
      useChat: selector => selector({ ...panelChat, nodes: { ...panelChat.nodes, source: () => source } }),
      useTabInfo: () => { throw new Error('unused') },
    }
    // Runtime supplies the remaining tab hooks, unused by this read-only body.
    const view = render(<WorkflowBoardTab {...props} />)
    expect(screen.getByText('Completed 1 of 2 started members')).toBeTruthy()
    view.unmount()
    const missing: WorkflowBoardTabProps = { ...props, useChat: selector => selector(panelChat) }
    render(<WorkflowBoardTab {...missing} />)
    expect(screen.getByText(/selected record may not be loaded/)).toBeTruthy()
    localStorage.removeItem('dsh:workflow-board:board-test-parent')
  })
})

describe('plugin lifecycle', () => {
  it('loads the production client plugin from a test-only YAML composition', async () => {
    const ctx = new Context()
    const open = vi.fn()
    const errors: unknown[] = []
    ctx.logger.exporter({ levels: { default: 3 }, export: message => { if (message.type === 'error') errors.push(...message.args) } })
    try {
      await ctx.plugin(SlotRegistry).await()
      await ctx.plugin(Loader).await()
      ctx.loader.builtins.include = Include
      ctx.loader.builtins['board-fixture-services'] = { inject: ['slots'], apply: (scope: Context) => {
        scope.provide('connection', { api: { settings: {} }, isLoopback: false } as never)
        scope.provide('remote', { $on: () => () => {} } as never)
        scope.provide('configForms', { developerTools: { enabled: createSnapshotStore(true) }, get: () => stubConfigForm().scope } as never)
        scope.provide('sessions', new TestSessions(async action => { await action() }, scope))
        scope.provide('uiWorkspace', { openSession: vi.fn() } as never)
        scope.provide('sidebarRight', { openTabIn: open } as never)
        scope.provide('sidebarRightTabs', new SidebarRightTabRegistry(scope))
        new UiConversation(scope, scope.get('sessions')!)
        scope.slots.register({ name: 'root', children: {
          'conversation.chat.node': { kind: 'keyed', scope: 'session' },
          'sidebar.right.pane.tab': { kind: 'keyed', scope: 'session' },
          'sidebar.right.pane.tab.title': { kind: 'keyed', scope: 'session' },
        } } as never, () => null)
      } }
      ctx.loader.builtins['board-fixture-locale'] = { inject: localeInject, apply: applyLocale }
      ctx.loader.builtins['board-production-client'] = { inject, apply }
      await ctx.loader.create({ name: 'cordis:include', config: {
        path: pathToFileURL(resolve('packages/client/ui-workflow-run/tests/fixtures/board-loader.yml')).href,
      } })
      await ctx.loader.await()
      expect(errors).toEqual([])
      expect(ctx.get('uiConversation')?.events.entries().map(entry => entry.kind)).toEqual(['workflow-run'])
      expect(ctx.get('sidebarRightTabs')?.get('workflow-board')?.id).toBe('@deepseek-ai/dsh-client-ui-workflow-run')
      const chat = ctx.slots.entries('conversation.chat.node')[0]!
      const sidebar = ctx.slots.entries('sidebar.right.pane.tab')[0]!
      expect(chat.store).toBe(sidebar.store)
      const navigation = (chat.inject as (id: SessionId) => Record<string, unknown>)(PARENT_ID)
      if (typeof navigation.openBoard !== 'function') throw new Error('board opener missing')
      navigation.openBoard()
      expect(open).toHaveBeenCalledExactlyOnceWith(PARENT_ID, 'workflow-board')
      const data = workflowData(assembler(completeEvents()))!
      const view = render(<WorkflowRunPanel {...panelProps(data)} t={makeTranslate(en)} />)
      fireEvent.click(screen.getByRole('button', { name: 'Workflow board' }))
      expect(view.container.querySelectorAll('[data-board-member]')).toHaveLength(2)
    } finally {
      cleanup()
      await ctx.fiber.dispose()
    }
  })

  it('registers and removes the Definition and keyed renderer with its fiber', async () => {
    const ctx = new Context()
    await ctx.plugin(SlotRegistry).await()
    ctx.provide('connection', { api: { settings: {} }, isLoopback: false } as never)
    ctx.provide('remote', { $on: () => () => {} } as never)
    ctx.provide('configForms', { developerTools: { enabled: createSnapshotStore(true) }, get: () => stubConfigForm().scope } as never)
    const sessions = new TestSessions(async (action) => { await action() }, ctx)
    ctx.provide('sessions', sessions)
    const openSession = vi.fn(async () => {})
    ctx.provide('uiWorkspace', { openSession } as never)
    const tabTypes = new Map<string, object>()
    ctx.provide('sidebarRight', { openTabIn: vi.fn() } as never)
    ctx.provide('sidebarRightTabs', { register: (definition: { id: string }) => {
      tabTypes.set(definition.id, definition)
      return () => { tabTypes.delete(definition.id) }
    } } as never)
    const conversationEvents = new UiConversation(ctx, ctx.sessions).events
    ctx.slots.register({
      name: 'root',
      children: {
        'conversation.chat.node': { kind: 'keyed', scope: 'session' },
        'sidebar.right.pane.tab': { kind: 'keyed', scope: 'session' },
        'sidebar.right.pane.tab.title': { kind: 'keyed', scope: 'session' },
      },
    } as never, () => null)
    await ctx.plugin({ inject: localeInject, apply: applyLocale }).await()
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(conversationEvents.entries().map(entry => entry.kind)).toEqual(['workflow-run'])
    expect(ctx.slots.entries('conversation.chat.node')).toHaveLength(1)
    expect(tabTypes.size).toBe(1)
    expect(ctx.slots.entries('sidebar.right.pane.tab')).toHaveLength(1)
    const entry = ctx.slots.entries('conversation.chat.node')[0]!
    const face = entry.inject?.() as unknown as WorkflowRunInjected
    face.openSession(CHILD_ID)
    expect(openSession).toHaveBeenCalledExactlyOnceWith(CHILD_ID)
    await fiber.dispose()
    expect(conversationEvents.entries()).toEqual([])
    expect(ctx.slots.entries('conversation.chat.node')).toEqual([])
    expect(tabTypes.size).toBe(0)
    expect(ctx.slots.entries('sidebar.right.pane.tab')).toEqual([])

    const replacement = ctx.plugin({ inject: [...inject], apply })
    await replacement.await()
    expect(conversationEvents.entries().map(entry => entry.kind)).toEqual(['workflow-run'])
    expect(ctx.slots.entries('conversation.chat.node')).toHaveLength(1)
    await replacement.dispose()
  })

  it('keeps the node half inert', () => {
    applyNode()
  })
})
