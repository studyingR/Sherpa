/**
 * Agent tool registry (docs/05 §6). Each tool declares the modes it may run in, its feature flag, and whether
 * it reads, writes only Sherpa's own DB (R*), or prepares an external write (W → WriteIntent only).
 * Tools for inactive features are never registered (docs/02 §5).
 */
import type { FlagName, Mode, ResolvedFlags } from '@sherpa/shared';

export type ToolAccess = 'R' | 'R*' | 'W';
export interface ToolDef {
  name: string;
  modes: Mode[];
  flag: FlagName | null;
  access: ToolAccess;
  description: string;
}

const ALL: Mode[] = ['DEBRIEF', 'BRIEF', 'ASK', 'DEAL', 'AGENDA', 'LIVE'];

export const TOOLS: ToolDef[] = [
  { name: 'find_recent_meetings', modes: ['DEBRIEF', 'ASK'], flag: 'F01_DEBRIEF', access: 'R', description: 'Calendar meetings ended in the last 8 hours' },
  { name: 'search_accounts', modes: ALL, flag: null, access: 'R', description: 'Fuzzy search within the RM book' },
  { name: 'get_account_snapshot', modes: ALL, flag: null, access: 'R', description: 'Overview facts for an account' },
  { name: 'update_debrief_draft', modes: ['DEBRIEF', 'LIVE'], flag: 'F01_DEBRIEF', access: 'R*', description: 'Apply extraction to the draft' },
  { name: 'prepare_debrief_save', modes: ['DEBRIEF'], flag: 'F01_DEBRIEF', access: 'W', description: 'Build the debrief WriteIntent' },
  { name: 'assemble_brief', modes: ['BRIEF', 'ASK'], flag: 'F02_BRIEF', access: 'R', description: 'Run BriefService' },
  { name: 'answer_from_brief', modes: ['BRIEF'], flag: 'F02_BRIEF', access: 'R', description: 'Grounded Q&A over the brief' },
  { name: 'draft_follow_ups', modes: ['DEBRIEF', 'ASK'], flag: 'F03_DRAFTS', access: 'R*', description: 'Create follow-up drafts' },
  { name: 'prepare_mail_draft_save', modes: ['ASK'], flag: 'F03_DRAFTS', access: 'W', description: 'Intent to save drafts to the mailbox' },
  { name: 'get_agenda', modes: ['AGENDA', 'ASK'], flag: 'F04_NUDGES', access: 'R', description: 'Today view' },
  { name: 'prepare_task_action', modes: ['AGENDA', 'ASK'], flag: 'F04_NUDGES', access: 'W', description: 'Complete, reschedule or delegate a task' },
  { name: 'prepare_referral', modes: ['DEBRIEF', 'ASK'], flag: 'F05_REFERRALS', access: 'W', description: 'Routed referral intent' },
  { name: 'list_alerts', modes: ['ASK', 'BRIEF'], flag: 'F06_WATCHLIST', access: 'R', description: 'Open alerts' },
  { name: 'act_on_alert', modes: ['ASK'], flag: 'F06_WATCHLIST', access: 'W', description: 'Ack/snooze (Sherpa DB); create task (W)' },
  { name: 'update_deal_draft', modes: ['DEAL'], flag: 'F07_DEAL_INTAKE', access: 'R*', description: 'Apply extraction to the deal draft' },
  { name: 'prepare_deal_draft_save', modes: ['DEAL'], flag: 'F07_DEAL_INTAKE', access: 'W', description: 'nCino draft intent' },
  { name: 'list_outstanding_documents', modes: ['ASK', 'BRIEF'], flag: 'F08_DOC_CHASE', access: 'R', description: 'Outstanding documents' },
  { name: 'draft_document_request', modes: ['ASK'], flag: 'F08_DOC_CHASE', access: 'R*', description: 'Draft a document request' },
  { name: 'get_talking_points', modes: ['BRIEF', 'ASK'], flag: 'F09_TALKING_POINTS', access: 'R', description: 'Talking points' },
  { name: 'get_coverage_plan', modes: ['ASK', 'AGENDA'], flag: 'F10_COVERAGE', access: 'R', description: 'Weekly coverage plan' },
  { name: 'prepare_coverage_action', modes: ['ASK'], flag: 'F10_COVERAGE', access: 'W', description: 'Task or calendar hold' },
  { name: 'get_pricing_guidance', modes: ['ASK'], flag: 'F12_PRICING_GUIDANCE', access: 'R', description: 'Indicative pricing (screen only)' },
  { name: 'get_health_score', modes: ['BRIEF', 'ASK'], flag: 'F13_HEALTH_SCORE', access: 'R', description: 'Relationship health' },
];

export function toolsFor(mode: Mode, flags: ResolvedFlags): ToolDef[] {
  return TOOLS.filter((t) => t.modes.includes(mode) && (t.flag === null || flags[t.flag]));
}

export class ToolNotAllowedError extends Error {}

/**
 * Tools are invoked only for RM utterances parsed by the orchestrator. `origin` must be 'RM';
 * a call derived from external text (news, email, documents) is rejected (C-14).
 */
export function assertToolAllowed(name: string, mode: Mode, flags: ResolvedFlags, origin: 'RM' | 'EXTERNAL'): ToolDef {
  if (origin !== 'RM') throw new ToolNotAllowedError(`Tool ${name} cannot be triggered by external content`);
  const t = toolsFor(mode, flags).find((x) => x.name === name);
  if (!t) throw new ToolNotAllowedError(`Tool ${name} is not available in ${mode} mode`);
  return t;
}
