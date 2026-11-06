"""Transport-overlay integrity tests with synthetic receipts and no runtime."""
import copy
import importlib.util
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[2]


def load(name, file):
    spec = importlib.util.spec_from_file_location(name, file)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


M = load("recovery_under_test", ROOT / "scripts/analyze-heldout-recovery.py")
F = load("receipt_fixtures", ROOT / "tests/offline/test_analyze_heldout_quality.py")


def fixture(operation="review-retained"):
    preflight, teaching, shards = F.receipts(2, with_judge=True)
    old = shards[1]["cells"][0]
    if operation == "review-retained":
        old["captures"][-1] = F.capture("failed-old-judge", "quality-review", usage="unknown", failed=True)
    else:
        old.update(originalCandidate=None, normalizedCandidate=None, deterministic=None, status="generation-failed")
        old["captures"] = [F.capture("failed-old-generation", usage="unknown", failed=True)]
    old["eligibleBeforeRepair"] = False
    old["qualityBeforeRepair"] = {"status": "withheld", "sourceSupport": "uncertain"}
    gap = {"id": old["schedule"]["id"], "schedule": copy.deepcopy(old["schedule"]), "operation": operation, "originalCellHash": M.native_control_hashes([old])[0]}
    new = {"id": gap["id"], "operation": operation, "status": "reviewed", "originalCandidate": F.candidate(), "normalizedCandidate": F.candidate(),
           "deterministic": {} if operation == "review-retained" else {"numerics": {"fields": {"verification": {"version": 1}}}},
           "quality": {"status": "eligible", "achievedDifficulty": "medium"}, "eligible": True,
           "captures": [F.capture("new-judge", "quality-review")], "error": None}
    if operation != "review-retained":
        new["captures"].insert(0, F.capture("new-generation"))
        hashes = M.native_control_hashes([new["originalCandidate"], new["normalizedCandidate"]])
        new["deterministic"].update(originalHash=hashes[0], normalizedHash=hashes[1])
    controls = {"originalCells": copy.deepcopy([c for s in shards for c in s["cells"]]), "proof": {"plan": {"recoveryCells": [gap]}}}
    recovery = {"status": "completed", "saved": 0, "adopted": 0, "recoveredCells": [new]}
    return preflight, teaching, shards, controls, recovery


class HeldoutRecoveryTests(unittest.TestCase):
    def merge(self, data):
        return M.merge_overlay(*data)

    def test_retained_success_and_transport_failure_bytes_survive(self):
        data = fixture()
        before = copy.deepcopy(data[2])
        merged, cohorts = self.merge(data)
        self.assertEqual(data[2], before)
        self.assertEqual(merged[0]["cells"], before[0]["cells"])
        self.assertEqual(merged[1]["cells"][0]["captures"][:2], before[1]["cells"][0]["captures"])
        self.assertEqual(cohorts[data[4]["recoveredCells"][0]["id"]]["generationCohort"], "original")

    def test_recovered_assessment_is_known_but_prior_unknown_cost_remains(self):
        data = fixture()
        merged, _ = self.merge(data)
        result = M.BASE.analyze_loaded(data[0], data[1], merged)
        self.assertEqual(result["summary"]["qualityStates"], {"assessed": 2})
        self.assertEqual(result["summary"]["allObservedSdkCalls"]["actualObservedSends"], 5)
        self.assertEqual(result["summary"]["allObservedSdkCalls"]["unknownUsageCalls"], 1)

    def test_review_only_may_not_regenerate_or_change_retained_candidate(self):
        for field in ("originalCandidate", "normalizedCandidate", "deterministic"):
            data = fixture()
            data[4]["recoveredCells"][0][field] = {"tampered": True}
            with self.assertRaises(M.BASE.ReceiptError):
                self.merge(data)
        data = fixture()
        data[4]["recoveredCells"][0]["captures"].insert(0, F.capture("illegal-redraw"))
        with self.assertRaises(M.BASE.ReceiptError):
            self.merge(data)

    def test_generation_success_after_original_connection_failure_has_later_cohort(self):
        data = fixture("generate-then-review")
        merged, cohorts = self.merge(data)
        report = M.BASE.analyze_loaded(data[0], data[1], merged)
        self.assertEqual(report["summary"]["generationParsed"]["true"], 2)
        self.assertEqual(cohorts[data[4]["recoveredCells"][0]["id"]]["generationCohort"], "transport-recovery")

    def test_stopped_generation_with_pending_state_retains_failed_call(self):
        data = fixture("generate-then-review")
        data[4]["status"] = "stopped"
        row = data[4]["recoveredCells"][0]
        row.update(status="pending", originalCandidate=None, normalizedCandidate=None, deterministic=None, eligible=None, quality=None,
                   captures=[F.capture("new-failure", usage="unknown", failed=True)])
        merged, _ = self.merge(data)
        result = M.BASE.analyze_loaded(data[0], data[1], merged)
        self.assertEqual(len(merged[1]["cells"][0]["captures"]), 2)
        self.assertEqual(result["summary"]["allObservedSdkCalls"]["unknownUsageCalls"], 2)
        self.assertIsNone(result["cells"][1]["combinedLabEligible"])

    def test_pending_may_not_hide_successful_generation(self):
        data = fixture("generate-then-review")
        data[4]["status"] = "stopped"
        data[4]["recoveredCells"][0].update(status="pending", originalCandidate=None, normalizedCandidate=None, eligible=None)
        with self.assertRaises(M.BASE.ReceiptError):
            self.merge(data)

    def test_completed_recovery_cannot_hide_unresolved_work(self):
        data = fixture("generate-then-review")
        data[4]["recoveredCells"][0].update(status="generated", eligible=None)
        with self.assertRaises(M.BASE.ReceiptError):
            self.merge(data)

    def test_membership_and_historical_cell_hash_must_match(self):
        for field, value in (("id", "foreign"), ("operation", "unexpected")):
            data = fixture()
            data[4]["recoveredCells"][0][field] = value
            with self.assertRaises(M.BASE.ReceiptError):
                self.merge(data)
        data = fixture()
        data[3]["proof"]["plan"]["recoveryCells"][0]["originalCellHash"] = "0" * 64
        with self.assertRaises(M.BASE.ReceiptError):
            self.merge(data)

    def test_known_semantic_negative_cannot_enter_transport_recovery(self):
        data = fixture()
        old = data[2][1]["cells"][0]
        old["captures"][-1] = F.capture("successful-negative", "quality-review")
        data[3]["originalCells"][-1] = copy.deepcopy(old)
        data[3]["proof"]["plan"]["recoveryCells"][0]["originalCellHash"] = M.native_control_hashes([old])[0]
        with self.assertRaises(M.BASE.ReceiptError):
            self.merge(data)

    def test_kind_and_difficulty_mismatch_do_not_count_as_strict_supply(self):
        data = fixture()
        merged, cohorts = self.merge(data)
        report = M.BASE.analyze_loaded(data[0], data[1], merged)
        teaching = copy.deepcopy(data[1])
        teaching["cases"].append({"id": "chart-negative"})
        teaching["heldoutBoundary"] = {"cases": [{"id": "synthetic-case", "safetyNegative": False}, {"id": "chart-negative", "safetyNegative": True}]}
        report["cells"][0]["requestedKindFulfilled"] = False
        report["cells"][1]["difficulty"]["matchesRequested"] = False
        result = M.requested_supply(report, teaching, cohorts)
        arm = result["byArm"][F.ARM["id"]]
        self.assertEqual(arm["positiveLabEligible"], 2)
        self.assertEqual(arm["positiveStrictRequestedSupply"], 0)

    def test_required_correction_fault_is_unavailable_even_after_parsed_judgment(self):
        data = fixture()
        data[4]["status"] = "stopped"
        row = data[4]["recoveredCells"][0]
        row.update(status="generated", eligible=None, quality={"status": "withheld"})
        row["captures"].append(F.capture("failed-new-correction", "quality-review", usage="unknown", failed=True))
        merged, _ = self.merge(data)
        report = M.BASE.analyze_loaded(data[0], data[1], merged, unresolved_assessments={row["id"]})
        self.assertEqual(report["cells"][1]["qualityState"], "transport-unavailable")
        self.assertIsNone(report["cells"][1]["semanticRejected"])
        self.assertEqual(report["pairedComparability"]["bothSemanticAssessed"], 0)

    def test_native_control_hash_uses_experiment_key_order_and_number_format(self):
        value = {"maxTokens": 1.0, "max_completion_tokens": 1e-7, "A": -0.0, "a": "é"}
        self.assertNotEqual(M.native_control_hashes([value])[0], M.BASE.canonical_hash(value))

    def test_large_unicode_control_hash_is_stable_across_input_chunks(self):
        value = {"text": "source evidence · 租赁现金流 📐 é " * 20000}
        expected = M.BASE.canonical_hash(value)
        for _ in range(3):
            self.assertEqual(M.native_control_hashes([value]), [expected])

    def test_new_candidate_cannot_replace_the_captured_raw_generation(self):
        data = fixture("generate-then-review")
        data[4]["recoveredCells"][0]["originalCandidate"]["stem"] = "Different output"
        with self.assertRaises(M.BASE.ReceiptError):
            self.merge(data)

    def test_check_binding_and_final_eligibility_cannot_be_relabelled(self):
        data = fixture("generate-then-review")
        data[4]["recoveredCells"][0]["deterministic"]["normalizedHash"] = "0" * 64
        with self.assertRaises(M.BASE.ReceiptError):
            self.merge(data)
        data = fixture()
        data[4]["recoveredCells"][0]["quality"]["status"] = "withheld"
        with self.assertRaises(M.BASE.ReceiptError):
            self.merge(data)

    def test_reasoning_tokens_are_reported_separately_without_double_counting(self):
        calls = [{"usage": {"inputTokens": 10, "outputTokens": 100, "reasoningTokens": 80, "totalTokens": 110},
                  "requestOptions": {"max_completion_tokens": 100}}]
        totals = M.BASE.call_totals(calls)
        self.assertEqual(totals["knownTotalTokens"], 110)
        self.assertEqual(totals["outputTokensKnownSum"], 100)
        self.assertEqual(totals["reasoningTokensKnownSum"], 80)
        self.assertEqual(totals["outputAtDeclaredCapCalls"], 1)


if __name__ == "__main__":
    unittest.main()
