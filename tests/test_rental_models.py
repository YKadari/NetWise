import pytest
from pydantic import ValidationError

from backend.app.rental.models import FinancialProfile, RentalOffer, TermProvenance


def complete_offer(**changes):
    value = {
        "rental_label": "Synthetic A",
        "monthly_base_rent": 1000,
        "lease_term_months": 3,
        "recurring_charges": [],
        "recurring_charges_status": "complete",
        "utilities": {"status": "included_in_rent"},
        "upfront": {
            "security_deposit": {"status": "none"},
            "first_month_rent_due_upfront": "no",
            "last_month_rent_due_upfront": "no",
            "nonrefundable_fees_status": "complete",
            "other_charges_status": "complete",
            "holding_deposit_status": "none",
        },
    }
    value.update(changes)
    return value


def test_explicit_none_unknown_and_provided_upfront_terms_are_distinct():
    offer = RentalOffer.model_validate(complete_offer())
    assert offer.upfront.security_deposit.status == "none"
    unknown = RentalOffer.model_validate(complete_offer(upfront={"holding_deposit_status": "unknown"}))
    assert unknown.upfront.holding_deposit_status == "unknown"
    with pytest.raises(ValidationError):
        RentalOffer.model_validate(complete_offer(upfront={"holding_deposit_status": "provided"}))


@pytest.mark.parametrize("value", [-1, float("nan"), float("inf"), "1000", True])
def test_money_rejects_negative_nonfinite_strings_and_booleans(value):
    with pytest.raises(ValidationError):
        RentalOffer.model_validate(complete_offer(monthly_base_rent=value))


def test_cents_rounding_and_strict_required_fields():
    offer = RentalOffer.model_validate(complete_offer(monthly_base_rent=10.235))
    assert str(offer.monthly_base_rent) == "10.24"
    with pytest.raises(ValidationError):
        RentalOffer.model_validate({"rental_label": "Missing rent", "lease_term_months": 12})
    with pytest.raises(ValidationError):
        RentalOffer.model_validate(complete_offer(lease_term_months=True))


def test_extracted_provenance_requires_review_before_confirmation():
    with pytest.raises(ValidationError, match="explicit user review"):
        TermProvenance(source_type="document_extracted", review_state="confirmed", confidence=0.98)
    reviewed = TermProvenance(source_type="document_extracted", review_state="corrected", source_reference="page 2")
    assert reviewed.source_reference == "page 2"


def test_utility_state_and_concession_terms_are_validated():
    with pytest.raises(ValidationError):
        RentalOffer.model_validate(complete_offer(utilities={"status": "estimated"}))
    with pytest.raises(ValidationError):
        RentalOffer.model_validate(complete_offer(concessions=[{"kind": "rent_credit", "month": 4, "amount": 100}]))
    with pytest.raises(ValidationError):
        RentalOffer.model_validate(complete_offer(concessions=[{"kind": "free_rent_month", "month": 1, "amount": 100}]))


def test_profile_rejects_bad_cash_inputs_and_models_student_loan_inclusion():
    profile = FinancialProfile(monthly_take_home_income=3000, available_savings=5000, essential_monthly_nonhousing_expenses=1000, student_loan_payment=200, student_loan_included_in_essential_expenses=True)
    assert profile.student_loan_included_in_essential_expenses is True
    with pytest.raises(ValidationError):
        FinancialProfile(monthly_take_home_income=0, available_savings=0, essential_monthly_nonhousing_expenses=0)
