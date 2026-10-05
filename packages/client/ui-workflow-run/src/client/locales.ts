/** `workflowRun` namespace dictionaries. */

/** Dictionary namespace owned by this plugin. */
export const NS = 'workflowRun'

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'board.title': '工作流看板',
  'board.side': '在侧栏中打开',
  'board.assignee': '成员',
  'board.phase': '阶段',
  'board.child': '打开子会话',
  'board.progress': '已完成 {completed} / {total} 个已启动成员',
  'board.unavailable': '从会话中的工作流卡片打开看板；所选记录可能尚未加载',
  'run.title': '{name}',
  'run.members.one': '{count} 个成员',
  'run.members.other': '{count} 个成员',
  'run.empty': '没有启动成员',
  'phase.unassigned': '未分阶段',
  'phase.empty': '空阶段名',
  'statusCount.running': '运行中 {count}',
  'statusCount.completed': '已完成 {count}',
  'statusCount.failed': '失败 {count}',
  'statusCount.cancelled': '已取消 {count}',
  'statusCount.interrupted': '已中断 {count}',
  'member.empty': '空成员名',
  'member.open': '打开 {name}',
  'status.running': '运行中',
  'status.completed': '已完成',
  'status.failed': '失败',
  'status.cancelled': '已取消',
  'status.interrupted': '已中断',
}

/** English dictionary (same key set). */
export const en: Record<WorkflowRunKey, string> = {
  'board.title': 'Workflow board',
  'board.side': 'Open in sidebar',
  'board.assignee': 'Member',
  'board.phase': 'Phase',
  'board.child': 'Open child conversation',
  'board.progress': 'Completed {completed} of {total} started members',
  'board.unavailable': 'Open a board from a workflow card in this conversation; the selected record may not be loaded yet',
  'run.title': '{name}',
  'run.members.one': '{count} member',
  'run.members.other': '{count} members',
  'run.empty': 'No members started',
  'phase.unassigned': 'Unphased',
  'phase.empty': 'Empty phase name',
  'statusCount.running': 'Running {count}',
  'statusCount.completed': 'Completed {count}',
  'statusCount.failed': 'Failed {count}',
  'statusCount.cancelled': 'Cancelled {count}',
  'statusCount.interrupted': 'Interrupted {count}',
  'member.empty': 'Empty member name',
  'member.open': 'Open {name}',
  'status.running': 'Running',
  'status.completed': 'Completed',
  'status.failed': 'Failed',
  'status.cancelled': 'Cancelled',
  'status.interrupted': 'Interrupted',
}

/** Union of this namespace's dictionary keys. */
export type WorkflowRunKey = keyof typeof zh
