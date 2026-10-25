"""Strict final consent for stateless, verified PDF recomputation."""
from __future__ import annotations

from typing import Annotated
from pydantic import BaseModel, ConfigDict, Field, StrictBool, StrictStr, model_validator

Digest = Annotated[StrictStr, Field(pattern=r"^[0-9a-f]{64}$")]
CandidateId = Annotated[StrictStr, Field(pattern=r"^region-[0-9]{4,8}$")]


class RedactedPdfApproval(BaseModel):
    model_config = ConfigDict(extra="forbid")

    document_digest: Digest
    approved_pdf_digest: Digest
    candidate_ids: list[CandidateId] = Field(max_length=2000)
    consent_to_gemini: StrictBool
    acknowledge_no_candidates: StrictBool = False

    @model_validator(mode="after")
    def explicit_consent_and_unique_regions(self):
        if self.consent_to_gemini is not True:
            raise ValueError("Explicit consent is required")
        if len(self.candidate_ids) != len(set(self.candidate_ids)):
            raise ValueError("Candidate identifiers must be unique")
        return self
