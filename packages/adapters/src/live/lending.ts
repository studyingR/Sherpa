/** Live lending/deposit system skeletons (M9): nCino, ACBS, core deposits, PrecisionLender. */
import {
  NotImplementedError,
  UpstreamUnavailableError,
  type AcbsAdapter,
  type CoreDepositsAdapter,
  type LoanRecord,
  type NcinoAdapter,
  type PrecisionLenderAdapter,
} from '../interfaces';
import type { LiveConfig } from './index';

interface NcinoLoanDto {
  loanId: string;
  relationshipId: string;
  productName: string;
  commitmentAmount: number;
  outstandingBalance: number;
  riskGrade: { current: number; previous?: number; effectiveDate?: string };
  maturityDate: string;
  renewalInProgress: boolean;
  asOfDate: string;
}

export function mapNcinoLoan(d: NcinoLoanDto): LoanRecord {
  return {
    id: d.loanId,
    accountId: d.relationshipId,
    product: d.productName,
    commitment: d.commitmentAmount,
    outstanding: d.outstandingBalance,
    riskRating: d.riskGrade.current,
    prevRiskRating: d.riskGrade.previous ?? null,
    ratingChangedAt: d.riskGrade.effectiveDate ?? null,
    maturityDate: d.maturityDate,
    renewalOppOpen: d.renewalInProgress,
    asOf: d.asOfDate,
  };
}

function client(system: string, baseUrl: string, apiKey: string, fetchImpl: typeof fetch) {
  return async function call<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetchImpl(`${baseUrl}${path}`, { ...init, headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' } });
    if (res.status >= 500) throw new UpstreamUnavailableError(system);
    if (!res.ok) throw new Error(`${system} ${res.status}`);
    return (await res.json()) as T;
  };
}

export function createLiveLending(cfg: LiveConfig, fetchImpl: typeof fetch) {
  const ncinoCall = client('nCino', cfg.ncino.baseUrl, cfg.ncino.apiKey, fetchImpl);
  const acbsCall = client('ACBS', cfg.acbs.baseUrl, cfg.acbs.apiKey, fetchImpl);
  const depCall = client('CoreDeposits', cfg.coreDeposits.baseUrl, cfg.coreDeposits.apiKey, fetchImpl);
  const plCall = client('PrecisionLender', cfg.precisionLender.baseUrl, cfg.precisionLender.apiKey, fetchImpl);
  const ni = (m: string) => async () => {
    throw new NotImplementedError(m);
  };

  const ncino: NcinoAdapter = {
    async getLoans(_ctx, accountId) {
      const r = await ncinoCall<{ loans: NcinoLoanDto[] }>(`/relationships/${encodeURIComponent(accountId)}/loans`);
      return r.loans.map(mapNcinoLoan);
    },
    async createDraftRequest(_ctx, payload) {
      // Draft only: the endpoint creates a request in "Draft — RM review" status. No submit call exists.
      const r = await ncinoCall<{ requestId: string; status: string }>(`/credit-requests/drafts`, { method: 'POST', body: JSON.stringify(payload) });
      return { id: r.requestId, status: r.status };
    },
    getCovenants: ni('nCino.getCovenants'),
    getTicklers: ni('nCino.getTicklers'),
    getRiskRating: ni('nCino.getRiskRating'),
    getSpreads: ni('nCino.getSpreads'),
    markTickler: ni('nCino.markTickler'),
  };
  const acbs: AcbsAdapter = {
    async getFacilityBalances(_ctx, accountId) {
      const r = await acbsCall<{ facilities: { facilityNumber: string; outstanding: number; commitment: number; asOf: string }[] }>(`/customers/${encodeURIComponent(accountId)}/facilities`);
      return r.facilities.map((f) => ({ facilityId: f.facilityNumber, outstanding: f.outstanding, commitment: f.commitment, asOf: f.asOf }));
    },
    getUtilizationHistory: ni('ACBS.getUtilizationHistory'),
  };
  const deposits: CoreDepositsAdapter = {
    async getBalances(_ctx, accountId) {
      const r = await depCall<{ ledgerBalance: number; asOfDate: string }>(`/relationships/${encodeURIComponent(accountId)}/balance`);
      return { balance: r.ledgerBalance, asOf: r.asOfDate };
    },
    getBalanceHistory: ni('CoreDeposits.getBalanceHistory'),
    getTreasuryProducts: ni('CoreDeposits.getTreasuryProducts'),
  };
  const precisionLender: PrecisionLenderAdapter = {
    async getRelationshipProfitability(_ctx, accountId) {
      const r = await plCall<{ raroc: number; trailingRevenue: number; depositCreditBps: number; asOf: string }>(`/relationships/${encodeURIComponent(accountId)}/profitability`);
      return { raroc: r.raroc, revenue12m: r.trailingRevenue, depositSpreadCredit: r.depositCreditBps, asOf: r.asOf };
    },
    getPricingGuidance: ni('PrecisionLender.getPricingGuidance'),
  };
  return { ncino, acbs, deposits, precisionLender };
}
