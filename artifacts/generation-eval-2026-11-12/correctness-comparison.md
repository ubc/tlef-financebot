# Generation correctness trial comparison

Date 2026-11-12. Both follow-up evaluations used GPT-6.1 Sol to generate,
GPT-6 Luna to check, and one item per LO and difficulty. The original Market
Efficiency baseline used two medium items per LO with no explicit kind.

| Evaluation | Saved | Pass / flag / reject | Numeric failures | Waste | Repairs adopted / attempted | Solver adjusted | Tokens per saved question |
|---|---:|---:|---:|---:|---:|---:|---:|
| [Market Efficiency baseline](baseline-sol-trial-2026-11-12.md) | 8 | 5 / 2 / 1 | 1 | 1/8 (12.5%) | 0 / 0 | 0 | 9,238 |
| [Market Efficiency after](after-correctness.md) | 12 | 5 / 6 / 1 | 0 | 1/12 (8.3%) | 0 / 1 | 0 | 10,746 |
| [CAPM after](capm-after-correctness.md) | 12 | 8 / 4 / 0 | 0 | 0/12 (0%) | 0 / 0 | 3 | 10,648 |

Waste counts rejected or numerically failed questions and items that failed to
save. The three trials saved every requested item. Flags remain for instructor
review. Market Efficiency had one rejected item in each trial. The new reject
was a hard question whose attempted repair was not adopted. That item used 25,920
tokens, including 9,878 for repair and two checker calls. The batches differ
in difficulty and kind, so the lower waste percentage and 16.3% higher token
mean cannot isolate a correctness-pipeline effect. Among the new medium items
alone, 3 passed and 1 was flagged, with 9,505 tokens per saved question.

CAPM requested eight calculation questions across the mixed alpha objective
and the two calculation objectives. The parameter solver pruned values on
three of those eight, and all three passed the checker. No CAPM draft triggered
a repair. This is one live run with no CAPM baseline or instructor review.

## Provider usage and estimated cost

| Evaluation | Model | Calls | Input tokens | Output tokens | Cache read | Cache write | Estimated USD, default 30 min |
|---|---|---:|---:|---:|---:|---:|---:|
| Market Efficiency baseline | gpt-6.1-sol | 8 | 46,148 | 8,927 | 0 | 46,124 | $0.2046 |
| Market Efficiency baseline | gpt-6-luna | 8 | 17,637 | 1,193 | 0 | 17,613 | $0.0028 |
| Market Efficiency after correctness | gpt-6.1-sol | 13 | 82,825 | 14,950 | 0 | 82,786 | $0.3565 |
| Market Efficiency after correctness | gpt-6-luna | 13 | 29,072 | 2,106 | 0 | 29,033 | $0.0047 |
| CAPM after correctness | gpt-6.1-sol | 12 | 74,701 | 18,859 | 0 | 74,665 | $0.3753 |
| CAPM after correctness | gpt-6-luna | 12 | 32,274 | 1,939 | 0 | 32,238 | $0.0050 |

The estimated model cost was $0.2074 for the baseline, $0.3612
for the new Market Efficiency run, and $0.3803 for CAPM. Estimates use
provider-reported input and output counts and the standard 30-minute cache-write
rates. They exclude material processing and any unreported provider attempts.
The configured OpenAI Chat Completions adapter sent no cache policy override.
OpenAI lists $2.50 per million Sol tokens for 30-minute writes and $5.00 for
12-hour writes through Responses. The signed-in OpenAI Usage organization
showed no data for the date range with all projects selected, so the charges
for these runs could not be reconciled with the account bill.
[OpenAI API pricing](https://developers.openai.com/api/docs/pricing)
[OpenAI prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching)

Generator and checker requests currently put the objective near the start of
one user message, before the shared instructions and changing material or
candidate. That structure supplies no eligible shared message ending before
the changing content. Across the three trials, OpenAI reported zero cached
reads, with writes accounting for more than 99% of reported input. Moving
stable instructions into a shared initial message is a candidate for a future
cache change once the billing condition is confirmed.

## Per-question token receipts

Counts are joined on generation run ID and item index. The Check column sums
both checks when repair prompted a recheck. All observed calls reported totals.

### Market Efficiency baseline

| LO | Question ID | Difficulty | Kind | Verdict | Generation | Check | Repair | Total |
|---:|---|---|---|---|---:|---:|---:|---:|
| 1 | `6af5e333c2eaa92d395f5bfb` | medium | — | pass | 7,534 | 2,575 | 0 | 10,109 |
| 1 | `6af5e34dc2eaa92d395f5c07` | medium | — | flag | 6,628 | 2,249 | 0 | 8,877 |
| 2 | `6af5e317c2eaa92d395f5bf1` | medium | — | pass | 6,417 | 2,218 | 0 | 8,635 |
| 2 | `6af5e336c2eaa92d395f5bfd` | medium | — | pass | 6,833 | 2,273 | 0 | 9,106 |
| 3 | `6af5e318c2eaa92d395f5bf3` | medium | — | pass | 6,303 | 2,153 | 0 | 8,456 |
| 3 | `6af5e350c2eaa92d395f5c0b` | medium | — | reject | 7,806 | 2,696 | 0 | 10,502 |
| 4 | `6af5e328c2eaa92d395f5bf9` | medium | — | pass | 6,781 | 2,343 | 0 | 9,124 |
| 4 | `6af5e34fc2eaa92d395f5c09` | medium | — | flag | 6,773 | 2,323 | 0 | 9,096 |

### Market Efficiency after correctness

| LO | Question ID | Difficulty | Kind | Verdict | Generation | Check | Repair | Total |
|---:|---|---|---|---|---:|---:|---:|---:|
| 1 | `6af5f0eafbafd18bc490dfe6` | easy | conceptual | flag | 6,466 | 2,052 | 0 | 8,518 |
| 1 | `6af5f0f1fbafd18bc490dfea` | medium | conceptual | pass | 6,677 | 2,131 | 0 | 8,808 |
| 1 | `6af5f10dfbafd18bc490dff2` | hard | conceptual | flag | 7,821 | 2,397 | 0 | 10,218 |
| 2 | `6af5f0eefbafd18bc490dfe8` | easy | conceptual | pass | 6,507 | 2,069 | 0 | 8,576 |
| 2 | `6af5f109fbafd18bc490dfee` | medium | conceptual | pass | 6,868 | 2,234 | 0 | 9,102 |
| 2 | `6af5f119fbafd18bc490dff4` | hard | conceptual | flag | 8,157 | 2,429 | 0 | 10,586 |
| 3 | `6af5f107fbafd18bc490dfec` | easy | conceptual | flag | 6,482 | 2,033 | 0 | 8,515 |
| 3 | `6af5f10afbafd18bc490dff0` | medium | conceptual | pass | 6,620 | 2,135 | 0 | 8,755 |
| 3 | `6af5f12afbafd18bc490dff8` | hard | conceptual | flag | 7,599 | 2,347 | 0 | 9,946 |
| 4 | `6af5f11bfbafd18bc490dff6` | easy | conceptual | pass | 6,529 | 2,127 | 0 | 8,656 |
| 4 | `6af5f14dfbafd18bc490dffa` | medium | calculation | flag | 8,441 | 2,912 | 0 | 11,353 |
| 4 | `6af5f17ffbafd18bc490dffc` | hard | calculation | reject | 9,730 | 6,312 | 9,878 | 25,920 |

### CAPM after correctness

| LO | Question ID | Difficulty | Kind | Verdict | Generation | Check | Repair | Total |
|---:|---|---|---|---|---:|---:|---:|---:|
| 1 | `6af5f3fefbafd18bc490e05e` | easy | conceptual | pass | 6,705 | 2,442 | 0 | 9,147 |
| 1 | `6af5f41cfbafd18bc490e066` | medium | calculation | pass | 8,438 | 3,167 | 0 | 11,605 |
| 1 | `6af5f419fbafd18bc490e064` | hard | calculation | pass | 8,920 | 3,470 | 0 | 12,390 |
| 2 | `6af5f401fbafd18bc490e062` | easy | calculation | flag | 7,548 | 2,884 | 0 | 10,432 |
| 2 | `6af5f400fbafd18bc490e060` | medium | calculation | pass | 7,793 | 2,980 | 0 | 10,773 |
| 2 | `6af5f42afbafd18bc490e06a` | hard | calculation | pass | 8,741 | 3,076 | 0 | 11,817 |
| 3 | `6af5f429fbafd18bc490e068` | easy | calculation | flag | 7,443 | 2,717 | 0 | 10,160 |
| 3 | `6af5f438fbafd18bc490e06e` | medium | calculation | flag | 8,778 | 3,458 | 0 | 12,236 |
| 3 | `6af5f447fbafd18bc490e074` | hard | calculation | pass | 9,080 | 3,325 | 0 | 12,405 |
| 4 | `6af5f42bfbafd18bc490e06c` | easy | conceptual | pass | 6,296 | 2,067 | 0 | 8,363 |
| 4 | `6af5f439fbafd18bc490e070` | medium | conceptual | pass | 6,404 | 2,175 | 0 | 8,579 |
| 4 | `6af5f445fbafd18bc490e072` | hard | conceptual | flag | 7,414 | 2,452 | 0 | 9,866 |
