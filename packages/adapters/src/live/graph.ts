/** Live Microsoft Graph skeleton (M9): calendar events and Outlook DRAFTS. No send endpoint is ever called. */
import type { Meeting } from '@sherpa/shared';
import { UpstreamUnavailableError, type CalendarAdapter, type MailAdapter, type MailMessage } from '../interfaces';

export interface GraphConfig {
  tenantId: string;
  accessToken: string;
}

interface GraphEvent {
  id: string;
  subject: string;
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
  location?: { displayName?: string };
  isOnlineMeeting?: boolean;
  attendees: { emailAddress: { name: string; address: string }; type: string }[];
  singleValueExtendedProperties?: { id: string; value: string }[];
}

export function mapGraphEvent(e: GraphEvent, internalDomain: string): Meeting {
  return {
    id: e.id,
    accountId: e.singleValueExtendedProperties?.find((p) => p.id.endsWith('SherpaAccountId'))?.value ?? null,
    subject: e.subject,
    start: new Date(`${e.start.dateTime}Z`).toISOString(),
    end: new Date(`${e.end.dateTime}Z`).toISOString(),
    location: e.location?.displayName,
    type: e.isOnlineMeeting ? 'VIRTUAL' : 'IN_PERSON',
    attendees: e.attendees.map((a) => ({
      name: a.emailAddress.name,
      email: a.emailAddress.address,
      external: !a.emailAddress.address.toLowerCase().endsWith(`@${internalDomain}`),
    })),
  };
}

/** Graph message body for POST /me/messages (creates a draft; never /send). */
export function toGraphDraft(m: MailMessage) {
  return {
    subject: m.subject,
    body: { contentType: 'Text', content: m.body },
    toRecipients: m.to.map((r) => ({ emailAddress: { name: r.name, address: r.email } })),
    ccRecipients: m.cc.map((r) => ({ emailAddress: { name: r.name, address: r.email } })),
  };
}

export function createLiveGraph(cfg: GraphConfig, fetchImpl: typeof fetch): { calendar: CalendarAdapter; mail: MailAdapter } {
  const base = 'https://graph.microsoft.com/v1.0';
  async function call<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetchImpl(`${base}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${cfg.accessToken}`, 'Content-Type': 'application/json' },
    });
    if (res.status >= 500) throw new UpstreamUnavailableError('Microsoft 365');
    if (!res.ok) throw new Error(`Graph ${res.status}`);
    return (await res.json()) as T;
  }
  return {
    calendar: {
      async listMeetings(_ctx, range) {
        const r = await call<{ value: GraphEvent[] }>(
          `/me/calendarView?startDateTime=${range.from.toISOString()}&endDateTime=${range.to.toISOString()}`,
        );
        return r.value.map((e) => mapGraphEvent(e, 'bank.example'));
      },
      async getMeeting(_ctx, meetingId) {
        const e = await call<GraphEvent>(`/me/events/${encodeURIComponent(meetingId)}`);
        return { ...mapGraphEvent(e, 'bank.example'), ownerRmId: '', debriefId: null };
      },
      async createHold(_ctx, hold) {
        const r = await call<{ id: string }>(`/me/events`, {
          method: 'POST',
          body: JSON.stringify({ subject: hold.title, showAs: 'tentative', start: { dateTime: hold.start.toISOString(), timeZone: 'UTC' }, end: { dateTime: hold.end.toISOString(), timeZone: 'UTC' } }),
        });
        return { id: r.id };
      },
    },
    mail: {
      async createDraft(_ctx, m) {
        const r = await call<{ id: string }>(`/me/messages`, { method: 'POST', body: JSON.stringify(toGraphDraft(m)) });
        return { id: r.id };
      },
    },
  };
}
