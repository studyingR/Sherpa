/** Typed API surface (shapes from packages/shared) + React Query hooks. */
import { useEffect, useState } from 'react';
import NetInfo from '@react-native-community/netinfo';
import { useMutation, useQuery, useQueryClient, type UseQueryOptions } from '@tanstack/react-query';
import type {
  AccountDetail,
  AccountSummary,
  AgendaResponse,
  AgentTurn,
  Alert,
  AlertActionRequest,
  AskBriefResponse,
  Brief,
  ComplianceItem,
  Confirmation,
  CoverageItem,
  CoveragePlan,
  DealDraft,
  DealDraftPatch,
  DebriefDetail,
  DebriefDraft,
  DebriefDraftPatch,
  DocumentItem,
  FollowUpDraft,
  HealthScore,
  Notification,
  Persona,
  Preferences,
  PricingGuidance,
  Recipient,
  Referral,
  ReferralIntentRequest,
  ResolvedFlags,
  RoutePreview,
  SignInResponse,
  Specialty,
  StartDebriefRequest,
  StartDebriefResponse,
  Task,
  TaskActionRequest,
  TodayView,
  AgentMessage,
  User,
  WriteIntent,
  WriteResult,
} from '@sherpa/shared';
import { api, cached } from './client';

export type Offline<T> = T & { __offline?: boolean };

export const API = {
  personas: () => api<Persona[]>('/auth/personas'),
  signIn: (personaId: string) => api<SignInResponse>('/auth/sign-in', { body: { personaId } }),
  signOut: () => api<{ ok: true }>('/auth/sign-out', { method: 'POST', body: {} }),
  me: () => api<User>('/me'),
  features: () => api<ResolvedFlags>('/me/features'),
  preferences: () => api<Preferences>('/me/preferences'),
  savePreferences: (p: Preferences) => api<Preferences>('/me/preferences', { method: 'PUT', body: p }),
  setPin: (pin: string) => api<{ ok: true }>('/me/phone-pin', { method: 'PUT', body: { pin } }),
  pushToken: (token: string) => api<{ ok: true }>('/me/push-token', { body: { token } }),
  notifications: () => api<Notification[]>('/notifications'),
  markRead: (id: string) => api<{ ok: true }>(`/notifications/${id}/read`, { body: {} }),
  today: () => cached('today', () => api<TodayView>('/today')),
  agenda: () => api<AgendaResponse>('/agenda'),
  accounts: (query?: string, segment?: string) => api<AccountSummary[]>(`/accounts?${new URLSearchParams({ ...(query ? { query } : {}), ...(segment ? { segment } : {}) })}`),
  account: (id: string) => api<AccountDetail>(`/accounts/${id}`),
  startDebrief: (b: StartDebriefRequest) => api<StartDebriefResponse>('/debriefs/sessions', { body: b }),
  draft: (id: string) => api<DebriefDraft>(`/debriefs/drafts/${id}`),
  transcript: (id: string) => api<AgentMessage[]>(`/debriefs/drafts/${id}/transcript`),
  patchDraft: (id: string, p: DebriefDraftPatch) => api<DebriefDraft>(`/debriefs/drafts/${id}`, { method: 'PATCH', body: p }),
  chat: (id: string, text: string) => api<AgentTurn>(`/debriefs/drafts/${id}/chat`, { body: { text } }),
  debriefIntent: (id: string) => api<WriteIntent>(`/debriefs/drafts/${id}/intent`, { body: {} }),
  confirmDebrief: (c: Confirmation) => api<WriteResult>('/debriefs/confirm', { body: c }),
  debrief: (id: string) => api<DebriefDetail>(`/debriefs/${id}`),
  resumable: () => api<DebriefDraft[]>('/debriefs/resumable'),
  briefMeeting: (id: string) => cached(`brief.m.${id}`, () => api<Brief>(`/briefs/meeting/${id}`)),
  briefAccount: (id: string) => cached(`brief.a.${id}`, () => api<Brief>(`/briefs/account/${id}`)),
  askBrief: (accountId: string, question: string) => api<AskBriefResponse>(`/briefs/${accountId}/ask`, { body: { question } }),
  createDrafts: (debriefId: string, kinds: ('CLIENT' | 'INTERNAL')[]) => api<FollowUpDraft[]>(`/debriefs/${debriefId}/drafts`, { body: { kinds } }),
  patchFollowUp: (id: string, p: { subject?: string; body?: string; to?: string[]; cc?: string[] }) => api<FollowUpDraft>(`/drafts/${id}`, { method: 'PATCH', body: p }),
  draftRecipients: (id: string) => api<Recipient[]>(`/drafts/${id}/recipients`),
  draftIntent: (id: string) => api<WriteIntent>(`/drafts/${id}/intent`, { body: {} }),
  saveToMailbox: (id: string, c: Confirmation) => api<{ mailDraftId: string; result: WriteResult }>(`/drafts/${id}/save-to-mailbox`, { body: c }),
  tasks: (status?: string) => api<Task[]>(`/tasks${status ? `?status=${status}` : ''}`),
  taskIntent: (id: string, b: TaskActionRequest) => api<WriteIntent>(`/tasks/${id}/intent`, { body: b }),
  intent: (id: string) => api<WriteIntent>(`/intents/${id}`),
  confirmIntent: (c: Confirmation) => api<WriteResult>('/intents/confirm', { body: c }),
  referrals: (accountId?: string) => api<Referral[]>(`/referrals${accountId ? `?accountId=${accountId}` : ''}`),
  referralRoute: (accountId: string, specialty: Specialty) => api<RoutePreview>(`/referrals/route?accountId=${accountId}&specialty=${specialty}`),
  referralPrefill: (debriefId: string) => api<{ accountId: string; specialties: Specialty[]; specialty: Specialty | null; needSummary: string; contactId: string | null }>(`/referrals/prefill/${debriefId}`),
  referralIntent: (b: ReferralIntentRequest) => api<WriteIntent & { route: RoutePreview }>('/referrals/intent', { body: b }),
  alerts: (status: 'open' | 'snoozed' | 'all') => api<Alert[]>(`/alerts?status=${status}`),
  alertAction: (id: string, b: AlertActionRequest) => api<Alert | WriteIntent>(`/alerts/${id}/action`, { body: b }),
  startDeal: (accountId: string, fromDebriefId?: string) => api<{ sessionId: string; dealDraftId: string; draft: DealDraft; opening: string }>('/deals/sessions', { body: { accountId, fromDebriefId } }),
  deal: (id: string) => api<DealDraft>(`/deals/${id}`),
  patchDeal: (id: string, p: DealDraftPatch) => api<DealDraft>(`/deals/${id}`, { method: 'PATCH', body: p }),
  dealChat: (id: string, text: string) => api<{ messages: AgentMessage[]; draft: DealDraft; intent?: WriteIntent; writeResult?: WriteResult }>(`/deals/${id}/chat`, { body: { text } }),
  dealIntent: (id: string) => api<WriteIntent>(`/deals/${id}/intent`, { body: {} }),
  documents: (accountId?: string) => api<DocumentItem[]>(`/documents${accountId ? `?accountId=${accountId}` : ''}`),
  documentRequest: (accountId: string, itemIds: string[], reminderDays?: number[]) => api<FollowUpDraft>(`/documents/${accountId}/request-draft`, { body: { itemIds, reminderDays } }),
  markDocument: (id: string, status: 'RECEIVED' | 'WAIVED') => api<DocumentItem>(`/documents/${id}/mark`, { body: { status } }),
  tpFeedback: (id: string, feedback: 'UP' | 'DOWN') => api<{ ok: true }>(`/talking-points/${encodeURIComponent(id)}/feedback`, { body: { feedback } }),
  coverage: () => api<{ items: CoverageItem[]; plan: CoveragePlan }>('/coverage'),
  coverageAction: (accountId: string, action: 'ACCEPT' | 'SKIP' | 'SCHEDULE', reason?: string) => api<WriteIntent | { ok: true }>(`/coverage/${accountId}/action`, { body: { action, reason } }),
  coverageTeam: () => api<{ rmId: string; name: string; coveragePct: number; accounts: number; overdue: number }[]>('/coverage/team'),
  liveStart: (b: { meetingId: string; jurisdiction: string; allPartyConsentConfirmed: boolean; consentStatement: string }) => api<{ sessionId: string; draftId: string }>('/live/sessions', { body: b }),
  liveSegment: (id: string, text: string) => api<{ captured: { nextSteps: string[]; flags: { flag: string; message: string }[] } }>(`/live/sessions/${id}/segments`, { body: { text } }),
  liveStop: (id: string) => api<{ draftId: string }>(`/live/sessions/${id}/stop`, { body: {} }),
  pricing: (dealId: string) => api<PricingGuidance>('/pricing/guidance', { body: { dealId } }),
  health: (accountId: string) => api<HealthScore>(`/accounts/${accountId}/health`),
  complianceQueue: () => api<ComplianceItem[]>('/compliance/queue'),
  resolveCompliance: (id: string, note: string) => api<{ ok: true }>(`/compliance/queue/${id}/resolve`, { body: { note } }),
  ask: (text: string, accountId?: string) => api<AgentTurn>('/ask', { body: { text, context: accountId ? { accountId } : undefined } }),
};

export function useApiQuery<T>(key: unknown[], fn: () => Promise<T>, opts: Omit<UseQueryOptions<T>, 'queryKey' | 'queryFn'> = {}) {
  return useQuery<T>({ queryKey: key, queryFn: fn, ...opts });
}

export function useInvalidate() {
  const qc = useQueryClient();
  return (...keys: string[]) => Promise.all(keys.map((k) => qc.invalidateQueries({ queryKey: [k] })));
}

export { useMutation };

export function useOnline(): boolean {
  const [online, setOnline] = useState(true);
  useEffect(() => NetInfo.addEventListener((s) => setOnline(s.isConnected !== false && s.isInternetReachable !== false)), []);
  return online;
}
