import { amount, whole } from './rentalForms'
import type { FinancialProfile, RentalOffer } from '../types/rental'

export type Answer = 'yes' | 'no' | 'unknown'
export type Service = 'required' | 'included' | 'optional' | 'no' | 'unknown'
export interface GuidedDraft {
  label: string; rent: string; months: string; sharing: Answer; roommate: string
  deposit: Answer; depositAmount: string; depositTreatment: 'refundable' | 'nonrefundable' | 'unknown'
  first: Answer; last: Answer
  application: Answer; applicationAmount: string; administration: Answer; administrationAmount: string
  holding: Answer; holdingAmount: string; holdingTreatment: 'credited_to_security_deposit' | 'credited_to_first_month_rent' | 'credited_to_last_month_rent' | 'credited_to_nonrefundable_fees' | 'not_credited_refundable' | 'not_credited_nonrefundable' | 'unknown'
  otherUpfront: Answer; otherUpfrontName: string; otherUpfrontAmount: string; otherUpfrontTreatment: 'refundable' | 'nonrefundable' | 'unknown'
  mandatory: Answer; mandatoryName: string; mandatoryAmount: string
  utilities: 'included' | 'estimated' | 'unknown'; utilitiesAmount: string
  internet: Service; internetAmount: string
  parkingRelevant: boolean; parking: Service; parkingAmount: string
  otherMonthly: Answer; otherMonthlyName: string; otherMonthlyAmount: string
  discount: 'none' | 'free_month' | 'credit' | 'unknown'; discountMonth: string; discountAmount: string
  finance: boolean; income: string; savings: string; essentials: string; reserve: string
  synthetic: boolean
}

export const blankGuided = (): GuidedDraft => ({
  label: '', rent: '', months: '12', sharing: 'unknown', roommate: '',
  deposit: 'unknown', depositAmount: '', depositTreatment: 'unknown', first: 'unknown', last: 'unknown',
  application: 'unknown', applicationAmount: '', administration: 'unknown', administrationAmount: '',
  holding: 'unknown', holdingAmount: '', holdingTreatment: 'unknown', otherUpfront: 'unknown', otherUpfrontName: '', otherUpfrontAmount: '', otherUpfrontTreatment: 'unknown',
  mandatory: 'unknown', mandatoryName: '', mandatoryAmount: '', utilities: 'unknown', utilitiesAmount: '',
  internet: 'unknown', internetAmount: '', parkingRelevant: false, parking: 'unknown', parkingAmount: '',
  otherMonthly: 'unknown', otherMonthlyName: '', otherMonthlyAmount: '', discount: 'unknown', discountMonth: '', discountAmount: '',
  finance: false, income: '', savings: '', essentials: '', reserve: '', synthetic: false,
})

export const sampleGuided = (): GuidedDraft => ({ ...blankGuided(), label: 'Synthetic sample rental', rent: '1600', months: '12', sharing: 'no',
  deposit: 'yes', depositAmount: '800', depositTreatment: 'refundable', first: 'yes', last: 'no',
  application: 'yes', applicationAmount: '100', administration: 'unknown', holding: 'unknown', otherUpfront: 'no',
  mandatory: 'no', utilities: 'estimated', utilitiesAmount: '130', internet: 'required', internetAmount: '40',
  otherMonthly: 'unknown', discount: 'unknown', synthetic: true,
})

export function guidedToRequest(d: GuidedDraft): { offer: RentalOffer; profile?: FinancialProfile } {
  const monthly_base_rent = amount(d.rent, 'Advertised monthly rent', true)
  const lease_term_months = whole(d.months, 'Lease length', 1, 120)
  if (d.sharing === 'yes' && d.roommate.trim() && amount(d.roommate, 'Expected roommate contribution') > monthly_base_rent) throw new Error('A roommate contribution cannot exceed the advertised rent.')
  const rental_label = d.label.trim() || 'My rental'
  if (rental_label.length > 120) throw new Error('Rental name must be at most 120 characters.')
  const fees: NonNullable<NonNullable<RentalOffer['upfront']>['nonrefundable_fees']> = []
  const other: NonNullable<NonNullable<RentalOffer['upfront']>['other_charges']> = []
  const recurring: NonNullable<RentalOffer['recurring_charges']> = []
  const addFee = (answer: Answer, raw: string, name: string) => { if (answer === 'yes') fees.push({ name, amount: amount(raw, name, true) }) }
  addFee(d.application, d.applicationAmount, 'Application fee')
  addFee(d.administration, d.administrationAmount, 'Administration fee')
  if (d.deposit === 'yes' && d.depositTreatment === 'nonrefundable') addFee('yes', d.depositAmount, 'Nonrefundable deposit')
  if (d.otherUpfront === 'yes' && d.otherUpfrontTreatment !== 'unknown') {
    const name = d.otherUpfrontName.trim()
    if (!name) throw new Error('Name the other move-in payment.')
    other.push({ name, amount: amount(d.otherUpfrontAmount, 'Other move-in payment', true), refundable: d.otherUpfrontTreatment === 'refundable' })
  }
  const addRecurring = (active: boolean, raw: string, name: string) => { if (active) recurring.push({ name, monthly_amount: amount(raw, name, true) }) }
  if (d.mandatory === 'yes') {
    if (!d.mandatoryName.trim()) throw new Error('Name the mandatory monthly fee.')
    addRecurring(true, d.mandatoryAmount, d.mandatoryName.trim())
  }
  addRecurring(d.internet === 'required', d.internetAmount, 'Internet')
  addRecurring(d.parkingRelevant && d.parking === 'required', d.parkingAmount, 'Parking')
  if (d.otherMonthly === 'yes') {
    if (!d.otherMonthlyName.trim()) throw new Error('Name the other monthly charge.')
    addRecurring(true, d.otherMonthlyAmount, d.otherMonthlyName.trim())
  }
  if (new Set(recurring.map(item => item.name.toLowerCase())).size !== recurring.length) throw new Error('Monthly charge names must be unique.')
  const concessions: NonNullable<RentalOffer['concessions']> = []
  if (d.discount === 'free_month' || d.discount === 'credit') {
    const month = whole(d.discountMonth, 'Discount month', 1, lease_term_months)
    concessions.push(d.discount === 'free_month' ? { kind: 'free_rent_month', month } : { kind: 'rent_credit', month, amount: amount(d.discountAmount, 'Rent credit', true) })
  }
  const depositKnown = d.deposit === 'yes' && d.depositTreatment !== 'unknown'
  const holdingKnown = d.holding === 'yes' && d.holdingTreatment !== 'unknown'
  const offer: RentalOffer = {
    rental_label, monthly_base_rent, lease_term_months,
    expected_roommate_contribution: d.sharing === 'no' ? { status: 'none' } : d.sharing === 'yes' && d.roommate.trim() ? { status: 'provided', amount: amount(d.roommate, 'Expected roommate contribution') } : { status: 'unknown' },
    recurring_charges: recurring,
    recurring_charges_status: [d.mandatory, d.otherMonthly].every(x => x !== 'unknown') && d.internet !== 'unknown' && (!d.parkingRelevant || d.parking !== 'unknown') ? 'complete' : 'unknown',
    utilities: d.utilities === 'included' ? { status: 'included_in_rent' } : d.utilities === 'estimated' ? { status: 'estimated', estimated_monthly_amount: amount(d.utilitiesAmount, 'Estimated utilities') } : { status: 'unknown' },
    upfront: {
      security_deposit: depositKnown && d.depositTreatment === 'refundable' ? { status: 'provided', amount: amount(d.depositAmount, 'Security deposit') } : { status: d.deposit === 'no' || (depositKnown && d.depositTreatment === 'nonrefundable') ? 'none' : 'unknown' },
      first_month_rent_due_upfront: d.first, last_month_rent_due_upfront: d.last,
      nonrefundable_fees: fees,
      nonrefundable_fees_status: d.application !== 'unknown' && d.administration !== 'unknown' && d.deposit !== 'unknown' && !(d.deposit === 'yes' && d.depositTreatment === 'unknown') ? 'complete' : 'unknown',
      other_charges: other,
      other_charges_status: d.otherUpfront !== 'unknown' && !(d.otherUpfront === 'yes' && d.otherUpfrontTreatment === 'unknown') ? 'complete' : 'unknown',
      holding_deposit_status: holdingKnown ? 'provided' : d.holding === 'no' ? 'none' : 'unknown',
      ...(holdingKnown ? { holding_deposit: { amount: amount(d.holdingAmount, 'Holding deposit', true), treatment: d.holdingTreatment } } : {}),
    }, concessions,
  }
  const profile = d.finance ? {
    monthly_take_home_income: amount(d.income, 'Monthly take-home pay', true), available_savings: amount(d.savings, 'Available savings'),
    essential_monthly_nonhousing_expenses: amount(d.essentials, 'Essential nonhousing expenses'), student_loan_included_in_essential_expenses: true,
    ...(d.reserve.trim() ? { minimum_emergency_cash_reserve: amount(d.reserve, 'Emergency savings reserve') } : {}),
  } : undefined
  return { offer, profile }
}

export function guidedQuestions(d: GuidedDraft): string[] {
  const questions: string[] = []
  if (d.deposit === 'unknown' || d.depositTreatment === 'unknown' && d.deposit === 'yes') questions.push('Is there a security deposit, and is it refundable under the agreement?')
  if (d.application === 'unknown' || d.administration === 'unknown') questions.push('Are there application or administration fees beyond the advertised rent?')
  if (d.holding === 'unknown' || d.otherUpfront === 'unknown') questions.push('Is a holding deposit or another move-in payment required, and how is it treated?')
  if (d.first === 'unknown' || d.last === 'unknown') questions.push('When are the first and last months of rent due?')
  if (d.mandatory === 'unknown' || d.otherMonthly === 'unknown' || d.internet === 'unknown' || d.utilities === 'unknown' || (d.parkingRelevant && d.parking === 'unknown')) questions.push('Are utilities or mandatory service fees charged in addition to rent?')
  if (d.discount === 'unknown') questions.push('Is any advertised discount guaranteed, and which month does it cover?')
  if (d.sharing !== 'no' && !d.roommate.trim()) questions.push('How much will a roommate actually contribute each month?')
  questions.push('What happens financially if you end the lease early?')
  return questions
}
