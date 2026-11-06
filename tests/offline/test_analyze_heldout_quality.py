"""Offline receipt integrity and uncertainty tests using synthetic in-memory data."""

import copy
import hashlib
import importlib.util
from pathlib import Path
import sys
import unittest


SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "analyze-heldout-quality.py"
PROMPT = "Use the supplied source to write one calculation question."
PROMPT_SHA = hashlib.sha256(PROMPT.encode("utf-8")).hexdigest()
ARM = {
    "id": "synthetic-medium",
    "model": "synthetic-generator",
    "effort": "medium",
    "allowedActualModels": ["synthetic-generator"],
}


def schedule_row(index):
    return {
        "id": f"synthetic-case--synthetic-medium--r{index + 1}",
        "caseId": "synthetic-case",
        "arm": copy.deepcopy(ARM),
        "repetition": index + 1,
        "order": index,
    }


def candidate(kind="numeric", difficulty="medium"):
    return {
        "stem": "Compute the source-defined amount for {{x}}.",
        "difficulty": difficulty,
        "numericKind": kind,
        "paramSlots": [{"name": "x", "values": [2, 3]}] if kind == "numeric" else [],
        "derivedValues": [{"name": "answer", "formula": "x*2"}] if kind == "numeric" else [],
        "options": [
            {"key": "A", "text": "{{answer}}", "role": "correct", "explanation": "Apply the source rule."},
            {"key": "B", "text": "0", "role": "common-misconception", "explanation": "This omits the input."},
            {"key": "C", "text": "1", "role": "partially-correct", "explanation": "This stops before the calculation."},
            {"key": "D", "text": "-1", "role": "clearly-wrong", "explanation": "The source rule gives a positive amount."},
        ],
    }


def capture(call_id, stage="model-comparison-generator", usage="known", failed=False):
    is_generation = stage == "model-comparison-generator"
    model = ARM["model"] if is_generation else "synthetic-judge"
    prompt = PROMPT if is_generation else "Review this synthetic candidate against its source."
    options = {"model": model, "reasoning_effort": "medium", "max_completion_tokens": 8000}
    context = {"stage": stage, "jsonAttempt": 0}
    common = {
        "callId": call_id,
        "provider": "synthetic",
        "requestedModel": model,
        "startedAt": "2026-10-17T00:00:00.000Z",
        "requestOptions": copy.deepcopy(options),
        "usageContext": copy.deepcopy(context),
    }
    started = {**copy.deepcopy(common), "type": "started", "actualModel": None}
    finished = {
        **copy.deepcopy(common),
        "type": "finished",
        "actualModel": model,
        "finishedAt": "2026-10-17T00:00:00.100Z",
        "durationMs": 100,
        "outcome": "failed" if failed else "succeeded",
        "usage": None if usage != "known" else {
            "inputTokens": 100 if is_generation else 40,
            "outputTokens": 30 if is_generation else 5,
            "totalTokens": 130 if is_generation else 45,
            "totalOrigin": "provider",
            "countSource": "provider-reported",
        },
    }
    return {"transcript": {
        "stage": stage,
        "request": {"model": model, "effort": "medium", "prompt": prompt, "maxOutputTokens": 8000},
        "attempts": [{
            "number": 0,
            "input": {"prompt": prompt, "options": options, "model": model, "outputCap": 8000},
            "events": [started, finished],
        }],
        "status": "failed" if failed else "succeeded",
        "parsed": None if failed else candidate() if is_generation else {"status": "eligible"},
        "error": {"name": "APIError", "message": "Unknown error occurred while calling OpenAI API"} if failed else None,
    }}


def reviewed_cell(row, with_judge=False):
    index = row["repetition"]
    captures = [capture(f"generation-{index}")]
    if with_judge:
        captures.append(capture(f"judge-{index}", "quality-review"))
    return {
        "schedule": copy.deepcopy(row),
        "status": "reviewed",
        "generatorPromptSha256": PROMPT_SHA,
        "originalCandidate": candidate(),
        "normalizedCandidate": candidate(),
        "captures": captures,
        "deterministic": {},
        "qualityBeforeRepair": {
            "status": "eligible",
            "sourceSupport": "supported",
            "notation": "consistent",
            "novelty": "independent",
            "requestedDifficulty": "medium",
            "achievedDifficulty": "medium",
            "difficultyMismatch": False,
        },
        "eligibleBeforeRepair": True,
        "saved": False,
        "adopted": False,
    }


def receipts(recorded=1, with_judge=False):
    schedule = [schedule_row(0), schedule_row(1)]
    preflight = {
        "schedule": copy.deepcopy(schedule),
        "shards": [{
            "id": f"shard-{index + 1}",
            "cells": [copy.deepcopy(row)],
            "cellIds": [row["id"]],
        } for index, row in enumerate(schedule)],
    }
    fixture = {"cases": [{
        "id": "synthetic-case",
        "request": {"kind": "calculation", "difficulty": "medium"},
        "generatorPrompt": PROMPT,
        "generatorPromptSha256": PROMPT_SHA,
    }]}
    shards = [{
        "_id": "shard-1",
        "status": "completed",
        "cells": [reviewed_cell(schedule[0], with_judge)] if recorded else [],
    }]
    if recorded > 1:
        shards.append({
            "_id": "shard-2",
            "status": "completed",
            "cells": [reviewed_cell(schedule[1], with_judge)],
        })
    return preflight, fixture, shards


class AnalyzeHeldoutQualityTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        spec = importlib.util.spec_from_file_location("analyze_heldout_quality_under_test", SCRIPT)
        cls.analyzer = importlib.util.module_from_spec(spec)
        sys.modules[spec.name] = cls.analyzer
        spec.loader.exec_module(cls.analyzer)

    def analyze(self, data):
        return self.analyzer.analyze_loaded(*data)

    def test_missing_declared_slots_remain_visible_with_unknown_measurements(self):
        report = self.analyze(receipts(recorded=1))
        self.assertEqual(len(report["cells"]), 2)
        missing = next(row for row in report["cells"] if row["cellId"] == schedule_row(1)["id"])
        self.assertEqual(missing["recordState"], "unrecorded")
        self.assertIsNone(missing["requestedKindFulfilled"])
        self.assertIsNone(missing["difficulty"]["candidateDeclared"])
        self.assertIsNone(missing["difficulty"]["judgeAchieved"])
        self.assertIsNone(missing["difficulty"]["matchesRequested"])
        self.assertEqual(report["summary"]["recordStates"]["terminal"], 1)
        self.assertEqual(report["summary"]["recordStates"]["unrecorded"], 1)

    def test_running_cells_are_active_without_turning_missing_cells_into_failures(self):
        data = receipts(recorded=0)
        data[2][0]["status"] = "running"
        data[2][0]["cells"] = [{"schedule": schedule_row(0), "status": "pending", "captures": []}]
        report = self.analyze(data)
        rows = {row["cellId"]: row for row in report["cells"]}
        self.assertEqual(rows[schedule_row(0)["id"]]["recordState"], "active")
        self.assertEqual(rows[schedule_row(1)["id"]]["recordState"], "unrecorded")
        self.assertEqual(report["summary"]["recordStates"]["active"], 1)
        self.assertEqual(report["summary"]["recordStates"]["terminal"], 0)

    def test_missing_cell_in_terminal_shard_is_incomplete_with_unknown_measurements(self):
        report = self.analyze(receipts(recorded=0))
        rows = {row["cellId"]: row for row in report["cells"]}
        incomplete = rows[schedule_row(0)["id"]]
        self.assertEqual(incomplete["recordState"], "incomplete")
        self.assertIsNone(incomplete["requestedKindFulfilled"])
        self.assertIsNone(incomplete["difficulty"]["candidateDeclared"])
        self.assertIsNone(incomplete["difficulty"]["judgeAchieved"])
        self.assertIsNone(incomplete["difficulty"]["matchesRequested"])
        self.assertEqual(rows[schedule_row(1)["id"]]["recordState"], "unrecorded")
        self.assertEqual(report["summary"]["recordStates"]["incomplete"], 1)
        self.assertEqual(report["summary"]["recordStates"]["terminal"], 0)

    def test_unknown_provider_usage_and_absent_judge_usage_are_not_zero_cost(self):
        data = receipts(recorded=1)
        data[2][0]["cells"][0]["captures"] = [capture("generation-unknown", usage="unknown")]
        calls = self.analyze(data)["byArm"][ARM["id"]]["calls"]
        self.assertEqual(calls["generation"]["actualObservedSends"], 1)
        self.assertEqual(calls["generation"]["unknownUsageCalls"], 1)
        self.assertIsNone(calls["generation"]["knownTotalTokens"])
        self.assertIsNone(calls["generation"]["inputTokensKnownSum"])
        self.assertIsNone(calls["generation"]["outputTokensKnownSum"])
        self.assertEqual(calls["judge"]["actualObservedSends"], 0)
        self.assertIsNone(calls["judge"]["knownTotalTokens"])

    def test_duplicate_declared_or_recorded_cell_ids_are_rejected(self):
        for duplicate in ("schedule", "recorded"):
            with self.subTest(duplicate=duplicate):
                data = receipts(recorded=1)
                if duplicate == "schedule":
                    data[0]["schedule"].append(copy.deepcopy(data[0]["schedule"][0]))
                else:
                    data[2][0]["cells"].append(copy.deepcopy(data[2][0]["cells"][0]))
                with self.assertRaises(self.analyzer.ReceiptError):
                    self.analyze(data)

    def test_arm_schedule_and_actual_generator_identity_must_match_declaration(self):
        for mismatch in ("schedule-arm", "request-model"):
            with self.subTest(mismatch=mismatch):
                data = receipts(recorded=1)
                cell = data[2][0]["cells"][0]
                if mismatch == "schedule-arm":
                    cell["schedule"]["arm"]["effort"] = "high"
                else:
                    cell["captures"][0]["transcript"]["request"]["model"] = "undeclared-model"
                with self.assertRaises(self.analyzer.ReceiptError):
                    self.analyze(data)

    def test_frozen_generator_prompt_cannot_be_replaced_in_receipts(self):
        for mismatch in ("cell-hash", "request-prompt", "attempt-prompt"):
            with self.subTest(mismatch=mismatch):
                data = receipts(recorded=1)
                cell = data[2][0]["cells"][0]
                transcript = cell["captures"][0]["transcript"]
                if mismatch == "cell-hash":
                    cell["generatorPromptSha256"] = "0" * 64
                elif mismatch == "request-prompt":
                    transcript["request"]["prompt"] = "An unapproved prompt."
                else:
                    transcript["attempts"][0]["input"]["prompt"] = "An unapproved first-send prompt."
                with self.assertRaises(self.analyzer.ReceiptError):
                    self.analyze(data)

    def test_eligible_wrapper_does_not_hide_kind_or_difficulty_shortfall(self):
        data = receipts(recorded=1, with_judge=True)
        cell = data[2][0]["cells"][0]
        cell["originalCandidate"] = candidate(kind="conceptual", difficulty="medium")
        cell["normalizedCandidate"] = candidate(kind="conceptual", difficulty="medium")
        cell["qualityBeforeRepair"]["achievedDifficulty"] = "easy"
        cell["qualityBeforeRepair"]["difficultyMismatch"] = True
        report = self.analyze(data)
        row = next(row for row in report["cells"] if row["cellId"] == schedule_row(0)["id"])
        self.assertIs(row["requestedKindFulfilled"], False)
        self.assertEqual(row["difficulty"]["requested"], "medium")
        self.assertEqual(row["difficulty"]["candidateDeclared"], "medium")
        self.assertEqual(row["difficulty"]["judgeAchieved"], "easy")
        self.assertIs(row["difficulty"]["matchesRequested"], False)
        calls = report["byArm"][ARM["id"]]["calls"]
        self.assertEqual(calls["generation"]["actualObservedSends"], 1)
        self.assertEqual(calls["generation"]["knownTotalTokens"], 130)
        self.assertEqual(calls["judge"]["actualObservedSends"], 1)
        self.assertEqual(calls["judge"]["knownTotalTokens"], 45)

    def test_call_id_reuse_across_distinct_calls_is_rejected(self):
        data = receipts(recorded=2)
        second_capture = data[2][1]["cells"][0]["captures"][0]
        for event in second_capture["transcript"]["attempts"][0]["events"]:
            event["callId"] = "generation-1"
        with self.assertRaises(self.analyzer.ReceiptError):
            self.analyze(data)

    def test_terminal_failed_judge_is_transport_unavailable_not_semantic_rejection(self):
        data = receipts(recorded=1)
        cell = data[2][0]["cells"][0]
        cell["captures"].append(capture("failed-judge", "quality-review", usage="unknown", failed=True))
        cell["qualityBeforeRepair"] = {
            "status": "withheld",
            "sourceSupport": "uncertain",
            "notation": "uncertain",
            "novelty": "uncertain",
            "reasons": ["The quality review could not be completed."],
        }
        cell["eligibleBeforeRepair"] = False
        report = self.analyze(data)
        row = next(row for row in report["cells"] if row["cellId"] == schedule_row(0)["id"])
        self.assertEqual(row["recordState"], "terminal")
        self.assertEqual(row["qualityState"], "transport-unavailable")
        self.assertIsNone(row["semanticRejected"])
        self.assertIsNone(row["difficulty"]["judgeAchieved"])
        self.assertIsNone(row["difficulty"]["matchesRequested"])
        judge_calls = report["byArm"][ARM["id"]]["calls"]["judge"]
        self.assertEqual(judge_calls["actualObservedSends"], 1)
        self.assertEqual(judge_calls["unknownUsageCalls"], 1)
        self.assertIsNone(judge_calls["knownTotalTokens"])


if __name__ == "__main__":
    unittest.main()
