#!/usr/bin/env python3
"""Analyze frozen local held-out receipts without importing application runtime.

This script performs no model, network or database operations. Terminal execution,
semantic assessment, requested supply and provider accounting are separate axes.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from statistics import median


class ReceiptError(ValueError):
    """A receipt cannot be reconciled with the declared experiment."""


TERMINAL_SHARDS = {"completed", "failed", "stopped"}
TERMINAL_CELLS = {"reviewed", "generation-failed", "invalid-candidate", "budget-stopped", "identity-stopped"}


def sha256(value: bytes | str) -> str:
    return hashlib.sha256(value.encode("utf-8") if isinstance(value, str) else value).hexdigest()


def canonical_hash(value: object) -> str:
    # The observed receipt keys are ASCII and the experiment JSON contains finite
    # numbers. This is checked against stored candidate hashes when available.
    return sha256(json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False))


def require(condition: object, message: str) -> None:
    if not condition:
        raise ReceiptError(message)


def finite(value: object) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def known_sum(values: list) -> int | float | None:
    known = [value for value in values if finite(value)]
    return sum(known) if known else None


def nullable_counts(values: list) -> dict:
    return {"true": sum(v is True for v in values), "false": sum(v is False for v in values),
            "unknown": sum(v is not True and v is not False for v in values)}


def stage_group(stage: str) -> str:
    if stage == "model-comparison-generator":
        return "generation"
    if stage.startswith("quality-"):
        return "judge"
    return "other"


def call_totals(calls: list[dict]) -> dict:
    totals = [c.get("usage", {}).get("totalTokens") for c in calls]
    durations = [c.get("durationMs") for c in calls if finite(c.get("durationMs"))]
    return {"actualObservedSends": len(calls), "knownTotalTokens": known_sum(totals),
            "unknownUsageCalls": sum(not finite(v) for v in totals),
            "completeUsage": all(finite(v) for v in totals) if calls else None,
            "inputTokensKnownSum": known_sum([c.get("usage", {}).get("inputTokens") for c in calls]),
            "outputTokensKnownSum": known_sum([c.get("usage", {}).get("outputTokens") for c in calls]),
            "reasoningTokensKnownSum": known_sum([c.get("usage", {}).get("reasoningTokens") for c in calls]),
            "reasoningAccounting": "Reasoning tokens are a subset of output tokens, never an additional charge added to output totals.",
            "outputAtDeclaredCapCalls": sum(finite(c.get("usage", {}).get("outputTokens")) and finite((c.get("requestOptions") or {}).get("max_completion_tokens"))
                                            and c["usage"]["outputTokens"] >= c["requestOptions"]["max_completion_tokens"] for c in calls),
            "capInterpretation": "Output at the cap is a diagnostic cue; finish reason was not retained by the historical observer, so truncation is not established by this count alone.",
            "knownUsageCalls": sum(finite(v) for v in totals),
            "durationMsKnownSum": sum(durations) if durations else None,
            "durationMsMedian": median(durations) if durations else None,
            "knownDurationCalls": len(durations),
            "unknownDurationCalls": len(calls) - len(durations),
            "outcomes": dict(Counter(c.get("outcome", "unknown") for c in calls)),
            "measurement": "observed SDK invocations; hidden SDK retries and wire requests remain unknown"}


def reconcile_captures(cell: dict, declared: dict, case: dict, preflight: dict,
                       seen_call_ids: set[str]) -> tuple[list[dict], list[dict]]:
    calls, captures = [], []
    for entry in cell.get("captures", []):
        transcript = entry.get("transcript", {})
        request = transcript.get("request", {})
        stage = transcript.get("stage", "unknown")
        group = stage_group(stage)
        arm = declared["arm"]
        if group == "generation":
            require(request.get("model") == arm["model"], "generator request model differs from declared arm")
            require(request.get("effort") == arm.get("effort"), "generator effort differs from declared arm")
            require(request.get("prompt") == case.get("generatorPrompt"), "generator prompt differs from pinned fixture")
        fixed = preflight.get("_declaration", {}).get("fixedJudge")
        if group == "judge" and fixed:
            require(request.get("model") == fixed["model"], "judge model differs from declaration")
            require(request.get("effort") == fixed.get("reasoningEffort"), "judge effort differs from declaration")
        cap = preflight.get("generatorOutputCap" if group == "generation" else "judgeOutputCap")
        if cap is not None and group in {"generation", "judge"}:
            require(request.get("maxOutputTokens") == cap, "captured output cap differs from declared cap")
        attempts = []
        for index, attempt in enumerate(transcript.get("attempts", [])):
            actual_input = attempt.get("input", {})
            options = actual_input.get("options", {})
            if index == 0 and actual_input.get("prompt") is not None:
                require(actual_input["prompt"] == request.get("prompt"), "initial actual prompt differs from request")
            if actual_input.get("model") is not None:
                require(actual_input["model"] == request.get("model"), "actual input model differs from request")
            if options.get("model") is not None:
                require(options["model"] == request.get("model"), "actual options model differs from request")
            if "reasoning_effort" in options:
                require(options["reasoning_effort"] == request.get("effort"), "actual effort differs from captured request")
            if "max_completion_tokens" in options:
                require(options["max_completion_tokens"] == request.get("maxOutputTokens"), "actual output cap differs from request")
            events_by_id = defaultdict(list)
            for event in attempt.get("events", []):
                if event.get("type") not in {"started", "finished"}:
                    continue
                require(isinstance(event.get("callId"), str), "observed call lacks callId")
                events_by_id[event["callId"]].append(event)
            for call_id, events in events_by_id.items():
                require(call_id not in seen_call_ids, "duplicate callId across distinct attempts or captures")
                seen_call_ids.add(call_id)
                started = [e for e in events if e["type"] == "started"]
                finished = [e for e in events if e["type"] == "finished"]
                require(len(started) <= 1 and len(finished) <= 1, "duplicate native lifecycle event")
                final = finished[0] if finished else {}
                for event in events:
                    if event.get("requestedModel") is not None:
                        require(event["requestedModel"] == request.get("model"), "native requested model differs from request")
                    actual = event.get("actualModel")
                    allowed = request.get("allowedActualModels")
                    if actual is not None and allowed:
                        require(actual in allowed, "observed actual model outside captured allowlist")
                    native_options = event.get("requestOptions", {})
                    for key in ("reasoning_effort", "max_completion_tokens", "responseFormat"):
                        if key in native_options and key in options:
                            require(native_options[key] == options[key], "native options differ from captured actual options")
                calls.append({"callId": call_id, "cellId": declared["id"], "armId": arm["id"],
                              "stage": stage, "group": group, "requestedModel": request.get("model"),
                              "actualModel": final.get("actualModel"), "responseId": final.get("responseId"),
                              "startedAt": (started[0] if started else final).get("startedAt"),
                              "finishedAt": final.get("finishedAt"), "durationMs": final.get("durationMs"),
                              "outcome": final.get("outcome", "pending"), "usage": final.get("usage") or {},
                              "requestOptions": (started[0] if started else final).get("requestOptions"),
                              "sawStarted": bool(started), "sawFinished": bool(finished)})
            attempts.append({"number": attempt.get("number"), "dispatch": attempt.get("dispatch"),
                             "inputSha256Recorded": attempt.get("inputSha256"),
                             "promptSha256": sha256(actual_input["prompt"]) if isinstance(actual_input.get("prompt"), str) else None,
                             "options": options, "outputCap": actual_input.get("outputCap"),
                             "effortPropertyPresent": "reasoning_effort" in options,
                             "observedCallIds": list(events_by_id),
                             "dispatchUnknown": not bool(events_by_id)})
        captures.append({"stage": stage, "group": group, "file": entry.get("file"),
                         "status": transcript.get("status"), "error": transcript.get("error"),
                         "elapsedMs": transcript.get("elapsedMs"), "startedAt": transcript.get("startedAt"),
                         "requestPromptSha256": sha256(request["prompt"]) if isinstance(request.get("prompt"), str) else None,
                         "requestModel": request.get("model"), "requestEffort": request.get("effort"),
                         "requestOutputCap": request.get("maxOutputTokens"), "attempts": attempts})
    return calls, captures


def analyze_loaded(preflight: dict, fixture: dict, shards: list[dict], source_audit: dict | None = None,
                   unresolved_assessments: set[str] | None = None) -> dict:
    """Pure reconciliation for production-shaped documents; no filesystem access."""
    schedule = preflight.get("schedule", [])
    declared = {row["id"]: row for row in schedule}
    require(len(schedule) == len(declared), "duplicate declared schedule IDs")
    cases = {case["id"]: case for case in fixture.get("cases", [])}
    require(len(cases) == len(fixture.get("cases", [])), "duplicate fixture case IDs")
    membership = {}
    for shard in preflight.get("shards", []):
        for cell_id in shard.get("cellIds", [c["id"] for c in shard.get("cells", [])]):
            require(cell_id in declared and cell_id not in membership, "unknown or duplicate declared shard membership")
            membership[cell_id] = shard["id"]
    shard_map = {shard["_id"]: shard for shard in shards}
    require(len(shard_map) == len(shards), "duplicate shard receipt IDs")
    observed = {}
    for shard in shards:
        for cell in shard.get("cells", []):
            cell_id = cell.get("schedule", {}).get("id")
            require(cell_id in declared, "receipt cell outside declared schedule")
            require(cell_id not in observed, "duplicate receipt cell IDs")
            require(cell["schedule"] == declared[cell_id], "cell schedule or arm differs from declaration")
            require(not membership or membership[cell_id] == shard["_id"], "cell recorded in wrong shard")
            observed[cell_id] = (shard, cell)
    rubric = {cell["cellId"]: cell for cell in (source_audit or {}).get("cells", [])}
    seen_calls, rows, all_calls = set(), [], []
    for expected in schedule:
        case = cases.get(expected["caseId"])
        require(case is not None, "scheduled case missing from frozen fixture")
        expected_prompt_hash = case.get("generatorPromptSha256")
        if expected_prompt_hash:
            require(sha256(case["generatorPrompt"]) == expected_prompt_hash, "pinned prompt hash mismatch")
        pair = observed.get(expected["id"])
        own_shard = pair[0] if pair else shard_map.get(membership.get(expected["id"]))
        cell = pair[1] if pair else None
        state = "unrecorded"
        if own_shard:
            if own_shard.get("status") not in TERMINAL_SHARDS:
                state = "active"
            elif own_shard.get("_selected", True) is False:
                state = "out-of-scope"
            elif cell and cell.get("status") in TERMINAL_CELLS:
                state = "terminal"
            else:
                state = "incomplete"
        row = {"cellId": expected["id"], "caseId": expected["caseId"], "arm": expected["arm"],
               "repetition": expected.get("repetition"), "shardId": membership.get(expected["id"]),
               "recordState": state, "executionCellStatus": cell.get("status") if cell else None,
               "requestedKindFulfilled": None, "generationParsed": None, "schemaRetained": None,
               "numericState": "unrecorded", "qualityState": "unrecorded", "semanticRejected": None,
               "combinedLabEligible": None, "difficulty": {"requested": case.get("request", {}).get("difficulty"),
               "candidateDeclared": None, "judgeAchieved": None, "matchesRequested": None},
               "requestedKind": case.get("request", {}).get("kind"), "candidateNumericKind": None,
               "calls": [], "captures": [], "sourceRubric": None, "teacherAcceptance": None}
        if state != "terminal":
            rows.append(row)
            continue
        for key in ("generatorPromptSha256", "controlsSha256"):
            cell_key = "inputControlsSha256" if key == "controlsSha256" else key
            if case.get(key) and cell.get(cell_key):
                require(case[key] == cell[cell_key], "cell control identity differs from fixture")
        calls, captures = reconcile_captures(cell, expected, case, preflight, seen_calls)
        all_calls.extend(calls)
        gens = [e.get("transcript", {}) for e in cell.get("captures", [])
                if e.get("transcript", {}).get("stage") == "model-comparison-generator"]
        raw = next((t.get("parsed") for t in gens if isinstance(t.get("parsed"), dict)), None)
        candidate = cell.get("normalizedCandidate") or raw
        parsed = bool(raw) if gens else None
        schema = bool(cell.get("normalizedCandidate")) if raw or cell.get("status") == "invalid-candidate" else None
        quality = cell.get("qualityBeforeRepair") or {}
        judge_captures = [t for t in captures if t["group"] == "judge"]
        judge_success = any(t.get("transcript", {}).get("status") == "succeeded" and
                            isinstance(t.get("transcript", {}).get("parsed"), dict)
                            for t in cell.get("captures", []) if stage_group(t.get("transcript", {}).get("stage", "")) == "judge")
        judge_transport_failure = bool(judge_captures) and not judge_success and any(t["status"] == "failed" for t in judge_captures)
        if expected["id"] in (unresolved_assessments or set()):
            # A parsed first reply does not complete a review whose required
            # citation/schema correction subsequently lost transport.
            quality_state = "transport-unavailable" if any(t["status"] == "failed" for t in judge_captures) else "assessment-incomplete"
        elif judge_transport_failure:
            quality_state = "transport-unavailable"
        elif judge_success and quality:
            quality_state = "assessed"
        elif quality:
            quality_state = "assessment-unverified"
        else:
            quality_state = "unrecorded"
        numerics = (cell.get("deterministic") or {}).get("numerics")
        numeric_state = "unrecorded"
        if candidate and candidate.get("numericKind") == "conceptual":
            numeric_state = "not-applicable"
        elif numerics:
            numeric_state = "failed" if numerics.get("failure") else "verified" if numerics.get("fields", {}).get("verification") else "proof-unavailable"
        achieved = quality.get("achievedDifficulty") if quality_state == "assessed" else None
        requested = row["difficulty"]["requested"]
        source = rubric.get(expected["id"])
        if source:
            require(raw is not None and canonical_hash(raw) == source.get("generatorParsedCandidateSha256"),
                    "independent source audit candidate identity mismatch")
        row.update({"generationParsed": parsed, "schemaRetained": schema, "numericState": numeric_state,
                    "qualityState": quality_state,
                    "semanticRejected": quality.get("status") == "withheld" if quality_state == "assessed" else None,
                    "combinedLabEligible": cell.get("eligibleBeforeRepair"),
                    "requestedKindFulfilled": (candidate.get("numericKind") == ("numeric" if row["requestedKind"] == "calculation" else "conceptual")) if candidate and row["requestedKind"] in {"calculation", "conceptual"} else None,
                    "candidateNumericKind": candidate.get("numericKind") if candidate else None,
                    "numericFailure": numerics.get("failure") if numerics else None,
                    "variationFailure": (cell.get("deterministic") or {}).get("variation"),
                    "evidenceLeakFailure": (cell.get("deterministic") or {}).get("evidenceLeak"),
                    "difficulty": {"requested": requested, "candidateDeclared": candidate.get("difficulty") if candidate else None,
                                   "judgeAchieved": achieved, "matchesRequested": achieved == requested if achieved and requested else None},
                    "sourceRubric": source.get("independentRubric") if source else None,
                    "error": cell.get("error"), "judgeRecordedStatus": quality.get("status"),
                    "judgeSourceSupport": quality.get("sourceSupport"), "judgeNotation": quality.get("notation"),
                    "judgeNovelty": quality.get("novelty"), "judgeReasons": quality.get("reasons"),
                    "judgeChanges": quality.get("changes"), "calls": calls, "captures": captures,
                    "candidateSha256": canonical_hash(candidate) if candidate else None,
                    "savedRecorded": cell.get("saved"), "adoptedRecorded": cell.get("adopted")})
        rows.append(row)
    by_arm = {}
    for arm in dict.fromkeys(r["arm"]["id"] for r in rows):
        group = [r for r in rows if r["arm"]["id"] == arm]
        arm_calls = [c for c in all_calls if c["armId"] == arm]
        by_arm[arm] = {"declaredCells": len(group), "recordStates": dict(Counter(r["recordState"] for r in group)),
                       "generationParsed": nullable_counts([r["generationParsed"] for r in group]),
                       "schemaRetained": nullable_counts([r["schemaRetained"] for r in group]),
                       "requestedKindFulfilled": nullable_counts([r["requestedKindFulfilled"] for r in group]),
                       "qualityStates": dict(Counter(r["qualityState"] for r in group)),
                       "semanticRejected": nullable_counts([r["semanticRejected"] for r in group]),
                       "combinedLabEligible": nullable_counts([r["combinedLabEligible"] for r in group]),
                       "requestedDifficultyMatched": nullable_counts([r["difficulty"]["matchesRequested"] for r in group]),
                       "calls": {kind: call_totals([c for c in arm_calls if c["group"] == kind]) for kind in ("generation", "judge", "other")}}
    pairs = []
    grouped = defaultdict(list)
    for row in rows:
        grouped[(row["caseId"], row["arm"]["id"])].append(row)
    for (case_id, arm), group in grouped.items():
        group.sort(key=lambda r: r["repetition"] or 0)
        if len(group) < 2:
            continue
        pairs.append({"caseId": case_id, "armId": arm, "cellIds": [r["cellId"] for r in group],
                      "bothGenerationParsed": all(r["generationParsed"] is True for r in group),
                      "bothSemanticAssessed": all(r["qualityState"] == "assessed" for r in group),
                      "sameDeclaredArm": all(r["arm"] == group[0]["arm"] for r in group),
                      "samePinnedGeneratorPrompt": True,
                      "bothGenerationUsageKnown": all(any(c["group"] == "generation" and finite(c.get("usage", {}).get("totalTokens")) for c in r["calls"]) for r in group),
                      "bothJudgeUsageKnown": all(any(c["group"] == "judge" and finite(c.get("usage", {}).get("totalTokens")) for c in r["calls"]) for r in group),
                      "sameObservedInitialGenerationOptions": (lambda options: all(v == options[0] for v in options) if len(options) == len(group) else None)([
                          c["attempts"][0]["options"] for r in group for c in r["captures"]
                          if c["group"] == "generation" and c["attempts"]]),
                      "comparableForSemanticOutcome": all(r["qualityState"] == "assessed" for r in group)})
    states = Counter(r["recordState"] for r in rows)
    summary = {"declaredCells": len(schedule), "recordStates": {k: states[k] for k in ("terminal", "active", "incomplete", "unrecorded", "out-of-scope")},
               "generationParsed": nullable_counts([r["generationParsed"] for r in rows]),
               "schemaRetained": nullable_counts([r["schemaRetained"] for r in rows]),
               "numericStates": dict(Counter(r["numericState"] for r in rows)),
               "qualityStates": dict(Counter(r["qualityState"] for r in rows)),
               "semanticRejected": nullable_counts([r["semanticRejected"] for r in rows]),
               "combinedLabEligible": nullable_counts([r["combinedLabEligible"] for r in rows]),
               "requestedKindFulfilled": nullable_counts([r["requestedKindFulfilled"] for r in rows]),
               "requestedDifficultyMatched": nullable_counts([r["difficulty"]["matchesRequested"] for r in rows]),
               "calls": {kind: call_totals([c for c in all_calls if c["group"] == kind]) for kind in ("generation", "judge", "other")},
               "allObservedSdkCalls": call_totals(all_calls), "teacherAcceptance": None, "savedByAnalyzer": 0, "adoptedByAnalyzer": 0}
    summary["recordedSaved"] = nullable_counts([r.get("savedRecorded") for r in rows])
    summary["recordedAdopted"] = nullable_counts([r.get("adoptedRecorded") for r in rows])
    summary["unobservedAttemptDispatches"] = sum(a["dispatchUnknown"] for r in rows for c in r["captures"] for a in c["attempts"])
    shard_reconciliation = []
    for shard in shards:
        if not shard.get("_selected", True) or shard.get("status") not in TERMINAL_SHARDS:
            continue
        own = [c for row in rows if row["shardId"] == shard["_id"] for c in row["calls"]]
        calculated = call_totals(own)
        reported = shard.get("usage") or {}
        for reported_key, calculated_key in (("observedCalls", "actualObservedSends"), ("totalTokens", "knownTotalTokens"),
                                             ("inputTokens", "inputTokensKnownSum"), ("outputTokens", "outputTokensKnownSum")):
            if reported.get(reported_key) is not None:
                require(reported[reported_key] == calculated[calculated_key], "native aggregate differs from exact SDK lifecycle receipts")
        shard_reconciliation.append({"shardId": shard["_id"], "executionStatus": shard.get("status"),
                                     "wallElapsedMs": shard.get("elapsedMs"), "nativeAggregateUsage": reported or None,
                                     "calculatedSdkUsage": calculated, "reportedNonNullValuesMatched": True})
    return {"version": 1, "summary": summary, "byArm": by_arm, "cells": rows,
            "shardReconciliation": shard_reconciliation,
            "pairedComparability": {"pairs": pairs, "declaredPairs": len(pairs),
                                    "bothGenerationParsed": sum(p["bothGenerationParsed"] for p in pairs),
                                    "bothSemanticAssessed": sum(p["bothSemanticAssessed"] for p in pairs),
                                    "causalBeforeAfterComparison": False,
                                    "interpretation": "Repetitions of one frozen protocol, not old/new treatment arms. Transport-unavailable or absent judgments cannot establish quality degradation."},
            "modelRankingClaim": False, "teacherAcceptance": None}


def read_json(path: Path, snapshots: list[dict]) -> dict:
    raw = path.read_bytes()
    snapshots.append({"path": str(path.resolve()), "sha256": sha256(raw), "bytes": len(raw)})
    return json.loads(raw)


def analyze_snapshot(phase_dir: Path, terminal_shards: list[str] | None = None,
                     source_audit_path: Path | None = None) -> dict:
    root = phase_dir.resolve()
    snapshots = []
    controls = read_json(root / "preflight/controls.json", snapshots)
    preflight = read_json(root / "preflight/preflight.json", snapshots)
    declaration = read_json(root / "declaration.json", snapshots)
    preflight["_declaration"] = declaration
    require(controls.get("scheduleSha256") == preflight.get("scheduleSha256"), "control schedule hash differs")
    require(declaration.get("scheduleSha256") == preflight.get("scheduleSha256"), "declaration schedule hash differs")
    require(controls.get("phase", {}).get("sha256") == snapshots[-1]["sha256"], "phase declaration byte hash differs")
    fixture_path = root / "live/shard-1/fixture.json"
    fixture = read_json(fixture_path, snapshots)
    require(fixture.get("fixtureSha256") == preflight.get("fixtureSha256"), "fixture identity differs")
    shards, code_sets = [], []
    known_ids = {s["id"] for s in preflight["shards"]}
    if terminal_shards:
        require(len(terminal_shards) == len(set(terminal_shards)), "duplicate selected shard")
        require(set(terminal_shards) <= known_ids, "unknown selected shard")
    for declared in preflight["shards"]:
        result_path = root / "live" / declared["id"] / "results.json"
        if not result_path.exists():
            continue
        shard = read_json(result_path, snapshots)
        shard["_id"] = declared["id"]
        shard["_selected"] = terminal_shards is None or declared["id"] in terminal_shards
        if terminal_shards and shard["_selected"]:
            require(shard["status"] in TERMINAL_SHARDS, "selected shard is not terminal")
        require(shard.get("fixtureSha256") == fixture.get("fixtureSha256"), "shard fixture identity differs")
        require(shard.get("scheduleSha256") == declared.get("scheduleSha256"), "shard schedule identity differs")
        if shard["_selected"] and shard["status"] in TERMINAL_SHARDS:
            code = []
            for source in shard.get("code", []):
                file_path = Path(source["snapshot"]).resolve()
                require(file_path.is_relative_to(root), "code snapshot outside phase directory")
                actual = sha256(file_path.read_bytes())
                require(actual == source["sha256"], "code snapshot byte hash differs")
                code.append({"file": source["file"], "sha256": actual})
            code_sets.append(code)
            for cell in shard.get("cells", []):
                for entry in cell.get("captures", []):
                    capture_path = Path(entry["file"]).resolve()
                    require(capture_path.is_relative_to(root), "capture outside phase directory")
                    capture = read_json(capture_path, snapshots)
                    require(capture == entry["transcript"], "embedded transcript differs from exact receipt file")
        shards.append(shard)
    if terminal_shards:
        require(set(terminal_shards) <= {s["_id"] for s in shards}, "selected shard receipt missing")
    source_audit = read_json(source_audit_path, snapshots) if source_audit_path else None
    report = analyze_loaded(preflight, fixture, shards, source_audit)
    report.update({"createdAt": datetime.now(timezone.utc).isoformat(),
                   "scope": {"phaseDirectory": str(root), "terminalShardIdsAnalyzed": [s["_id"] for s in shards if s["_selected"] and s["status"] in TERMINAL_SHARDS],
                             "declaredScheduleSha256": preflight["scheduleSha256"], "fixtureSha256": fixture["fixtureSha256"],
                             "allExecutionShardsTerminal": len(shards) == len(preflight["shards"]) and all(s["status"] in TERMINAL_SHARDS for s in shards),
                             "semanticAssessmentComplete": all(r["qualityState"] == "assessed" for r in report["cells"]),
                             "schedule": preflight["schedule"], "fixedJudge": declaration.get("fixedJudge")},
                   "controls": {"files": snapshots, "codeSnapshots": code_sets[0] if code_sets else [],
                                "allSelectedShardCodeIdentical": all(c == code_sets[0] for c in code_sets) if code_sets else None,
                                "analyzer": {"path": str(Path(__file__).resolve()), "sha256": sha256(Path(__file__).read_bytes())}},
                   "offline": {"providerCalls": 0, "networkCalls": 0, "databaseCalls": 0, "applicationRuntimeImported": False},
                   "limitations": ["Execution terminality does not establish complete semantic assessment.",
                                   "Native withheld/uncertain wrappers after failed judge transport are classified transport-unavailable, not semantic rejection.",
                                   "Known token sums exclude unknown usage; null never means zero provider cost. Hidden SDK retries and embeddings remain outside these receipts.",
                                   "Call-duration sums are observed SDK time, not user-facing parallel wall time or cold end-to-end latency.",
                                   "Generated, schema-retained, numeric-verified, judge-eligible, requested-kind-fulfilled and difficulty-matched are separate denominators.",
                                   "Independent chart fallback labels join only exact audited candidate IDs/hashes; they are not generalized to another repetition.",
                                   "No causal before/after or general model ranking follows from a provider-outage-confounded repetition.",
                                   "Teacher acceptance and live saved/adopted yield are not measured; the analyzer itself saves/adopts zero questions."]})
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    parser.add_argument("--phase-dir", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--terminal-shards", nargs="+", default=None)
    parser.add_argument("--source-audit", type=Path)
    args = parser.parse_args()
    report = analyze_snapshot(args.phase_dir, args.terminal_shards, args.source_audit)
    with args.output.open("x", encoding="utf-8") as stream:
        json.dump(report, stream, ensure_ascii=False, indent=2, allow_nan=False)
        stream.write("\n")
    print(json.dumps({"output": str(args.output), "sha256": sha256(args.output.read_bytes()), "summary": report["summary"]}, indent=2))


if __name__ == "__main__":
    main()
