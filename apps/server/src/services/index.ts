import type { Deps } from '../deps';
import { createAccountService } from './accounts';
import { createAlertService } from './alerts';
import { createAskService } from './ask';
import { createBookService } from './book';
import { createBriefService } from './brief';
import { createComplianceService, createNotificationService } from './compliance';
import { createDealService, createLiveService, createPricingService } from './deals';
import { createDebriefService } from './debrief';
import { createDraftService } from './drafts';
import { createCoverageService, createDocumentService, createHealthService, createTalkingPointService } from './insights';
import { createTodayService } from './today';
import { createReferralService, createTaskService } from './workflows';

export function createServices(d: Deps) {
  const book = createBookService(d);
  const alerts = createAlertService(d, book);
  const docs = createDocumentService(d);
  const talking = createTalkingPointService(d, book);
  const coverage = createCoverageService(d, book, alerts);
  const health = createHealthService(d, book);
  const notifications = createNotificationService(d);
  const compliance = createComplianceService(d);
  const referrals = createReferralService(d, notifications);
  const accounts = createAccountService(d, book, alerts, docs, talking, health, referrals);
  const today = createTodayService(d, alerts, docs, coverage, health);
  const brief = createBriefService(d, book, alerts, docs, talking, health);
  const debriefs = createDebriefService(d, brief, compliance);
  const drafts = createDraftService(d, debriefs, docs);
  const tasks = createTaskService(d, coverage);
  const deals = createDealService(d, book);
  const live = createLiveService(d, debriefs);
  const pricing = createPricingService(d, deals);
  const ask = createAskService(d, { brief, debriefs, today, tasks, alerts, docs, coverage, talking });
  return { book, alerts, docs, talking, coverage, health, notifications, compliance, referrals, accounts, today, brief, debriefs, drafts, tasks, deals, live, pricing, ask };
}
export type Services = ReturnType<typeof createServices>;
