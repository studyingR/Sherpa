/**
 * Live Salesforce adapter skeleton (M9): REST + composite API with typed mapping.
 * Read methods and the debrief composite write are mapped; the rest throw NotImplemented.
 * Contract tests replay recorded fixtures (src/live/__fixtures__).
 */
import type { Account, Contact, Opportunity, Task } from '@sherpa/shared';
import { NotImplementedError, UpstreamUnavailableError, type SalesforceAdapter } from '../interfaces';

export interface SfConfig {
  instanceUrl: string;
  accessToken: string;
  apiVersion: string;
}

interface SfAccountRecord {
  Id: string;
  Name: string;
  BillingCity: string | null;
  BillingState: string | null;
  Segment__c: string | null;
  Coverage_Tier__c: string | null;
  OwnerId: string;
  Industry: string | null;
  Revenue_Band__c: string | null;
  Relationship_Since__c: string | null;
}

interface SfContactRecord {
  Id: string;
  AccountId: string;
  Name: string;
  Title: string | null;
  Email: string | null;
  Phone: string | null;
  Primary__c: boolean | null;
}

interface SfOpportunityRecord {
  Id: string;
  AccountId: string;
  Name: string;
  Amount: number | null;
  StageName: string;
  CloseDate: string | null;
}

interface SfTaskRecord {
  Id: string;
  WhatId: string | null;
  What?: { Name: string } | null;
  Subject: string;
  OwnerId: string;
  Owner?: { Name: string } | null;
  ActivityDate: string | null;
  Status: string;
  Client_Commitment__c: boolean | null;
  Debrief__c: string | null;
}

export function mapSfAccount(r: SfAccountRecord): Account {
  return {
    id: r.Id,
    name: r.Name,
    city: r.BillingCity ?? '',
    state: r.BillingState ?? '',
    segment: r.Segment__c === 'Small Business' ? 'SMALL_BUSINESS' : 'COMMERCIAL',
    coverageTier: (['A', 'B', 'C'].includes(r.Coverage_Tier__c ?? '') ? r.Coverage_Tier__c : 'C') as Account['coverageTier'],
    ownerRmId: r.OwnerId,
    industry: r.Industry ?? '',
    annualRevenueBand: r.Revenue_Band__c ?? '',
    relationshipSince: r.Relationship_Since__c ?? '',
  };
}

export function mapSfContact(r: SfContactRecord): Contact {
  return { id: r.Id, accountId: r.AccountId, name: r.Name, title: r.Title ?? '', email: r.Email ?? '', phone: r.Phone ?? undefined, isPrimary: Boolean(r.Primary__c) };
}

export function mapSfOpportunity(r: SfOpportunityRecord): Opportunity {
  return { id: r.Id, accountId: r.AccountId, name: r.Name, amount: r.Amount, stage: r.StageName, closeDate: r.CloseDate };
}

export function mapSfTask(r: SfTaskRecord): Task {
  return {
    id: r.Id,
    accountId: r.WhatId,
    accountName: r.What?.Name ?? null,
    subject: r.Subject,
    ownerId: r.OwnerId,
    ownerName: r.Owner?.Name ?? '',
    dueDate: r.ActivityDate,
    status: r.Status === 'Completed' ? 'COMPLETED' : 'OPEN',
    clientCommitment: Boolean(r.Client_Commitment__c),
    debriefId: r.Debrief__c,
  };
}

/** Build the composite request that creates Meeting_Debrief__c + attendee junctions atomically. */
export function buildDebriefComposite(apiVersion: string, fields: Record<string, unknown>, attendees: { contactId?: string; userId?: string; role?: string }[]) {
  return {
    allOrNone: true,
    compositeRequest: [
      { method: 'POST', url: `/services/data/${apiVersion}/sobjects/Meeting_Debrief__c`, referenceId: 'debrief', body: fields },
      ...attendees.map((a, i) => ({
        method: 'POST',
        url: `/services/data/${apiVersion}/sobjects/Debrief_Attendee__c`,
        referenceId: `att${i}`,
        body: { Debrief__c: '@{debrief.id}', Contact__c: a.contactId ?? null, User__c: a.userId ?? null, Role__c: a.role ?? null },
      })),
    ],
  };
}

const soqlEscape = (s: string) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

export function createLiveSalesforce(cfg: SfConfig, fetchImpl: typeof fetch): SalesforceAdapter {
  const base = `${cfg.instanceUrl}/services/data/${cfg.apiVersion}`;
  async function call<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetchImpl(`${base}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${cfg.accessToken}`, 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    });
    if (res.status >= 500) throw new UpstreamUnavailableError('Salesforce');
    if (!res.ok) throw new Error(`Salesforce ${res.status}`);
    return (await res.json()) as T;
  }
  const query = <T>(soql: string) => call<{ records: T[] }>(`/query?q=${encodeURIComponent(soql)}`).then((r) => r.records);
  const ni = (m: string) => async () => {
    throw new NotImplementedError(`Salesforce.${m}`);
  };

  return {
    async getAccount(_ctx, accountId) {
      const r = await call<SfAccountRecord>(`/sobjects/Account/${encodeURIComponent(accountId)}`);
      return { ...mapSfAccount(r), profile: {} };
    },
    async listAccounts(_ctx, filter) {
      const owners = filter.ownerRmIds.map((o) => `'${soqlEscape(o)}'`).join(',');
      const rows = await query<SfAccountRecord>(
        `SELECT Id, Name, BillingCity, BillingState, Segment__c, Coverage_Tier__c, OwnerId, Industry, Revenue_Band__c, Relationship_Since__c FROM Account WHERE OwnerId IN (${owners}) ORDER BY Name`,
      );
      return rows.map(mapSfAccount);
    },
    async getContacts(_ctx, accountId) {
      const rows = await query<SfContactRecord>(`SELECT Id, AccountId, Name, Title, Email, Phone, Primary__c FROM Contact WHERE AccountId = '${soqlEscape(accountId)}'`);
      return rows.map(mapSfContact);
    },
    async getOpenOpportunities(_ctx, accountId) {
      const rows = await query<SfOpportunityRecord>(`SELECT Id, AccountId, Name, Amount, StageName, CloseDate FROM Opportunity WHERE AccountId = '${soqlEscape(accountId)}' AND IsClosed = false`);
      return rows.map(mapSfOpportunity);
    },
    async getTasks(_ctx, filter) {
      const owners = filter.bookRmIds.map((o) => `'${soqlEscape(o)}'`).join(',');
      const rows = await query<SfTaskRecord>(
        `SELECT Id, WhatId, What.Name, Subject, OwnerId, Owner.Name, ActivityDate, Status, Client_Commitment__c, Debrief__c FROM Task WHERE OwnerId IN (${owners})`,
      );
      return rows.map(mapSfTask);
    },
    async createDebrief(_ctx, fields) {
      const res = await call<{ compositeResponse: { referenceId: string; body: { id: string } }[] }>(`/composite`, {
        method: 'POST',
        body: JSON.stringify(buildDebriefComposite(cfg.apiVersion, fields, [])),
      });
      return { id: res.compositeResponse[0].body.id };
    },
    getActivities: ni('getActivities'),
    getLastTouch: ni('getLastTouch'),
    getOpenCases: ni('getOpenCases'),
    getTask: ni('getTask'),
    listUsers: ni('listUsers'),
    createAttendees: ni('createAttendees'),
    createTasks: ni('createTasks'),
    updateTask: ni('updateTask'),
    createOpportunity: ni('createOpportunity'),
    updateOpportunity: ni('updateOpportunity'),
    upsertContact: ni('upsertContact'),
    updateEvent: ni('updateEvent'),
    createReferral: ni('createReferral'),
    updateReferral: ni('updateReferral'),
    createComplaintCase: ni('createComplaintCase'),
    logActivity: ni('logActivity'),
  };
}
