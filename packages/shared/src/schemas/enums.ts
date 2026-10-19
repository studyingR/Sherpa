import { z } from 'zod';

export const Segment = z.enum(['COMMERCIAL', 'SMALL_BUSINESS']);
export type Segment = z.infer<typeof Segment>;

export const CoverageTier = z.enum(['A', 'B', 'C']);
export type CoverageTier = z.infer<typeof CoverageTier>;

export const Source = z.enum([
  'SALESFORCE',
  'NCINO',
  'ACBS',
  'CORE_DEPOSITS',
  'PRECISION_LENDER',
  'NEWS',
  'CALENDAR',
  'SHERPA',
  'KYC',
]);
export type Source = z.infer<typeof Source>;

export const Role = z.enum(['RM', 'ANALYST', 'LEADER', 'COMPLIANCE']);
export type Role = z.infer<typeof Role>;

export const Specialty = z.enum([
  'TREASURY_MANAGEMENT',
  'FX',
  'WEALTH',
  'SBA',
  'CAPITAL_MARKETS',
  'EQUIPMENT_FINANCE',
  'MERCHANT_SERVICES',
]);
export type Specialty = z.infer<typeof Specialty>;

export const MeetingType = z.enum(['IN_PERSON', 'VIRTUAL', 'PHONE', 'SITE_VISIT']);
export type MeetingType = z.infer<typeof MeetingType>;

export const Purpose = z.enum([
  'ANNUAL_REVIEW',
  'NEW_CREDIT',
  'RENEWAL',
  'TREASURY_REVIEW',
  'CHECK_IN',
  'ISSUE_RESOLUTION',
  'OTHER',
]);
export type Purpose = z.infer<typeof Purpose>;

export const AlertRule = z.enum([
  'MATURITY_APPROACHING',
  'COVENANT_TEST_DUE',
  'COVENANT_BREACH_RISK',
  'FINANCIALS_PAST_DUE',
  'UTILIZATION_SWING',
  'DEPOSIT_OUTFLOW',
  'RISK_RATING_DOWNGRADE',
]);
export type AlertRule = z.infer<typeof AlertRule>;

export const Severity = z.enum(['INFO', 'WARN', 'CRITICAL']);
export type Severity = z.infer<typeof Severity>;

export const Channel = z.enum(['APP', 'PHONE', 'CHAT']);
export type Channel = z.infer<typeof Channel>;

export const Mode = z.enum(['DEBRIEF', 'BRIEF', 'ASK', 'DEAL', 'AGENDA', 'LIVE']);
export type Mode = z.infer<typeof Mode>;

export const DealProduct = z.enum(['TERM_LOAN', 'LINE_OF_CREDIT', 'EQUIPMENT', 'CRE', 'SBA_7A', 'SBA_504']);
export type DealProduct = z.infer<typeof DealProduct>;

export const DocumentType = z.enum([
  'FINANCIAL_STATEMENT',
  'TAX_RETURN',
  'COMPLIANCE_CERT',
  'INSURANCE',
  'BORROWING_BASE',
  'KYC_REFRESH',
]);
export type DocumentType = z.infer<typeof DocumentType>;

export const SPECIALTY_LABEL: Record<Specialty, string> = {
  TREASURY_MANAGEMENT: 'Treasury Management',
  FX: 'FX',
  WEALTH: 'Wealth',
  SBA: 'SBA',
  CAPITAL_MARKETS: 'Capital Markets',
  EQUIPMENT_FINANCE: 'Equipment Finance',
  MERCHANT_SERVICES: 'Merchant Services',
};

export const SOURCE_LABEL: Record<Source, string> = {
  SALESFORCE: 'Salesforce',
  NCINO: 'nCino',
  ACBS: 'ACBS',
  CORE_DEPOSITS: 'Core deposits',
  PRECISION_LENDER: 'PrecisionLender',
  NEWS: 'News',
  CALENDAR: 'Calendar',
  SHERPA: 'Sherpa',
  KYC: 'KYC',
};

export const PURPOSE_LABEL: Record<Purpose, string> = {
  ANNUAL_REVIEW: 'Annual review',
  NEW_CREDIT: 'New credit',
  RENEWAL: 'Renewal',
  TREASURY_REVIEW: 'Treasury review',
  CHECK_IN: 'Check-in',
  ISSUE_RESOLUTION: 'Issue resolution',
  OTHER: 'Other',
};

export const DEAL_PRODUCT_LABEL: Record<DealProduct, string> = {
  TERM_LOAN: 'Term loan',
  LINE_OF_CREDIT: 'Line of credit',
  EQUIPMENT: 'Equipment financing',
  CRE: 'Commercial real estate',
  SBA_7A: 'SBA 7(a)',
  SBA_504: 'SBA 504',
};

export const DOCUMENT_TYPE_LABEL: Record<DocumentType, string> = {
  FINANCIAL_STATEMENT: 'Financial statements',
  TAX_RETURN: 'Tax return',
  COMPLIANCE_CERT: 'Compliance certificate',
  INSURANCE: 'Insurance certificate',
  BORROWING_BASE: 'Borrowing base certificate',
  KYC_REFRESH: 'KYC refresh',
};

/** Internal teams that can own next steps or receive handoffs (docs/07 §1). */
export const INTERNAL_TEAMS = [
  'Treasury Services',
  'Credit Admin',
  'Portfolio Management',
  'FX Desk',
  'Wealth',
  'SBA Desk',
  'Capital Markets',
  'Equipment Finance',
  'Merchant Services',
] as const;
export type InternalTeam = (typeof INTERNAL_TEAMS)[number];
