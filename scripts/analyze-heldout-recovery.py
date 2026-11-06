#!/usr/bin/env python3
"""Reconcile a transport-only overlay without rewriting historical receipts.

This file-only analysis keeps original failed-call costs, separates acquisition
cohorts, and measures requested supply independently from a model's eligibility.
"""
from __future__ import annotations

import argparse
import copy
import importlib.util
import json
import subprocess
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

SPEC = importlib.util.spec_from_file_location("heldout_receipt_analyzer", Path(__file__).with_name("analyze-heldout-quality.py"))
BASE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(BASE)
require = BASE.require

# Match the experiment's ECMAScript number/string serialization and localeCompare
# key order. Python sort_keys differs on mixed-case/underscore option names.
# This fixed trusted code executes no receipt/model text and imports only crypto.
HASH_PROGRAM = r"""
import { createHash } from 'node:crypto';
process.stdin.setEncoding('utf8');
let input = ''; for await (const chunk of process.stdin) input += chunk;
function canonical(v) {
  if (v === null || ['string', 'boolean'].includes(typeof v)) return JSON.stringify(v);
  if (typeof v === 'number' && Number.isFinite(v)) return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => JSON.stringify(k) + ':' + canonical(x)).join(',') + '}';
  throw new Error('non-json-control');
}
process.stdout.write(JSON.stringify(JSON.parse(input).map(v => createHash('sha256').update(canonical(v)).digest('hex'))));
"""


def native_control_hashes(values: list) -> list[str]:
    result = subprocess.run(["node", "--input-type=module", "-e", HASH_PROGRAM],
                            input=json.dumps(values, ensure_ascii=False, allow_nan=False), text=True,
                            capture_output=True, check=True, timeout=30)
    return json.loads(result.stdout)


def merge_overlay(preflight: dict, fixture: dict, shards: list[dict], controls: dict, recovery: dict) -> tuple[list[dict], dict]:
    """Pure merge. Old failures and every prior success remain in the evidence."""
    require(recovery.get("status") in {"completed", "stopped"}, "recovery is not terminal")
    require(recovery.get("saved") == 0 and recovery.get("adopted") == 0, "unexpected saved/adopted mutations")
    original = {c["schedule"]["id"]: c for s in shards for c in s["cells"]}
    require(len(original) == len(preflight["schedule"]), "original schedule incomplete")
    require(controls.get("originalCells") == list(original.values()), "recovery controls changed historical cells")
    gaps = controls["proof"]["plan"]["recoveryCells"]
    targets = {g["id"]: g for g in gaps}
    require(len(targets) == len(gaps), "duplicate recovery target")
    rows = {r["id"]: r for r in recovery["recoveredCells"]}
    require(len(rows) == len(recovery["recoveredCells"]) and set(rows) == set(targets), "recovery target membership differs")
    hashes = dict(zip(targets, native_control_hashes([original[g] for g in targets])))
    merged = copy.deepcopy(shards)
    provenance = {}
    for shard in merged:
        # These are an analytical view, never a replacement for an execution
        # receipt or its original aggregate usage / wall-clock measurement.
        shard.pop("usage", None)
        shard.pop("elapsedMs", None)
        for cell in shard["cells"]:
            cell_id = cell["schedule"]["id"]
            provenance[cell_id] = {"generationCohort": "original", "assessmentCohort": "original", "recoveryRequired": cell_id in targets}
            if cell_id not in targets:
                continue
            gap, row, old = targets[cell_id], rows[cell_id], original[cell_id]
            require(hashes[cell_id] == gap["originalCellHash"], "original recovery cell hash differs")
            require(gap["schedule"] == old["schedule"], "recovery schedule differs")
            require(gap["operation"] == row["operation"], "recovery operation differs")
            last = old["captures"][-1]["transcript"]
            require(last["status"] == "failed" and last.get("parsed") is None, "recovery replaced a completed response")
            require(last.get("error", {}).get("name") == "APIError", "recovery replaced a content/identity failure")
            require(last.get("error", {}).get("message") in {"Connection error.", "Unknown error occurred while calling OpenAI API"}, "recovery replaced a non-transport error")
            finished = [e for a in last["attempts"] for e in a["events"] if e["type"] == "finished"]
            require(len(finished) == 1 and finished[0]["outcome"] == "failed", "historical failure is not a single transport attempt")
            require(row["status"] in {"pending", "generated", "invalid-candidate", "reviewed"}, "unknown recovery state")
            if gap["operation"] == "review-retained":
                require(old.get("normalizedCandidate") is not None, "review recovery lost its retained candidate")
                for key in ("originalCandidate", "normalizedCandidate", "deterministic"):
                    require(row.get(key) == old.get(key), "review recovery changed retained candidate or checks")
                require(all(e["transcript"]["stage"] != "model-comparison-generator" for e in row["captures"]), "review-only cell regenerated")
            else:
                require(gap["operation"] == "generate-then-review", "unsupported recovery operation")
                require(old.get("originalCandidate") is None and old.get("normalizedCandidate") is None, "generation recovery replaced existing content")
                if row["captures"]:
                    provenance[cell_id]["generationCohort"] = "transport-recovery"
                generated = [e["transcript"] for e in row["captures"] if e["transcript"]["stage"] == "model-comparison-generator"]
                require(len(generated) <= 1, "recovery repeated a logical generation")
                if row.get("originalCandidate") is not None:
                    require(len(generated) == 1 and generated[0]["status"] == "succeeded" and generated[0]["parsed"] == row["originalCandidate"], "recovery candidate differs from captured generation")
                if row.get("normalizedCandidate") is not None:
                    check = row.get("deterministic") or {}
                    expected = native_control_hashes([row["originalCandidate"], row["normalizedCandidate"]])
                    require(check.get("originalHash") == expected[0] and check.get("normalizedHash") == expected[1], "normalized candidate/check binding differs")
            if row["status"] == "reviewed":
                check, quality = row.get("deterministic") or {}, row.get("quality") or {}
                expected_eligible = quality.get("status") == "eligible" and not (check.get("numerics") or {}).get("failure") and not check.get("variation") and not check.get("evidenceLeak")
                require(row.get("eligible") is expected_eligible, "eligibility differs from recorded checks")
            cell["captures"].extend(copy.deepcopy(row["captures"]))
            if any(e["transcript"]["stage"].startswith("quality-") for e in row["captures"]):
                provenance[cell_id]["assessmentCohort"] = "transport-recovery"
            if row["status"] == "pending":
                # A transport exception stops the runner before generation can
                # advance this state. Its failed invocation and unknown cost
                # still belong in the analytical view.
                require(gap["operation"] == "generate-then-review", "retained review cannot be pending")
                require(row.get("originalCandidate") is None and row.get("normalizedCandidate") is None and row.get("eligible") is None, "pending recovery claims content or eligibility")
                require(all(e["transcript"]["status"] == "failed" and e["transcript"].get("parsed") is None for e in row["captures"]), "pending cell contains successful content")
                cell["eligibleBeforeRepair"] = None
                continue
            for key in ("originalCandidate", "normalizedCandidate", "deterministic"):
                cell[key] = copy.deepcopy(row.get(key))
            cell["qualityBeforeRepair"] = copy.deepcopy(row.get("quality"))
            cell["eligibleBeforeRepair"] = row.get("eligible")
            cell["error"] = copy.deepcopy(row.get("error"))
            cell["status"] = "invalid-candidate" if row["status"] == "invalid-candidate" else "reviewed" if row.get("normalizedCandidate") else "generation-failed"
            if row["status"] != "reviewed":
                require(row.get("eligible") in (None, False), "unreviewed recovered candidate claims eligibility")
    if recovery["status"] == "completed":
        require(all(r["status"] in {"reviewed", "invalid-candidate"} for r in rows.values()), "completed overlay contains unresolved work")
    return merged, provenance


def requested_supply(report: dict, fixture: dict, provenance: dict) -> dict:
    boundary = fixture.get("heldoutBoundary", {}).get("cases", [])
    require(len(boundary) == len(fixture["cases"]), "supply/safety case boundary missing")
    negative = {r["id"] for r in boundary if r["safetyNegative"]}
    require(len(negative) == 1, "exactly one declared safety-negative case required")
    arms = {}
    for arm in dict.fromkeys(c["arm"]["id"] for c in report["cells"]):
        cells = [c for c in report["cells"] if c["arm"]["id"] == arm]
        positive = [c for c in cells if c["caseId"] not in negative]
        safety = [c for c in cells if c["caseId"] in negative]
        strict = lambda c: c["combinedLabEligible"] is True and c["qualityState"] == "assessed" and c["requestedKindFulfilled"] is True and c["difficulty"]["matchesRequested"] is True
        arms[arm] = {"positiveRequested": len(positive), "positiveLabEligible": sum(c["combinedLabEligible"] is True for c in positive),
                     "positiveRequestedKindFulfilled": sum(c["requestedKindFulfilled"] is True for c in positive),
                     "positiveRequestedDifficultyMatched": sum(c["difficulty"]["matchesRequested"] is True for c in positive),
                     "positiveStrictRequestedSupply": sum(strict(c) for c in positive),
                     "positiveQualityStates": dict(Counter(c["qualityState"] for c in positive)),
                     "safetyNegativeRequested": len(safety), "safetyNumericCandidates": sum(c["candidateNumericKind"] == "numeric" for c in safety),
                     "safetyConceptualFallbacks": sum(c["candidateNumericKind"] == "conceptual" for c in safety),
                     "safetyEligibleNumericCandidates": sum(c["candidateNumericKind"] == "numeric" and c["combinedLabEligible"] is True for c in safety),
                     "cohorts": dict(Counter(provenance[c["cellId"]]["generationCohort"] for c in cells))}
    for cell in report["cells"]:
        cell["acquisition"] = provenance[cell["cellId"]]
        cell["safetyNegative"] = cell["caseId"] in negative
    return {"byArm": arms, "teacherAcceptance": None, "modelRankingClaim": False,
            "definition": "Strict requested supply requires lab eligibility, completed source assessment, requested numerical/conceptual kind, and judge-achieved requested difficulty. It is not teacher acceptance.",
            "safetyDefinition": "The chart case deliberately lacks original numerical values; a conceptual fallback can be safe but does not fulfill its numerical request. Numeric candidate counts alone do not prove fabricated values."}


def analyze(phase: Path, recovery_dir: Path, declaration_path: Path) -> dict:
    snapshots = []
    # Reuse independent historical byte/code/transcript reconciliation first.
    original_report = BASE.analyze_snapshot(phase)
    declaration = BASE.read_json(declaration_path, snapshots)
    controls_file = Path(declaration["controls"]["file"])
    require(BASE.sha256(controls_file.read_bytes()) == declaration["controls"]["sha256"], "recovery controls hash differs")
    controls = BASE.read_json(controls_file, snapshots)
    recovery = BASE.read_json(recovery_dir / "results.json", snapshots)
    require(recovery["declarationSha256"] == BASE.sha256(declaration_path.read_bytes()), "recovery declaration hash differs")
    require(Path(controls["origin"]).resolve() == phase.resolve(), "recovery origin differs")
    require(declaration["parentLedger"] == controls["parentLedger"] == recovery["parentLedger"], "parent ledger binding differs")
    parent_path = Path(controls["parentLedger"]["file"])
    require(BASE.sha256(parent_path.read_bytes()) == controls["parentLedger"]["sha256"], "original ledger changed")
    parent = BASE.read_json(parent_path, snapshots)
    child = BASE.read_json(recovery_dir / "ledger.json", snapshots)
    require(parent == recovery["parentLedgerReceipt"] and child == recovery["childLedger"], "embedded ledger differs")
    require(child["declarationSha256"] == recovery["declarationSha256"], "child ledger declaration differs")
    require(child["limits"] == declaration["limits"] == controls["limits"], "child limits differ")
    for ledger in (parent, child):
        require(ledger["reservedSends"] == len(ledger["reservations"]), "ledger send count differs")
        require(ledger["conservativeTokens"] == sum(r["inputEstimate"] + r["outputReservation"] for r in ledger["reservations"]), "ledger reservation sum differs")
        require(ledger["reservedSends"] <= ledger["limits"]["maxSends"] and ledger["conservativeTokens"] <= ledger["limits"]["maxConservativeTokens"], "ledger cap exceeded")
    require(parent["reservedSends"] + child["reservedSends"] <= parent["limits"]["maxSends"], "combined sends exceeded")
    require(parent["conservativeTokens"] + child["conservativeTokens"] <= parent["limits"]["maxConservativeTokens"], "combined token ceiling exceeded")
    preflight = BASE.read_json(phase / "preflight/preflight.json", snapshots)
    preflight["_declaration"] = BASE.read_json(phase / "declaration.json", snapshots)
    fixture = BASE.read_json(phase / "live/shard-1/fixture.json", snapshots)
    shards = []
    for s in preflight["shards"]:
        value = BASE.read_json(phase / "live" / s["id"] / "results.json", snapshots)
        value["_id"] = s["id"]
        shards.append(value)
    for row in recovery["recoveredCells"]:
        for entry in row["captures"]:
            path = Path(entry["file"]).resolve()
            require(path.is_relative_to(recovery_dir.resolve()), "recovery transcript outside output")
            require(BASE.read_json(path, snapshots) == entry["transcript"], "embedded recovery transcript differs")
    merged, provenance = merge_overlay(preflight, fixture, shards, controls, recovery)
    unresolved = {r["id"] for r in recovery["recoveredCells"] if r["status"] not in {"reviewed", "invalid-candidate"}}
    report = BASE.analyze_loaded(preflight, fixture, merged, unresolved_assessments=unresolved)
    report["requestedSupply"] = requested_supply(report, fixture, provenance)
    report.update({"createdAt": datetime.now(timezone.utc).isoformat(), "schema": "heldout-recovery-analysis-v1",
                   "originalSummary": original_report["summary"], "recoveryStatus": recovery["status"], "recoveryUsage": recovery["newUsage"],
                   "budget": {"originalSends": parent["reservedSends"], "newSends": child["reservedSends"], "originalConservativeUnits": parent["conservativeTokens"],
                              "newConservativeUnits": child["conservativeTokens"], "originalUnknownUsageCallsRetained": original_report["summary"]["allObservedSdkCalls"]["unknownUsageCalls"]},
                   "evidenceFiles": snapshots, "offline": {"providerCalls": 0, "databaseCalls": 0, "networkCalls": 0},
                   "limitations": original_report["limitations"] + ["Recovery preserves historical successful output and all negative results; new calls occur in a later acquisition cohort.",
                       "The analyzer checks exact raw/candidate/check identities and recomputes eligibility from recorded gates; it does not rerun production normalization, numerical proof or semantic review.",
                       "The exact historical judge prompt is restored by a checked adapter; the new deadline is an explicit transport change, so speed comparisons across cohorts remain confounded.",
                       "Analytical merged shards have no synthetic wall-clock or replacement execution receipt; original and recovery receipts remain authoritative."]})
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    parser.add_argument("--phase-dir", type=Path, required=True)
    parser.add_argument("--recovery-dir", type=Path, required=True)
    parser.add_argument("--declaration", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    report = analyze(args.phase_dir, args.recovery_dir, args.declaration)
    with args.output.open("x", encoding="utf-8") as stream:
        json.dump(report, stream, ensure_ascii=False, indent=2, allow_nan=False)
        stream.write("\n")
    print(json.dumps({"output": str(args.output), "sha256": BASE.sha256(args.output.read_bytes()), "summary": report["summary"], "requestedSupply": report["requestedSupply"]}, indent=2))


if __name__ == "__main__":
    main()
