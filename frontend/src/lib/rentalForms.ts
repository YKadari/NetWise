import type { Concession, FinancialProfile, RentalOffer } from '../types/rental'

export function money(value: number | null | undefined): string {
  return value === null || value === undefined || !Number.isFinite(value) ? 'Unknown' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(value)
}

export function amount(raw: string, name: string, positive = false): number {
  const value = Number(raw)
  if (!raw.trim() || !Number.isFinite(value) || value < 0 || (positive && value === 0) || Math.round(value * 100) / 100 !== value || value > 1_000_000_000) {
    throw new Error(`${name} must be ${positive ? 'greater than zero' : 'zero or greater'} and have at most two decimal places.`)
  }
  return value
}

export function whole(raw: string, name: string, min: number, max: number): number {
  const value = Number(raw)
  if (!raw.trim() || !Number.isInteger(value) || value < min || value > max) throw new Error(`${name} must be a whole number from ${min} to ${max}.`)
  return value
}

export interface ChargeDraft { name: string; amount: string }
export interface ConcessionDraft { kind: Concession['kind']; month: string; amount: string; eligible_category: 'base_rent' | 'recurring_charge' | 'utilities'; eligible_charge_name: string }
export interface ManualDraft {
  label: string; rent: string; months: string
  depositStatus: 'provided' | 'none' | 'unknown'; deposit: string
  firstPrepaid: 'yes' | 'no' | 'unknown'; lastPrepaid: 'yes' | 'no' | 'unknown'
  recurringStatus: 'complete' | 'unknown'; recurring: ChargeDraft[]
  utilityStatus: 'included_in_rent' | 'estimated' | 'unknown'; utilities: string
  feeStatus: 'complete' | 'unknown'; fees: ChargeDraft[]
  concessions: ConcessionDraft[]
  roommateStatus: 'provided' | 'none' | 'unknown'; roommate: string
  holdingStatus: 'none' | 'unknown'
}

export const blankManual = (): ManualDraft => ({
  label: '', rent: '', months: '12', depositStatus: 'unknown', deposit: '', firstPrepaid: 'unknown', lastPrepaid: 'unknown',
  recurringStatus: 'unknown', recurring: [], utilityStatus: 'unknown', utilities: '', feeStatus: 'unknown', fees: [],
  concessions: [], roommateStatus: 'unknown', roommate: '', holdingStatus: 'unknown',
})

export function offerToManual(offer: RentalOffer): ManualDraft {
  return { label: offer.rental_label, rent: String(offer.monthly_base_rent), months: String(offer.lease_term_months),
    depositStatus: offer.upfront?.security_deposit?.status ?? 'unknown', deposit: String(offer.upfront?.security_deposit?.amount ?? ''),
    firstPrepaid: offer.upfront?.first_month_rent_due_upfront ?? 'unknown', lastPrepaid: offer.upfront?.last_month_rent_due_upfront ?? 'unknown',
    recurringStatus: offer.recurring_charges_status ?? 'unknown', recurring: (offer.recurring_charges ?? []).map(item => ({ name: item.name, amount: String(item.monthly_amount) })),
    utilityStatus: offer.utilities?.status ?? 'unknown', utilities: String(offer.utilities?.estimated_monthly_amount ?? ''),
    feeStatus: offer.upfront?.nonrefundable_fees_status ?? 'unknown', fees: (offer.upfront?.nonrefundable_fees ?? []).map(item => ({ name: item.name, amount: String(item.amount) })),
    concessions: (offer.concessions ?? []).map(item => ({ kind: item.kind, month: String(item.month), amount: String(item.amount ?? ''), eligible_category: item.eligible_category ?? 'base_rent', eligible_charge_name: item.eligible_charge_name ?? '' })),
    roommateStatus: offer.expected_roommate_contribution?.status ?? 'unknown', roommate: String(offer.expected_roommate_contribution?.amount ?? ''),
    holdingStatus: offer.upfront?.holding_deposit_status === 'none' ? 'none' : 'unknown',
  }
}

export function manualToOffer(form: ManualDraft): RentalOffer {
  if (!form.label.trim()) throw new Error('Give this rental a label.')
  if (form.label.trim().length > 120) throw new Error('Rental label must be at most 120 characters.')
  const lease_term_months = whole(form.months, 'Lease duration', 1, 120)
  const recurring_charges = form.recurring.map((item, index) => ({ name: item.name.trim(), monthly_amount: amount(item.amount, `Recurring fee ${index + 1}`, true) }))
  const nonrefundable_fees = form.fees.map((item, index) => ({ name: item.name.trim(), amount: amount(item.amount, `Move-in charge ${index + 1}`, true) }))
  if ([...recurring_charges, ...nonrefundable_fees].some(item => !item.name)) throw new Error('Name each listed charge or remove the empty row.')
  if (new Set(recurring_charges.map(item => item.name.toLowerCase())).size !== recurring_charges.length) throw new Error('Recurring fee names must be unique.')
  const concessions: Concession[] = form.concessions.map((item, index) => {
    const base = { kind: item.kind, month: whole(item.month, `Concession ${index + 1} month`, 1, lease_term_months), eligible_category: item.kind === 'free_rent_month' ? 'base_rent' as const : item.eligible_category }
    if (item.kind === 'free_rent_month') return base
    const eligible_charge_name = item.eligible_category === 'recurring_charge' ? item.eligible_charge_name.trim() : undefined
    if (item.eligible_category === 'recurring_charge' && !recurring_charges.some(charge => charge.name.toLowerCase() === eligible_charge_name?.toLowerCase())) throw new Error('Name an existing recurring fee for its concession.')
    return { ...base, amount: amount(item.amount, `Concession ${index + 1} amount`, true), ...(eligible_charge_name ? { eligible_charge_name } : {}) }
  })
  return {
    rental_label: form.label.trim(), monthly_base_rent: amount(form.rent, 'Monthly rent', true), lease_term_months,
    recurring_charges, recurring_charges_status: form.recurringStatus,
    utilities: form.utilityStatus === 'estimated' ? { status: 'estimated', estimated_monthly_amount: amount(form.utilities, 'Estimated utilities') } : { status: form.utilityStatus },
    expected_roommate_contribution: form.roommateStatus === 'provided' ? { status: 'provided', amount: amount(form.roommate, 'Expected roommate contribution') } : { status: form.roommateStatus },
    upfront: {
      security_deposit: form.depositStatus === 'provided' ? { status: 'provided', amount: amount(form.deposit, 'Security deposit') } : { status: form.depositStatus },
      first_month_rent_due_upfront: form.firstPrepaid, last_month_rent_due_upfront: form.lastPrepaid,
      nonrefundable_fees, nonrefundable_fees_status: form.feeStatus, other_charges: [], other_charges_status: 'complete', holding_deposit_status: form.holdingStatus,
    }, concessions,
  }
}

export interface ProfileDraft {
  income: string; savings: string; essentials: string; loan: string; loanIncluded: boolean; target: string; roommate: string; reserve: string
}
export const blankProfile = (): ProfileDraft => ({ income: '', savings: '', essentials: '', loan: '', loanIncluded: true, target: '', roommate: '', reserve: '' })
export function profileToRequest(form: ProfileDraft): FinancialProfile {
  return {
    monthly_take_home_income: amount(form.income, 'Monthly take-home pay', true),
    available_savings: amount(form.savings, 'Available savings'),
    essential_monthly_nonhousing_expenses: amount(form.essentials, 'Essential nonhousing expenses'),
    student_loan_included_in_essential_expenses: form.loanIncluded,
    ...(form.loanIncluded || !form.loan.trim() ? {} : { student_loan_payment: amount(form.loan, 'Separate student loan payment') }),
    ...(!form.target.trim() ? {} : { monthly_savings_target: amount(form.target, 'Savings target') }),
    ...(!form.roommate.trim() ? {} : { expected_roommate_contribution: amount(form.roommate, 'Profile roommate contribution') }),
    ...(!form.reserve.trim() ? {} : { minimum_emergency_cash_reserve: amount(form.reserve, 'Emergency reserve') }),
  }
}

export const demoProfile: ProfileDraft = { income: '4500', savings: '8000', essentials: '1800', loan: '300', loanIncluded: false, target: '500', roommate: '', reserve: '2000' }
export const demoOffers: [RentalOffer, RentalOffer] = [
  { rental_label: 'Synthetic Scenario A', monthly_base_rent: 1450, lease_term_months: 12, recurring_charges: [{ name: 'Parking', monthly_amount: 150 }, { name: 'Pet rent', monthly_amount: 50 }], recurring_charges_status: 'complete', utilities: { status: 'estimated', estimated_monthly_amount: 180 }, upfront: { security_deposit: { status: 'provided', amount: 2000 }, first_month_rent_due_upfront: 'yes', last_month_rent_due_upfront: 'yes', nonrefundable_fees: [{ name: 'Administration fee', amount: 400 }], nonrefundable_fees_status: 'complete', other_charges_status: 'complete', holding_deposit_status: 'none' } },
  { rental_label: 'Synthetic Scenario B', monthly_base_rent: 1600, lease_term_months: 12, recurring_charges: [{ name: 'Internet', monthly_amount: 40 }], recurring_charges_status: 'complete', utilities: { status: 'estimated', estimated_monthly_amount: 130 }, upfront: { security_deposit: { status: 'provided', amount: 800 }, first_month_rent_due_upfront: 'yes', last_month_rent_due_upfront: 'no', nonrefundable_fees: [{ name: 'Application fee', amount: 100 }], nonrefundable_fees_status: 'complete', other_charges_status: 'complete', holding_deposit_status: 'none' } },
]

export const syntheticLeaseText = `SYNTHETIC DEMO LEASE EXCERPT - no real tenant or property.\nThe monthly base rent is $1,600. The lease lasts 12 months. The security deposit is $800. The first month's rent is due before move-in; the last month's rent is not prepaid. Internet costs $40 per month. Estimated utilities are $130 per month. There is a nonrefundable $100 application fee.`
