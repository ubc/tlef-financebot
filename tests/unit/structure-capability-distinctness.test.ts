import { createHash } from 'node:crypto';
import { BSON } from 'mongodb';
import type { GroundingObjective, OutlineGroundingFinding, StructureEvidence } from '../../server/src/types/structure';
import type { OutlineGroundingBatch } from '../../server/src/services/structure-outline-grounding';
import type { OutlineCapabilityComparison, OutlineCapabilityContext } from '../../server/src/types/structure-distinctness';
import { OUTLINE_CAPABILITY_DISTINCTNESS, assessOutlineCapabilityAdmission, assertOutlineCapabilityContext,
  outlineCapabilityDistinctnessProtocolHash, planOutlineCapabilityDistinctness, renderOutlineCapabilityDistinctness,
  selectOutlineCapabilityContext, validateOutlineCapabilityComparisons } from '../../server/src/services/structure-capability-distinctness';
import { planCapabilityOutlineGrounding, selectCapabilityOutlineGroundingBatch, type CapabilityOutlineGroundingBatch } from '../../server/src/services/structure-capability-grounding';
import { estimateAuthoringTokens } from '../../server/src/components/genai/llm/authoring-budget';

// Exact five-objective/source projection of the actual retained142-LO proposal.
// Source fixture: audit-results/quality-lab-outline-continuation-2026-10-17/checkpoint-body.json
// SHA256:82aaab21c39e92a113ae5405e4cec4650a3c1a42bcd91d24f9a7657ce7aefd69
// Copied inline for a self-contained offline regression; every judgment below
// is scripted and establishes protocol mechanics, never model/teacher quality.
const retainedBatches: OutlineGroundingBatch[] = [
  {
    "objectives": [
      {
        "id": "L104",
        "themeIndex": 20,
        "loIndex": 0,
        "topic": "Leverage Measurement and Financing Decisions",
        "name": "Compare book- and market-value debt-to-capital and net-debt-to-capital ratios with peer groups and estimates from operating income, cost of capital, APV, and comparable firms; evaluate debt-ratio regressions using explanatory variables, t statistics, R-squared, predicted ratios, and actual leverage.",
        "contentHash": "c44e41aeaae749790a86b9ee2bdc075db61c94415ec6d4c97d487ecef4349ec9",
        "evidenceIds": [
          "E655",
          "E656",
          "E657",
          "E658",
          "E659",
          "E660",
          "E661",
          "E662"
        ],
        "materialIds": [
          "6ad2ad06e474ab8460b47c14"
        ],
        "sourceIds": [
          "S391",
          "S392",
          "S393",
          "S394",
          "S395",
          "S396",
          "S397"
        ],
        "learningPoints": [
          {
            "id": "E655",
            "objective": "Compare firms’ book-value and market-value Debt to Capital and Net Debt to Capital ratios with the corresponding ratios for their comparable groups, keeping firm rows distinct from peer-group rows.",
            "materialId": "6ad2ad06e474ab8460b47c14",
            "sourceIds": [
              "S391"
            ]
          },
          {
            "id": "E656",
            "objective": "Compare book-value and market-value Debt to Capital and Net Debt to Capital ratios for Vale, Tata Motors, and Baidu with the corresponding ratios for their identified comparable groups.",
            "materialId": "6ad2ad06e474ab8460b47c14",
            "sourceIds": [
              "S392"
            ]
          },
          {
            "id": "E657",
            "objective": "Estimate a sector debt-ratio regression, evaluate its statistical significance using t statistics and predictive ability using R squared, and use firm proxy values to estimate a predicted debt ratio and compare it with the actual ratio.",
            "materialId": "6ad2ad06e474ab8460b47c14",
            "sourceIds": [
              "S393"
            ]
          },
          {
            "id": "E658",
            "objective": "Calculate Tata Motors’ predicted debt ratio using the regression for global automobile firms and compare it with Tata Motors’ actual debt ratio to determine whether it is overlevered.",
            "materialId": "6ad2ad06e474ab8460b47c14",
            "sourceIds": [
              "S394"
            ]
          },
          {
            "id": "E659",
            "objective": "Calculate a market debt-to-capital ratio using the regression for 2014 US listed firms and identify the variables used in the regression.",
            "materialId": "6ad2ad06e474ab8460b47c14",
            "sourceIds": [
              "S395"
            ]
          },
          {
            "id": "E660",
            "objective": "Estimate Disney’s optimal debt ratio using the debt regression and the supplied 2014 input values.",
            "materialId": "6ad2ad06e474ab8460b47c14",
            "sourceIds": [
              "S396"
            ]
          },
          {
            "id": "E661",
            "objective": "Explain what Disney’s estimated optimal debt ratio tells you and why it might differ from the optimal ratio calculated using the weighted average cost of capital.",
            "materialId": "6ad2ad06e474ab8460b47c14",
            "sourceIds": [
              "S396"
            ]
          },
          {
            "id": "E662",
            "objective": "Compare actual debt ratios with optimal debt-ratio estimates for Disney, Vale, Tata Motors, and Baidu across the operating income, standard cost of capital, enhanced cost of capital, APV, and comparable-to-industry and comparable-to-market methods, using the table’s company columns and method rows.",
            "materialId": "6ad2ad06e474ab8460b47c14",
            "sourceIds": [
              "S397"
            ]
          }
        ]
      }
    ],
    "sources": [
      {
        "id": "S425",
        "localId": "C78.S1",
        "materialId": "6ad2ad06e474ab8460b47c14",
        "materialName": "Chapter 8: Capital Structure: Model and Applications.pdf",
        "chunkIndex": 77,
        "text": "Aswath Damodaran                                                          94\n\f             Debt to Capital    Net Debt to Capital                       Debt to Capital   Net Debt to Capital\n                 Ratio                Ratio                                   Ratio               Ratio\nCompany    Book      Market    Book         Market    Comparable        Book       Market   Book       Market\n           value     value     value        value     group             value      value    value      value\n                                                      US\nDisney     22.88%    11.58%     17.70%      8.98%                       39.03%    15.44%    24.92%     9.93%\n                                                      Entertainment\n                                                      Global\n                                                      Diversified\nVale       39.02%    35.48%     34.90%     31.38%     Mining & Iron     34.43%    26.03%    26.01%     17.90%",
        "alias": "S391"
      },
      {
        "id": "S426",
        "localId": "C79.S1",
        "materialId": "6ad2ad06e474ab8460b47c14",
        "materialName": "Chapter 8: Capital Structure: Model and Applications.pdf",
        "chunkIndex": 78,
        "text": "Vale       39.02%    35.48%     34.90%     31.38%     Mining & Iron     34.43%    26.03%    26.01%     17.90%\n                                                      Ore (Market\n                                                      cap> $1 b)\n                                                      Global Autos\nTata\n           58.51%    29.28%     22.44%     19.25%     (Market Cap> $1   35.96%    18.72%     3.53%     0.17%\nMotors                                                b)\n                                                      Global Online\nBaidu      32.93%     5.23%     20.12%      2.32%                       6.37%      1.83%    -27.13%    -2.76%\n                                                      Advertising",
        "alias": "S392"
      },
      {
        "id": "S427",
        "localId": "C80.S1",
        "materialId": "6ad2ad06e474ab8460b47c14",
        "materialName": "Chapter 8: Capital Structure: Model and Applications.pdf",
        "chunkIndex": 79,
        "text": "Aswath Damodaran                                                                                                  95\n\f§ Step 1: Run a regression of debt ratios on the variables that\n  you believe determine debt ratios in the sector. For example,\n   § Debt Ratio = a + b (Tax rate) + c (Earnings Variability) + d\n    (EBITDA/Firm Value)\n   Check this regression for statistical significance (t statistics) and\n   predictive ability (R squared)\n§ Step 2: Estimate the values of the proxies for the firm under\n  consideration. Plugging into the crosssectional regression, we\n  can obtain an estimate of predicted debt ratio.\n§ Step 3: Compare the actual debt ratio to the predicted debt\n  ratio.",
        "alias": "S393"
      },
      {
        "id": "S428",
        "localId": "C81.S1",
        "materialId": "6ad2ad06e474ab8460b47c14",
        "materialName": "Chapter 8: Capital Structure: Model and Applications.pdf",
        "chunkIndex": 80,
        "text": "Aswath Damodaran                                                           96\n\f§ Using a sample of 56 global auto firms, we arrived at the\n  following regression:\n   § Debt to capital = 0.09 + 0.63 (Effective Tax Rate) + 1.01 (EBITDA/\n     Enterprise Value) - 0.93 (Cap Ex/ Enterprise Value)\n   § The R squared of the regression is 21%. This regression can be used\n     to arrive at a predicted value for Tata Motors of:\n§ Predicted Debt Ratio = 0.09 + 0.63 (0.252) +1.01 (0.1167) - 0.93\n  (0.1949) = .1854 or 18.54%\n§ Based upon the capital structure of other firms in the\n  automobile industry, Tata Motors should have a market value\n  debt ratio of 18.54%. It is over levered at its existing debt\n  ratio of 29.28%.",
        "alias": "S394"
      },
      {
        "id": "S429",
        "localId": "C82.S1",
        "materialId": "6ad2ad06e474ab8460b47c14",
        "materialName": "Chapter 8: Capital Structure: Model and Applications.pdf",
        "chunkIndex": 81,
        "text": "Aswath Damodaran                                                           97\n\f§ Using 2014 data for US listed firms, we looked at the\n  determinants of the market debt to capital ratio. The regression\n  provides the following results –\nDFR = 0.27 - 0.24 ETR -0.10 g– 0.065 INST -0.338 CVOI+ 0.59 E/V\n             (15.79) (9.00) (2.71) (3.55)       (3.10)    (6.85)\n   DFR = Debt / ( Debt + Market Value of Equity)\n   ETR = Effective tax rate in most recent twelve months\n   INST = % of Shares held by institutions\n   CVOI = Std dev in OI in last 10 years/ Average OI in last 10 years\n   E/V = EBITDA/ (Market Value of Equity + Debt- Cash)\n         The regression has an R-squared of 8%.",
        "alias": "S395"
      },
      {
        "id": "S430",
        "localId": "C83.S1",
        "materialId": "6ad2ad06e474ab8460b47c14",
        "materialName": "Chapter 8: Capital Structure: Model and Applications.pdf",
        "chunkIndex": 82,
        "text": "Aswath Damodaran                                                        98\n\f§ Disney had the following values for these inputs in 2014.\n     Estimate the optimal debt ratio using the debt regression.\n     § Effective Tax Rate (ETR)                = 31.02%\n     § Expected Revenue Growth                 = 6.45%\n     § Institutional Holding % (INST)          = 70.2%\n     § Coefficient of Variation in OI (CVOI)   = 0.0296\n     § EBITDA/Value of firm (E/V)              = 9.35%\n     Optimal Debt Ratio\n     = 0.27 - 0.24 (.3102) -0.10 (.0645)– 0.065 (.702) -0.338 (.0296)+ 0.59\n     (.0935)\n     = 0.1886 or 18.86%\na.     What does this optimal debt ratio tell you?\nb.      Why might it be different from the optimal calculated using\n       the weighted average cost of capital?",
        "alias": "S396"
      },
      {
        "id": "S431",
        "localId": "C84.S1",
        "materialId": "6ad2ad06e474ab8460b47c14",
        "materialName": "Chapter 8: Capital Structure: Model and Applications.pdf",
        "chunkIndex": 83,
        "text": "Aswath Damodaran                                                              99\n\f                                         Disney          Vale           Tata Motors Baidu\n          Actual Debt Ratio              11.58%         35.48%            29.28%   5.23%\n          Optimal\n          I. Operating income            35.00%           —                 -\n          II. Standard Cost of capital   40.00%     30.00% (actual)       20.00%   10.00%\n                                                  50.00% (normalized)\n          III. Enhanced Cost of Capital 40.00%      30.00% (actual)       10.00%   10.00%\n                                                  40.00% (normalized)\n          IV. APV                        40.00%         30.00%            20.00%   20.00%\n          V. Comparable\n           To industry                   28.54%         26.03%            18.72%   1.83%\n           To market                     18.86%           —                 -",
        "alias": "S397"
      }
    ],
    "prompt": "Retained immutable source context; original prompt is not executed by this test."
  },
  {
    "objectives": [
      {
        "id": "L105",
        "themeIndex": 20,
        "loIndex": 1,
        "topic": "Leverage Measurement and Financing Decisions",
        "name": "Classify firms as appropriately levered, underlevered, or overlevered by comparing actual and optimal ratios, use project returns relative to cost of equity and cost of capital to assess project suitability, and apply the decision tree to select financing responses for distress, takeover risk, project quality, dividends, buybacks, and debt changes.",
        "contentHash": "ffc86aa363bcfec8a5f99aa2978d80c8afd7dcbfbeec633894bf61f382ab0898",
        "evidenceIds": [
          "E667",
          "E669",
          "E670",
          "E671",
          "E672",
          "E673",
          "E674",
          "E675",
          "E676",
          "E677",
          "E678",
          "E679",
          "E680",
          "E681",
          "E682",
          "E683",
          "E686"
        ],
        "materialIds": [
          "6ad2ad06e474ab8460b47c16"
        ],
        "sourceIds": [
          "S398",
          "S399",
          "S400",
          "S401",
          "S402",
          "S403",
          "S404"
        ],
        "learningPoints": [
          {
            "id": "E667",
            "objective": "Classify a firm’s financing mix as right, underlevered, or overlevered after analyzing it.",
            "materialId": "6ad2ad06e474ab8460b47c16",
            "sourceIds": [
              "S398"
            ]
          },
          {
            "id": "E669",
            "objective": "Compare the actual debt ratio with the optimal debt ratio to determine whether the actual ratio is greater or lesser.",
            "materialId": "6ad2ad06e474ab8460b47c16",
            "sourceIds": [
              "S398"
            ]
          },
          {
            "id": "E670",
            "objective": "Use the actual-versus-optimal debt-ratio comparison to distinguish an overlevered firm from an underlevered firm and identify the corresponding decision path.",
            "materialId": "6ad2ad06e474ab8460b47c16",
            "sourceIds": [
              "S399"
            ]
          },
          {
            "id": "E671",
            "objective": "For an overlevered firm, determine whether bankruptcy threat calls for rapid debt reduction and identify equity-for-debt swaps, asset sales used to repay debt, and lender renegotiation as debt-reduction methods.",
            "materialId": "6ad2ad06e474ab8460b47c16",
            "sourceIds": [
              "S399"
            ]
          },
          {
            "id": "E672",
            "objective": "Evaluate whether projects are good by comparing return on equity with cost of equity and return on capital with cost of capital when selecting a financing response to leverage.",
            "materialId": "6ad2ad06e474ab8460b47c16",
            "sourceIds": [
              "S399"
            ]
          },
          {
            "id": "E673",
            "objective": "For an underlevered firm that should increase leverage quickly, identify debt/equity swaps and borrowing to buy shares as methods.",
            "materialId": "6ad2ad06e474ab8460b47c16",
            "sourceIds": [
              "S399"
            ]
          },
          {
            "id": "E674",
            "objective": "For an overlevered firm without a bankruptcy threat, identify taking good projects with new equity or retained earnings as a response.",
            "materialId": "6ad2ad06e474ab8460b47c16",
            "sourceIds": [
              "S400"
            ]
          },
          {
            "id": "E675",
            "objective": "For an overlevered firm without good projects, identify paying off debt with retained earnings, reducing or eliminating dividends, and issuing new equity to pay off debt as responses.",
            "materialId": "6ad2ad06e474ab8460b47c16",
            "sourceIds": [
              "S400"
            ]
          },
          {
            "id": "E676",
            "objective": "For an underlevered firm with good projects, identify taking good projects with debt as a response; when deciding whether to return cash, distinguish paying dividends from buying back stock according to stockholder preference.",
            "materialId": "6ad2ad06e474ab8460b47c16",
            "sourceIds": [
              "S400"
            ]
          },
          {
            "id": "E677",
            "objective": "Apply the actual-versus-optimal debt-ratio decision tree to classify a firm as overlevered or underlevered and follow the corresponding branch.",
            "materialId": "6ad2ad06e474ab8460b47c16",
            "sourceIds": [
              "S401"
            ]
          },
          {
            "id": "E678",
            "objective": "Determine whether an underlevered firm is a takeover target and use stockholder dividend preference to choose between paying dividends and buying back stock.",
            "materialId": "6ad2ad06e474ab8460b47c16",
            "sourceIds": [
              "S401"
            ]
          },
          {
            "id": "E679",
            "objective": "Apply the underlevered-firm decision tree to assess takeover-target status and identify rapid leverage-increasing actions, including debt/equity swaps and borrowing to buy shares.",
            "materialId": "6ad2ad06e474ab8460b47c16",
            "sourceIds": [
              "S402"
            ]
          },
          {
            "id": "E680",
            "objective": "Use return on equity versus cost of equity and return on capital versus cost of capital to evaluate whether projects are good.",
            "materialId": "6ad2ad06e474ab8460b47c16",
            "sourceIds": [
              "S402"
            ]
          },
          {
            "id": "E681",
            "objective": "Apply the leverage decision tree to distinguish taking good projects with new equity or retained earnings from reducing debt when an overlevered firm lacks good projects.",
            "materialId": "6ad2ad06e474ab8460b47c16",
            "sourceIds": [
              "S403"
            ]
          },
          {
            "id": "E682",
            "objective": "For an underlevered firm with good projects, identify taking projects with debt; when projects are not suitable, use stockholder dividend preference to choose a cash-return action.",
            "materialId": "6ad2ad06e474ab8460b47c16",
            "sourceIds": [
              "S403"
            ]
          },
          {
            "id": "E683",
            "objective": "Evaluate project suitability using ROE > cost of equity and ROC > cost of capital.",
            "materialId": "6ad2ad06e474ab8460b47c16",
            "sourceIds": [
              "S403"
            ]
          },
          {
            "id": "E686",
            "objective": "Use the decision-tree outcome to choose between paying dividends and buying back stock.",
            "materialId": "6ad2ad06e474ab8460b47c16",
            "sourceIds": [
              "S404"
            ]
          }
        ]
      },
      {
        "id": "L106",
        "themeIndex": 20,
        "loIndex": 2,
        "topic": "Leverage Measurement and Financing Decisions",
        "name": "Recommend immediate or gradual leverage adjustment or no change based on value gains, disruption, capital structure, and investment record; identify transactions that change debt ratios and explain effects of dividends, buybacks, debt repayment, firm value changes, and expected price appreciation.",
        "contentHash": "3b6489a18a86ae667998ea2c1c41f914addc7d2e25953718bb22862b906183e3",
        "evidenceIds": [
          "E668",
          "E684",
          "E685",
          "E687",
          "E688",
          "E689",
          "E690",
          "E691"
        ],
        "materialIds": [
          "6ad2ad06e474ab8460b47c16"
        ],
        "sourceIds": [
          "S398",
          "S404",
          "S405",
          "S406"
        ],
        "learningPoints": [
          {
            "id": "E668",
            "objective": "Evaluate whether moving to the optimal financing mix is worthwhile, how quickly to move, and which kind of financing to use for the adjustment.",
            "materialId": "6ad2ad06e474ab8460b47c16",
            "sourceIds": [
              "S398"
            ]
          },
          {
            "id": "E684",
            "objective": "Recommend an immediate leverage change, a gradual leverage change, or no leverage change based on analysis of a firm’s capital structure and investment record.",
            "materialId": "6ad2ad06e474ab8460b47c16",
            "sourceIds": [
              "S404"
            ]
          },
          {
            "id": "E685",
            "objective": "Recommend whether to pay off debt or buy back equity, or to take projects with equity or debt, as part of a financing-mix decision.",
            "materialId": "6ad2ad06e474ab8460b47c16",
            "sourceIds": [
              "S404"
            ]
          },
          {
            "id": "E687",
            "objective": "Identify ways to decrease the debt ratio, including selling operating assets and using the cash to pay down debt, issuing stock to retire debt, or having debt holders accept equity.",
            "materialId": "6ad2ad06e474ab8460b47c16",
            "sourceIds": [
              "S405"
            ]
          },
          {
            "id": "E688",
            "objective": "Identify ways to increase the debt ratio, including selling operating assets and using the cash to buy back stock or pay a special dividend, and borrowing to buy back stock or pay a special dividend.",
            "materialId": "6ad2ad06e474ab8460b47c16",
            "sourceIds": [
              "S405"
            ]
          },
          {
            "id": "E689",
            "objective": "Explain how dividends and stock buybacks reduce equity value and how debt repayments reduce debt value when changing debt ratios over time.",
            "materialId": "6ad2ad06e474ab8460b47c16",
            "sourceIds": [
              "S406"
            ]
          },
          {
            "id": "E690",
            "objective": "Explain why changing debt ratios over time is complicated by firm value changing, and calculate expected price appreciation from cost of equity and dividend yield.",
            "materialId": "6ad2ad06e474ab8460b47c16",
            "sourceIds": [
              "S406"
            ]
          },
          {
            "id": "E691",
            "objective": "Explain how debt changes over time in conjunction with changes in firm value.",
            "materialId": "6ad2ad06e474ab8460b47c16",
            "sourceIds": [
              "S406"
            ]
          }
        ]
      }
    ],
    "sources": [
      {
        "id": "S436",
        "localId": "C4.S1",
        "materialId": "6ad2ad06e474ab8460b47c16",
        "materialName": "Chapter 9: Capital Structure: The Financing Details.pdf",
        "chunkIndex": 3,
        "text": "Aswath Damodaran                                                                                                                 102\n\f§ At the end of the analysis of financing mix (using whatever tool\n  or tools you choose to use), you can come to one of three\n  conclusions:\n   § The firm has the right financing mix\n   § It has too little debt (it is under levered)\n   § It has too much debt (it is over levered)\n\n§ The next step in the process is\n   § Determining whether to move to the optimal (is it worth the move\n     and disruption, if the value change is small?)\n   § If you decide to move, how quickly or gradually the firm should\n     move to its optimal?\n   § Assuming that it does, the right kind of financing to use in making\n     this adjustment..\n\n\nAswath Damodaran                                                           103\n\f                     Is the actual debt ratio greater than or lesser than the optimal debt ratio?",
        "alias": "S398"
      },
      {
        "id": "S437",
        "localId": "C5.S1",
        "materialId": "6ad2ad06e474ab8460b47c16",
        "materialName": "Chapter 9: Capital Structure: The Financing Details.pdf",
        "chunkIndex": 4,
        "text": "Actual > Optimal                                                            Actual < Optimal\n         Overlevered                                                                 Underlevered\n\n    Is the firm under bankruptcy threat?                                         Is the firm a takeover target?\n\n Yes                                    No                                     Yes                         No\n\nReduce Debt quickly                                                    Increase leverage\n1. Equity for Debt swap         Does the firm have good                quickly                      Does the firm have good\n2. Sell Assets; use cash        projects?                              1. Debt/Equity swaps         projects?\nto pay off debt                 ROE > Cost of Equity                   2. Borrow money&             ROE > Cost of Equity\n3. Renegotiate with lenders     ROC > Cost of Capital                  buy shares.                  ROC > Cost of Capital",
        "alias": "S399"
      },
      {
        "id": "S438",
        "localId": "C6.S1",
        "materialId": "6ad2ad06e474ab8460b47c16",
        "materialName": "Chapter 9: Capital Structure: The Financing Details.pdf",
        "chunkIndex": 5,
        "text": "Yes                            No\n                                                                                 Yes                                 No\n       Take good projects with     1. Pay off debt with retained\n       new equity or with retained earnings.                               Take good projects with\n       earnings.                   2. Reduce or eliminate dividends.       debt.\n                                   3. Issue new equity and pay off                                          Do your stockholders like\n                                   debt.                                                                    dividends?",
        "alias": "S400"
      },
      {
        "id": "S439",
        "localId": "C7.S1",
        "materialId": "6ad2ad06e474ab8460b47c16",
        "materialName": "Chapter 9: Capital Structure: The Financing Details.pdf",
        "chunkIndex": 6,
        "text": "Yes\n                                                                                                    Pay Dividends         No\n                                                                                                                          Buy back stock\n         Aswath Damodaran                                                                                                     104\n\f                     Is the actual debt ratio greater than or lesser than the optimal debt ratio?\n\n\n         Actual > Optimal                                                            Actual < Optimal\n         Overlevered                                                                 Actual (11.58%) < Optimal (40%)\n\n    Is the firm under bankruptcy threat?                                         Is the firm a takeover target?",
        "alias": "S401"
      },
      {
        "id": "S440",
        "localId": "C8.S1",
        "materialId": "6ad2ad06e474ab8460b47c16",
        "materialName": "Chapter 9: Capital Structure: The Financing Details.pdf",
        "chunkIndex": 7,
        "text": "No. Large mkt cap & positive\n Yes                                    No                                     Yes\n                                                                                                    Jensen’s a\nReduce Debt quickly                                                    Increase leverage\n1. Equity for Debt swap         Does the firm have good                quickly                      Does the firm have good\n2. Sell Assets; use cash        projects?                              1. Debt/Equity swaps         projects?\nto pay off debt                 ROE > Cost of Equity                   2. Borrow money&             ROE > Cost of Equity\n3. Renegotiate with lenders     ROC > Cost of Capital                  buy shares.                  ROC > Cost of Capital",
        "alias": "S402"
      },
      {
        "id": "S441",
        "localId": "C9.S1",
        "materialId": "6ad2ad06e474ab8460b47c16",
        "materialName": "Chapter 9: Capital Structure: The Financing Details.pdf",
        "chunkIndex": 8,
        "text": "Yes                            No                             Yes. ROC > Cost of capital                No\n       Take good projects with     1. Pay off debt with retained\n       new equity or with retained earnings.                               Take good projects\n       earnings.                   2. Reduce or eliminate dividends.       With debt.\n                                   3. Issue new equity and pay off                                          Do your stockholders like\n                                   debt.                                                                    dividends?",
        "alias": "S403"
      },
      {
        "id": "S442",
        "localId": "C10.S1",
        "materialId": "6ad2ad06e474ab8460b47c16",
        "materialName": "Chapter 9: Capital Structure: The Financing Details.pdf",
        "chunkIndex": 9,
        "text": "Yes\n                                                                                                    Pay Dividends         No\n                                                                                                                          Buy back stock\n         Aswath Damodaran                                                                                                      105\n\f§ Based upon your analysis of both the firm’s capital structure\n  and investment record, what path would you map out for the\n  firm?\n   a.     Immediate change in leverage\n   b.     Gradual change in leverage\n   c.     No change in leverage\n§ Would you recommend that the firm change its financing mix\n  by\n   a.     Paying off debt/Buying back equity\n   b.     Take projects with equity/debt",
        "alias": "S404"
      },
      {
        "id": "S443",
        "localId": "C11.S1",
        "materialId": "6ad2ad06e474ab8460b47c16",
        "materialName": "Chapter 9: Capital Structure: The Financing Details.pdf",
        "chunkIndex": 10,
        "text": "Aswath Damodaran                                                  106\n\f                       To decrease the debt ratio\n                   Sell operating assets        Issue new stock to retire\n                   and use cash to pay          debt or get debt holders to\n                   down debt.                   accept equity in the firm.\n\n\n                             Assets             Liabilities\n\n                        Cash                      Debt\n\n                        Opearing\n                        Assets in place\n                                                  Equity\n                        Growth Assets\n\n\n                     Sell operating assets      Borrow money and buy\n                     and use cash to buy        back stock or pay a large\n                     back stock or pay or       special dividend\n                     special dividend\n\n                                 To increase the debt ratio",
        "alias": "S405"
      },
      {
        "id": "S444",
        "localId": "C12.S1",
        "materialId": "6ad2ad06e474ab8460b47c16",
        "materialName": "Chapter 9: Capital Structure: The Financing Details.pdf",
        "chunkIndex": 11,
        "text": "To increase the debt ratio\n\nAswath Damodaran                                                              107\n\f§ To change debt ratios over time, you use the same mix of\n  tools that you used to change debt ratios gradually:\n   § Dividends and stock buybacks: Dividends and stock buybacks\n     will reduce the value of equity.\n   § Debt repayments: will reduce the value of debt.\n\n§ The complication of changing debt ratios over time is that firm\n  value is itself a moving target.\n§ If equity is fairly valued today, the equity value should\n  change over time to reflect the expected price appreciation:\n       § Expected Price appreciation = Cost of equity – Dividend Yield\n       § Debt will also change over time, in conjunction as firm value changes.",
        "alias": "S406"
      }
    ],
    "prompt": "Retained immutable source context; original prompt is not executed by this test."
  },
  {
    "objectives": [
      {
        "id": "L127",
        "themeIndex": 25,
        "loIndex": 0,
        "topic": "Capital Structure Decisions and Implementation",
        "name": "Explain how investment, financing, and dividend decisions relate to firm value, asset risk, hurdle rates, financing fit, and stockholder preferences; compare actual and optimal ratios using peer groups, regression, and operating-income, cost-of-capital, APV, or comparable-company estimates.",
        "contentHash": "5fe877b052251ae711b4c62fb2512e7cb7af7d11e0782af307d5d0ea04328403",
        "evidenceIds": [
          "E663",
          "E664",
          "E665",
          "E666",
          "E655",
          "E656",
          "E657",
          "E658",
          "E659",
          "E660",
          "E661",
          "E662"
        ],
        "materialIds": [
          "6ad2ad06e474ab8460b47c16",
          "6ad2ad06e474ab8460b47c14"
        ],
        "sourceIds": [
          "S12",
          "S13",
          "S14",
          "S391",
          "S392",
          "S393",
          "S394",
          "S395",
          "S396",
          "S397"
        ],
        "learningPoints": [
          {
            "id": "E663",
            "objective": "Describe how investment, financing, and dividend decisions contribute to maximizing firm value, including the hurdle-rate, financing-mix, and cash-return considerations for each decision.",
            "materialId": "6ad2ad06e474ab8460b47c16",
            "sourceIds": [
              "S12"
            ]
          },
          {
            "id": "E664",
            "objective": "Explain how the hurdle rate reflects the riskiness of an investment and how the expected return reflects the magnitude and timing of cash flows and their side effects.",
            "materialId": "6ad2ad06e474ab8460b47c16",
            "sourceIds": [
              "S13"
            ]
          },
          {
            "id": "E665",
            "objective": "Explain how the optimal mix of debt and equity maximizes firm value and how the kind of debt should match the tenor of the firm’s assets.",
            "materialId": "6ad2ad06e474ab8460b47c16",
            "sourceIds": [
              "S13"
            ]
          },
          {
            "id": "E666",
            "objective": "Explain how the financing mix used to fund assets relates to cash flows, and how cash-return decisions depend on current and potential investment opportunities and whether stockholders prefer dividends or buybacks.",
            "materialId": "6ad2ad06e474ab8460b47c16",
            "sourceIds": [
              "S14"
            ]
          },
          {
            "id": "E655",
            "objective": "Compare firms’ book-value and market-value Debt to Capital and Net Debt to Capital ratios with the corresponding ratios for their comparable groups, keeping firm rows distinct from peer-group rows.",
            "materialId": "6ad2ad06e474ab8460b47c14",
            "sourceIds": [
              "S391"
            ]
          },
          {
            "id": "E656",
            "objective": "Compare book-value and market-value Debt to Capital and Net Debt to Capital ratios for Vale, Tata Motors, and Baidu with the corresponding ratios for their identified comparable groups.",
            "materialId": "6ad2ad06e474ab8460b47c14",
            "sourceIds": [
              "S392"
            ]
          },
          {
            "id": "E657",
            "objective": "Estimate a sector debt-ratio regression, evaluate its statistical significance using t statistics and predictive ability using R squared, and use firm proxy values to estimate a predicted debt ratio and compare it with the actual ratio.",
            "materialId": "6ad2ad06e474ab8460b47c14",
            "sourceIds": [
              "S393"
            ]
          },
          {
            "id": "E658",
            "objective": "Calculate Tata Motors’ predicted debt ratio using the regression for global automobile firms and compare it with Tata Motors’ actual debt ratio to determine whether it is overlevered.",
            "materialId": "6ad2ad06e474ab8460b47c14",
            "sourceIds": [
              "S394"
            ]
          },
          {
            "id": "E659",
            "objective": "Calculate a market debt-to-capital ratio using the regression for 2014 US listed firms and identify the variables used in the regression.",
            "materialId": "6ad2ad06e474ab8460b47c14",
            "sourceIds": [
              "S395"
            ]
          },
          {
            "id": "E660",
            "objective": "Estimate Disney’s optimal debt ratio using the debt regression and the supplied 2014 input values.",
            "materialId": "6ad2ad06e474ab8460b47c14",
            "sourceIds": [
              "S396"
            ]
          },
          {
            "id": "E661",
            "objective": "Explain what Disney’s estimated optimal debt ratio tells you and why it might differ from the optimal ratio calculated using the weighted average cost of capital.",
            "materialId": "6ad2ad06e474ab8460b47c14",
            "sourceIds": [
              "S396"
            ]
          },
          {
            "id": "E662",
            "objective": "Compare actual debt ratios with optimal debt-ratio estimates for Disney, Vale, Tata Motors, and Baidu across the operating income, standard cost of capital, enhanced cost of capital, APV, and comparable-to-industry and comparable-to-market methods, using the table’s company columns and method rows.",
            "materialId": "6ad2ad06e474ab8460b47c14",
            "sourceIds": [
              "S397"
            ]
          }
        ]
      },
      {
        "id": "L128",
        "themeIndex": 25,
        "loIndex": 1,
        "topic": "Capital Structure Decisions and Implementation",
        "name": "Apply leverage decision paths to classify leverage, test project quality against relevant required returns, select financing actions, and recommend immediate, gradual, or no adjustment; explain how transactions and changing prices affect debt ratios over time.",
        "contentHash": "bf685f9f41eb28a478703bcf64b00b8d3926b656748d05f74a420d84c0106cb0",
        "evidenceIds": [
          "E667",
          "E668",
          "E669",
          "E670",
          "E671",
          "E672",
          "E673",
          "E674",
          "E675",
          "E676",
          "E677",
          "E678",
          "E679",
          "E680",
          "E681",
          "E682",
          "E683",
          "E684",
          "E685",
          "E686",
          "E687",
          "E688",
          "E689",
          "E690",
          "E691"
        ],
        "materialIds": [
          "6ad2ad06e474ab8460b47c16"
        ],
        "sourceIds": [
          "S398",
          "S399",
          "S400",
          "S401",
          "S402",
          "S403",
          "S404",
          "S405",
          "S406"
        ],
        "learningPoints": [
          {
            "id": "E667",
            "objective": "Classify a firm’s financing mix as right, underlevered, or overlevered after analyzing it.",
            "materialId": "6ad2ad06e474ab8460b47c16",
            "sourceIds": [
              "S398"
            ]
          },
          {
            "id": "E668",
            "objective": "Evaluate whether moving to the optimal financing mix is worthwhile, how quickly to move, and which kind of financing to use for the adjustment.",
            "materialId": "6ad2ad06e474ab8460b47c16",
            "sourceIds": [
              "S398"
            ]
          },
          {
            "id": "E669",
            "objective": "Compare the actual debt ratio with the optimal debt ratio to determine whether the actual ratio is greater or lesser.",
            "materialId": "6ad2ad06e474ab8460b47c16",
            "sourceIds": [
              "S398"
            ]
          },
          {
            "id": "E670",
            "objective": "Use the actual-versus-optimal debt-ratio comparison to distinguish an overlevered firm from an underlevered firm and identify the corresponding decision path.",
            "materialId": "6ad2ad06e474ab8460b47c16",
            "sourceIds": [
              "S399"
            ]
          },
          {
            "id": "E671",
            "objective": "For an overlevered firm, determine whether bankruptcy threat calls for rapid debt reduction and identify equity-for-debt swaps, asset sales used to repay debt, and lender renegotiation as debt-reduction methods.",
            "materialId": "6ad2ad06e474ab8460b47c16",
            "sourceIds": [
              "S399"
            ]
          },
          {
            "id": "E672",
            "objective": "Evaluate whether projects are good by comparing return on equity with cost of equity and return on capital with cost of capital when selecting a financing response to leverage.",
            "materialId": "6ad2ad06e474ab8460b47c16",
            "sourceIds": [
              "S399"
            ]
          },
          {
            "id": "E673",
            "objective": "For an underlevered firm that should increase leverage quickly, identify debt/equity swaps and borrowing to buy shares as methods.",
            "materialId": "6ad2ad06e474ab8460b47c16",
            "sourceIds": [
              "S399"
            ]
          },
          {
            "id": "E674",
            "objective": "For an overlevered firm without a bankruptcy threat, identify taking good projects with new equity or retained earnings as a response.",
            "materialId": "6ad2ad06e474ab8460b47c16",
            "sourceIds": [
              "S400"
            ]
          },
          {
            "id": "E675",
            "objective": "For an overlevered firm without good projects, identify paying off debt with retained earnings, reducing or eliminating dividends, and issuing new equity to pay off debt as responses.",
            "materialId": "6ad2ad06e474ab8460b47c16",
            "sourceIds": [
              "S400"
            ]
          },
          {
            "id": "E676",
            "objective": "For an underlevered firm with good projects, identify taking good projects with debt as a response; when deciding whether to return cash, distinguish paying dividends from buying back stock according to stockholder preference.",
            "materialId": "6ad2ad06e474ab8460b47c16",
            "sourceIds": [
              "S400"
            ]
          },
          {
            "id": "E677",
            "objective": "Apply the actual-versus-optimal debt-ratio decision tree to classify a firm as overlevered or underlevered and follow the corresponding branch.",
            "materialId": "6ad2ad06e474ab8460b47c16",
            "sourceIds": [
              "S401"
            ]
          },
          {
            "id": "E678",
            "objective": "Determine whether an underlevered firm is a takeover target and use stockholder dividend preference to choose between paying dividends and buying back stock.",
            "materialId": "6ad2ad06e474ab8460b47c16",
            "sourceIds": [
              "S401"
            ]
          },
          {
            "id": "E679",
            "objective": "Apply the underlevered-firm decision tree to assess takeover-target status and identify rapid leverage-increasing actions, including debt/equity swaps and borrowing to buy shares.",
            "materialId": "6ad2ad06e474ab8460b47c16",
            "sourceIds": [
              "S402"
            ]
          },
          {
            "id": "E680",
            "objective": "Use return on equity versus cost of equity and return on capital versus cost of capital to evaluate whether projects are good.",
            "materialId": "6ad2ad06e474ab8460b47c16",
            "sourceIds": [
              "S402"
            ]
          },
          {
            "id": "E681",
            "objective": "Apply the leverage decision tree to distinguish taking good projects with new equity or retained earnings from reducing debt when an overlevered firm lacks good projects.",
            "materialId": "6ad2ad06e474ab8460b47c16",
            "sourceIds": [
              "S403"
            ]
          },
          {
            "id": "E682",
            "objective": "For an underlevered firm with good projects, identify taking projects with debt; when projects are not suitable, use stockholder dividend preference to choose a cash-return action.",
            "materialId": "6ad2ad06e474ab8460b47c16",
            "sourceIds": [
              "S403"
            ]
          },
          {
            "id": "E683",
            "objective": "Evaluate project suitability using ROE > cost of equity and ROC > cost of capital.",
            "materialId": "6ad2ad06e474ab8460b47c16",
            "sourceIds": [
              "S403"
            ]
          },
          {
            "id": "E684",
            "objective": "Recommend an immediate leverage change, a gradual leverage change, or no leverage change based on analysis of a firm’s capital structure and investment record.",
            "materialId": "6ad2ad06e474ab8460b47c16",
            "sourceIds": [
              "S404"
            ]
          },
          {
            "id": "E685",
            "objective": "Recommend whether to pay off debt or buy back equity, or to take projects with equity or debt, as part of a financing-mix decision.",
            "materialId": "6ad2ad06e474ab8460b47c16",
            "sourceIds": [
              "S404"
            ]
          },
          {
            "id": "E686",
            "objective": "Use the decision-tree outcome to choose between paying dividends and buying back stock.",
            "materialId": "6ad2ad06e474ab8460b47c16",
            "sourceIds": [
              "S404"
            ]
          },
          {
            "id": "E687",
            "objective": "Identify ways to decrease the debt ratio, including selling operating assets and using the cash to pay down debt, issuing stock to retire debt, or having debt holders accept equity.",
            "materialId": "6ad2ad06e474ab8460b47c16",
            "sourceIds": [
              "S405"
            ]
          },
          {
            "id": "E688",
            "objective": "Identify ways to increase the debt ratio, including selling operating assets and using the cash to buy back stock or pay a special dividend, and borrowing to buy back stock or pay a special dividend.",
            "materialId": "6ad2ad06e474ab8460b47c16",
            "sourceIds": [
              "S405"
            ]
          },
          {
            "id": "E689",
            "objective": "Explain how dividends and stock buybacks reduce equity value and how debt repayments reduce debt value when changing debt ratios over time.",
            "materialId": "6ad2ad06e474ab8460b47c16",
            "sourceIds": [
              "S406"
            ]
          },
          {
            "id": "E690",
            "objective": "Explain why changing debt ratios over time is complicated by firm value changing, and calculate expected price appreciation from cost of equity and dividend yield.",
            "materialId": "6ad2ad06e474ab8460b47c16",
            "sourceIds": [
              "S406"
            ]
          },
          {
            "id": "E691",
            "objective": "Explain how debt changes over time in conjunction with changes in firm value.",
            "materialId": "6ad2ad06e474ab8460b47c16",
            "sourceIds": [
              "S406"
            ]
          }
        ]
      }
    ],
    "sources": [
      {
        "id": "S433",
        "localId": "C1.S1",
        "materialId": "6ad2ad06e474ab8460b47c16",
        "materialName": "Chapter 9: Capital Structure: The Financing Details.pdf",
        "chunkIndex": 0,
        "text": "You can take it slow.. Or perhaps not…   101\n\n\n\n\nAswath Damodaran\n\f                                              Maximize the value of the business (firm)\n\n\n\n\n           The Investment Decision                   The Financing Decision                    The Dividend Decision\n           Invest in assets that earn a              Find the right kind of debt           If you cannot find investments\n             return greater than the                 for your firm and the right               that make your minimum\n           minimum acceptable hurdle                 mix of debt and equity to            acceptable rate, return the cash\n                       rate                             fund your operations                 to owners of your business",
        "alias": "S12"
      },
      {
        "id": "S434",
        "localId": "C2.S1",
        "materialId": "6ad2ad06e474ab8460b47c16",
        "materialName": "Chapter 9: Capital Structure: The Financing Details.pdf",
        "chunkIndex": 1,
        "text": "The hurdle rate            The return                                                       How much         How you choose\nshould reflect the                                  The optimal         The right kind\n                       should reflect the                                                 cash you can       to return cash to\n riskiness of the                                   mix of debt             of debt\n                         magnitude and                                                         return          the owners will\n investment and                                      and equity          matches the\n                        the timing of the                                                 depends upon            depend on\n  the mix of debt                                  maximizes firm        tenor of your\n                       cashflows as well                                                     current &          whether they",
        "alias": "S13"
      },
      {
        "id": "S435",
        "localId": "C3.S1",
        "materialId": "6ad2ad06e474ab8460b47c16",
        "materialName": "Chapter 9: Capital Structure: The Financing Details.pdf",
        "chunkIndex": 2,
        "text": "cashflows as well                                                     current &          whether they\n and equity used                                       value                assets\n                       as all side effects.                                                   potential       prefer dividends\n     to fund it.                                                                            investment           or buybacks\n                                                                                           opportunities",
        "alias": "S14"
      },
      {
        "id": "S425",
        "localId": "C78.S1",
        "materialId": "6ad2ad06e474ab8460b47c14",
        "materialName": "Chapter 8: Capital Structure: Model and Applications.pdf",
        "chunkIndex": 77,
        "text": "Aswath Damodaran                                                          94\n\f             Debt to Capital    Net Debt to Capital                       Debt to Capital   Net Debt to Capital\n                 Ratio                Ratio                                   Ratio               Ratio\nCompany    Book      Market    Book         Market    Comparable        Book       Market   Book       Market\n           value     value     value        value     group             value      value    value      value\n                                                      US\nDisney     22.88%    11.58%     17.70%      8.98%                       39.03%    15.44%    24.92%     9.93%\n                                                      Entertainment\n                                                      Global\n                                                      Diversified\nVale       39.02%    35.48%     34.90%     31.38%     Mining & Iron     34.43%    26.03%    26.01%     17.90%",
        "alias": "S391"
      },
      {
        "id": "S426",
        "localId": "C79.S1",
        "materialId": "6ad2ad06e474ab8460b47c14",
        "materialName": "Chapter 8: Capital Structure: Model and Applications.pdf",
        "chunkIndex": 78,
        "text": "Vale       39.02%    35.48%     34.90%     31.38%     Mining & Iron     34.43%    26.03%    26.01%     17.90%\n                                                      Ore (Market\n                                                      cap> $1 b)\n                                                      Global Autos\nTata\n           58.51%    29.28%     22.44%     19.25%     (Market Cap> $1   35.96%    18.72%     3.53%     0.17%\nMotors                                                b)\n                                                      Global Online\nBaidu      32.93%     5.23%     20.12%      2.32%                       6.37%      1.83%    -27.13%    -2.76%\n                                                      Advertising",
        "alias": "S392"
      },
      {
        "id": "S427",
        "localId": "C80.S1",
        "materialId": "6ad2ad06e474ab8460b47c14",
        "materialName": "Chapter 8: Capital Structure: Model and Applications.pdf",
        "chunkIndex": 79,
        "text": "Aswath Damodaran                                                                                                  95\n\f§ Step 1: Run a regression of debt ratios on the variables that\n  you believe determine debt ratios in the sector. For example,\n   § Debt Ratio = a + b (Tax rate) + c (Earnings Variability) + d\n    (EBITDA/Firm Value)\n   Check this regression for statistical significance (t statistics) and\n   predictive ability (R squared)\n§ Step 2: Estimate the values of the proxies for the firm under\n  consideration. Plugging into the crosssectional regression, we\n  can obtain an estimate of predicted debt ratio.\n§ Step 3: Compare the actual debt ratio to the predicted debt\n  ratio.",
        "alias": "S393"
      },
      {
        "id": "S428",
        "localId": "C81.S1",
        "materialId": "6ad2ad06e474ab8460b47c14",
        "materialName": "Chapter 8: Capital Structure: Model and Applications.pdf",
        "chunkIndex": 80,
        "text": "Aswath Damodaran                                                           96\n\f§ Using a sample of 56 global auto firms, we arrived at the\n  following regression:\n   § Debt to capital = 0.09 + 0.63 (Effective Tax Rate) + 1.01 (EBITDA/\n     Enterprise Value) - 0.93 (Cap Ex/ Enterprise Value)\n   § The R squared of the regression is 21%. This regression can be used\n     to arrive at a predicted value for Tata Motors of:\n§ Predicted Debt Ratio = 0.09 + 0.63 (0.252) +1.01 (0.1167) - 0.93\n  (0.1949) = .1854 or 18.54%\n§ Based upon the capital structure of other firms in the\n  automobile industry, Tata Motors should have a market value\n  debt ratio of 18.54%. It is over levered at its existing debt\n  ratio of 29.28%.",
        "alias": "S394"
      },
      {
        "id": "S429",
        "localId": "C82.S1",
        "materialId": "6ad2ad06e474ab8460b47c14",
        "materialName": "Chapter 8: Capital Structure: Model and Applications.pdf",
        "chunkIndex": 81,
        "text": "Aswath Damodaran                                                           97\n\f§ Using 2014 data for US listed firms, we looked at the\n  determinants of the market debt to capital ratio. The regression\n  provides the following results –\nDFR = 0.27 - 0.24 ETR -0.10 g– 0.065 INST -0.338 CVOI+ 0.59 E/V\n             (15.79) (9.00) (2.71) (3.55)       (3.10)    (6.85)\n   DFR = Debt / ( Debt + Market Value of Equity)\n   ETR = Effective tax rate in most recent twelve months\n   INST = % of Shares held by institutions\n   CVOI = Std dev in OI in last 10 years/ Average OI in last 10 years\n   E/V = EBITDA/ (Market Value of Equity + Debt- Cash)\n         The regression has an R-squared of 8%.",
        "alias": "S395"
      },
      {
        "id": "S430",
        "localId": "C83.S1",
        "materialId": "6ad2ad06e474ab8460b47c14",
        "materialName": "Chapter 8: Capital Structure: Model and Applications.pdf",
        "chunkIndex": 82,
        "text": "Aswath Damodaran                                                        98\n\f§ Disney had the following values for these inputs in 2014.\n     Estimate the optimal debt ratio using the debt regression.\n     § Effective Tax Rate (ETR)                = 31.02%\n     § Expected Revenue Growth                 = 6.45%\n     § Institutional Holding % (INST)          = 70.2%\n     § Coefficient of Variation in OI (CVOI)   = 0.0296\n     § EBITDA/Value of firm (E/V)              = 9.35%\n     Optimal Debt Ratio\n     = 0.27 - 0.24 (.3102) -0.10 (.0645)– 0.065 (.702) -0.338 (.0296)+ 0.59\n     (.0935)\n     = 0.1886 or 18.86%\na.     What does this optimal debt ratio tell you?\nb.      Why might it be different from the optimal calculated using\n       the weighted average cost of capital?",
        "alias": "S396"
      },
      {
        "id": "S431",
        "localId": "C84.S1",
        "materialId": "6ad2ad06e474ab8460b47c14",
        "materialName": "Chapter 8: Capital Structure: Model and Applications.pdf",
        "chunkIndex": 83,
        "text": "Aswath Damodaran                                                              99\n\f                                         Disney          Vale           Tata Motors Baidu\n          Actual Debt Ratio              11.58%         35.48%            29.28%   5.23%\n          Optimal\n          I. Operating income            35.00%           —                 -\n          II. Standard Cost of capital   40.00%     30.00% (actual)       20.00%   10.00%\n                                                  50.00% (normalized)\n          III. Enhanced Cost of Capital 40.00%      30.00% (actual)       10.00%   10.00%\n                                                  40.00% (normalized)\n          IV. APV                        40.00%         30.00%            20.00%   20.00%\n          V. Comparable\n           To industry                   28.54%         26.03%            18.72%   1.83%\n           To market                     18.86%           —                 -",
        "alias": "S397"
      },
      {
        "id": "S436",
        "localId": "C4.S1",
        "materialId": "6ad2ad06e474ab8460b47c16",
        "materialName": "Chapter 9: Capital Structure: The Financing Details.pdf",
        "chunkIndex": 3,
        "text": "Aswath Damodaran                                                                                                                 102\n\f§ At the end of the analysis of financing mix (using whatever tool\n  or tools you choose to use), you can come to one of three\n  conclusions:\n   § The firm has the right financing mix\n   § It has too little debt (it is under levered)\n   § It has too much debt (it is over levered)\n\n§ The next step in the process is\n   § Determining whether to move to the optimal (is it worth the move\n     and disruption, if the value change is small?)\n   § If you decide to move, how quickly or gradually the firm should\n     move to its optimal?\n   § Assuming that it does, the right kind of financing to use in making\n     this adjustment..\n\n\nAswath Damodaran                                                           103\n\f                     Is the actual debt ratio greater than or lesser than the optimal debt ratio?",
        "alias": "S398"
      },
      {
        "id": "S437",
        "localId": "C5.S1",
        "materialId": "6ad2ad06e474ab8460b47c16",
        "materialName": "Chapter 9: Capital Structure: The Financing Details.pdf",
        "chunkIndex": 4,
        "text": "Actual > Optimal                                                            Actual < Optimal\n         Overlevered                                                                 Underlevered\n\n    Is the firm under bankruptcy threat?                                         Is the firm a takeover target?\n\n Yes                                    No                                     Yes                         No\n\nReduce Debt quickly                                                    Increase leverage\n1. Equity for Debt swap         Does the firm have good                quickly                      Does the firm have good\n2. Sell Assets; use cash        projects?                              1. Debt/Equity swaps         projects?\nto pay off debt                 ROE > Cost of Equity                   2. Borrow money&             ROE > Cost of Equity\n3. Renegotiate with lenders     ROC > Cost of Capital                  buy shares.                  ROC > Cost of Capital",
        "alias": "S399"
      },
      {
        "id": "S438",
        "localId": "C6.S1",
        "materialId": "6ad2ad06e474ab8460b47c16",
        "materialName": "Chapter 9: Capital Structure: The Financing Details.pdf",
        "chunkIndex": 5,
        "text": "Yes                            No\n                                                                                 Yes                                 No\n       Take good projects with     1. Pay off debt with retained\n       new equity or with retained earnings.                               Take good projects with\n       earnings.                   2. Reduce or eliminate dividends.       debt.\n                                   3. Issue new equity and pay off                                          Do your stockholders like\n                                   debt.                                                                    dividends?",
        "alias": "S400"
      },
      {
        "id": "S439",
        "localId": "C7.S1",
        "materialId": "6ad2ad06e474ab8460b47c16",
        "materialName": "Chapter 9: Capital Structure: The Financing Details.pdf",
        "chunkIndex": 6,
        "text": "Yes\n                                                                                                    Pay Dividends         No\n                                                                                                                          Buy back stock\n         Aswath Damodaran                                                                                                     104\n\f                     Is the actual debt ratio greater than or lesser than the optimal debt ratio?\n\n\n         Actual > Optimal                                                            Actual < Optimal\n         Overlevered                                                                 Actual (11.58%) < Optimal (40%)\n\n    Is the firm under bankruptcy threat?                                         Is the firm a takeover target?",
        "alias": "S401"
      },
      {
        "id": "S440",
        "localId": "C8.S1",
        "materialId": "6ad2ad06e474ab8460b47c16",
        "materialName": "Chapter 9: Capital Structure: The Financing Details.pdf",
        "chunkIndex": 7,
        "text": "No. Large mkt cap & positive\n Yes                                    No                                     Yes\n                                                                                                    Jensen’s a\nReduce Debt quickly                                                    Increase leverage\n1. Equity for Debt swap         Does the firm have good                quickly                      Does the firm have good\n2. Sell Assets; use cash        projects?                              1. Debt/Equity swaps         projects?\nto pay off debt                 ROE > Cost of Equity                   2. Borrow money&             ROE > Cost of Equity\n3. Renegotiate with lenders     ROC > Cost of Capital                  buy shares.                  ROC > Cost of Capital",
        "alias": "S402"
      },
      {
        "id": "S441",
        "localId": "C9.S1",
        "materialId": "6ad2ad06e474ab8460b47c16",
        "materialName": "Chapter 9: Capital Structure: The Financing Details.pdf",
        "chunkIndex": 8,
        "text": "Yes                            No                             Yes. ROC > Cost of capital                No\n       Take good projects with     1. Pay off debt with retained\n       new equity or with retained earnings.                               Take good projects\n       earnings.                   2. Reduce or eliminate dividends.       With debt.\n                                   3. Issue new equity and pay off                                          Do your stockholders like\n                                   debt.                                                                    dividends?",
        "alias": "S403"
      },
      {
        "id": "S442",
        "localId": "C10.S1",
        "materialId": "6ad2ad06e474ab8460b47c16",
        "materialName": "Chapter 9: Capital Structure: The Financing Details.pdf",
        "chunkIndex": 9,
        "text": "Yes\n                                                                                                    Pay Dividends         No\n                                                                                                                          Buy back stock\n         Aswath Damodaran                                                                                                      105\n\f§ Based upon your analysis of both the firm’s capital structure\n  and investment record, what path would you map out for the\n  firm?\n   a.     Immediate change in leverage\n   b.     Gradual change in leverage\n   c.     No change in leverage\n§ Would you recommend that the firm change its financing mix\n  by\n   a.     Paying off debt/Buying back equity\n   b.     Take projects with equity/debt",
        "alias": "S404"
      },
      {
        "id": "S443",
        "localId": "C11.S1",
        "materialId": "6ad2ad06e474ab8460b47c16",
        "materialName": "Chapter 9: Capital Structure: The Financing Details.pdf",
        "chunkIndex": 10,
        "text": "Aswath Damodaran                                                  106\n\f                       To decrease the debt ratio\n                   Sell operating assets        Issue new stock to retire\n                   and use cash to pay          debt or get debt holders to\n                   down debt.                   accept equity in the firm.\n\n\n                             Assets             Liabilities\n\n                        Cash                      Debt\n\n                        Opearing\n                        Assets in place\n                                                  Equity\n                        Growth Assets\n\n\n                     Sell operating assets      Borrow money and buy\n                     and use cash to buy        back stock or pay a large\n                     back stock or pay or       special dividend\n                     special dividend\n\n                                 To increase the debt ratio",
        "alias": "S405"
      },
      {
        "id": "S444",
        "localId": "C12.S1",
        "materialId": "6ad2ad06e474ab8460b47c16",
        "materialName": "Chapter 9: Capital Structure: The Financing Details.pdf",
        "chunkIndex": 11,
        "text": "To increase the debt ratio\n\nAswath Damodaran                                                              107\n\f§ To change debt ratios over time, you use the same mix of\n  tools that you used to change debt ratios gradually:\n   § Dividends and stock buybacks: Dividends and stock buybacks\n     will reduce the value of equity.\n   § Debt repayments: will reduce the value of debt.\n\n§ The complication of changing debt ratios over time is that firm\n  value is itself a moving target.\n§ If equity is fairly valued today, the equity value should\n  change over time to reflect the expected price appreciation:\n       § Expected Price appreciation = Cost of equity – Dividend Yield\n       § Debt will also change over time, in conjunction as firm value changes.",
        "alias": "S406"
      }
    ],
    "prompt": "Retained immutable source context; original prompt is not executed by this test."
  }
];

const clone = <T>(value: T): T => structuredClone(value);
function objective(id: string, name: string, source = 'S1'): GroundingObjective {
  return { id, name, topic: 'Financing operations', themeIndex: 0, loIndex: Number(id.slice(1)) - 1,
    contentHash: createHash('sha256').update(name).digest('hex'), evidenceIds: [`E${id.slice(1)}`], materialIds: ['material'], sourceIds: [source],
    learningPoints: [{ id: `E${id.slice(1)}`, objective: name, materialId: 'material', sourceIds: [source] }] };
}
function simpleBatch(): OutlineGroundingBatch {
  return { objectives: [objective('L1', 'Explain how dividends and buybacks change equity value.'), objective('L2', 'Calculate expected price appreciation from equity cost and dividend yield.')],
    sources: [{ alias: 'S1', id: 'section', materialId: 'material', materialName: 'Taught finance.pdf', chunkIndex: 0,
      text: 'Dividends and buybacks reduce equity value. Expected price appreciation = cost of equity minus dividend yield.' }], prompt: 'Original source review stays separate.' };
}
function plan(batches = [simpleBatch()]): OutlineCapabilityContext {
  return planOutlineCapabilityDistinctness(batches, OUTLINE_CAPABILITY_DISTINCTNESS)!;
}
function comparison(context: OutlineCapabilityContext, objectiveId: string, peerId: string, relation: OutlineCapabilityComparison['relation'] = 'distinct'): OutlineCapabilityComparison {
  const target = context.objectives.find(row => row.id === objectiveId)!, peer = context.objectives.find(row => row.id === peerId)!;
  const quote = (row: GroundingObjective) => [{ sourceId: row.sourceIds[0], quote: context.sources.find(source => source.alias === row.sourceIds[0])!.text.slice(0, 500) }];
  return { objectiveId, peerId, pairId: context.pairs.find(row => [row.firstId, row.secondId].includes(objectiveId) && [row.firstId, row.secondId].includes(peerId))!.id,
    relation, candidateOperation: target.name, peerOperation: peer.name,
    sharedCapabilities: relation === 'distinct' || relation === 'uncertain' ? [] : [{ operation: 'Apply the stated financing capability', candidateQuotes: quote(target), peerQuotes: quote(peer) }],
    candidateUniqueCapabilities: relation === 'distinct' || relation === 'partial-overlap' ? [{ operation: target.name, quotes: quote(target) }] : [],
    peerUniqueCapabilities: relation === 'distinct' ? [{ operation: peer.name, quotes: quote(peer) }] : [], reason: 'Scripted source-bound comparison; not a real semantic verdict.' };
}
function response(context: OutlineCapabilityContext, relation: OutlineCapabilityComparison['relation'] = 'distinct') {
  return { reviews: [], capabilityComparisons: context.nominations.flatMap(row => row.peerIds.map(peer => comparison(context, row.objectiveId, peer, relation))) };
}
function supported(context: OutlineCapabilityContext, raw = response(context)): Array<OutlineGroundingFinding & { capabilityComparisons: OutlineCapabilityComparison[] }> {
  const validation = validateOutlineCapabilityComparisons(raw, context);
  return context.candidateIds.map(id => ({ ...clone(context.objectives.find(row => row.id === id)!), status: 'supported' as const,
    reason: 'Scripted source support', citedSourceIds: context.objectives.find(row => row.id === id)!.sourceIds,
    coveredEvidenceIds: context.objectives.find(row => row.id === id)!.evidenceIds,
    topicFit: 'fits' as const, topicReason: 'Scripted independent grouping finding',
    capabilityComparisons: validation.findings.find(row => row.id === id)?.capabilityComparisons ?? [] }));
}

describe('whole-proposal capability nomination and immutable scoping', () => {
  it('preserves historical absence without parsing or inventing a new selector', () => {
    expect(planOutlineCapabilityDistinctness(null as never)).toBeUndefined();
    expect(() => planOutlineCapabilityDistinctness([], 'future' as never)).toThrow('structure-distinctness-protocol');
  });

  it('nominates all three actual cross-topic overlap pairs missed by credited-ID Jaccard', () => {
    const context = plan(retainedBatches);
    for (const [first, second] of [['L104', 'L127'], ['L105', 'L128'], ['L106', 'L128']]) {
      expect(context.nominations.some(row => row.objectiveId === first && row.peerIds.includes(second) || row.objectiveId === second && row.peerIds.includes(first))).toBe(true);
      expect(context.pairs.some(row => row.firstId === first && row.secondId === second)).toBe(true);
    }
    expect(context.nominations.every(row => row.peerIds.length <= 2 && !row.peerIds.includes(row.objectiveId))).toBe(true);
    expect(context.nominations.find(row => row.objectiveId === 'L128')!.peerIds).toEqual(['L105', 'L106']);
    expect(context.objectives.find(row => row.id === 'L104')!.name).toBe(retainedBatches[0].objectives[0].name);
  });

  it('retains full peers/originals once, scopes out unrelated chapters, and never reranks on a subset', () => {
    const global = plan(retainedBatches), context = selectOutlineCapabilityContext(global, ['L104']);
    expect(context.candidateIds).toEqual(['L104']); expect(context.nominations[0].peerIds).toContain('L127');
    expect(context.nominations[0].peerIds).toEqual(global.nominations.find(row => row.objectiveId === 'L104')!.peerIds);
    expect(new Set(context.objectives.map(row => row.id))).toEqual(new Set(['L104', ...context.nominations[0].peerIds]));
    expect(context.sources.length).toBeLessThan(global.sources.length);
    expect(new Set(context.sources.map(row => row.alias)).size).toBe(context.sources.length);
    const prompt = renderOutlineCapabilityDistinctness(context);
    for (const row of context.objectives) expect(prompt).toContain(row.name);
    const payload = JSON.parse(prompt.split('\n\n').at(-1)!);
    for (const source of context.sources) expect(payload.originalSections.find((row: { id: string }) => row.id === source.alias).text).toBe(source.text);
    for (const excluded of global.objectives.filter(row => !context.objectives.some(retained => retained.id === row.id))) expect(prompt).not.toContain(excluded.name);
    expect(context.proposalHash).toBe(global.proposalHash);
    assertOutlineCapabilityContext(context, selectOutlineCapabilityContext(global, ['L104']));
  });

  it('keeps canonical pair identity under reversed nomination and different packing order', () => {
    const context = plan(), reversed = plan([{ ...simpleBatch(), objectives: [...simpleBatch().objectives].reverse(), sources: [...simpleBatch().sources].reverse() }]);
    expect(context.contextHash).toBe(reversed.contextHash);
    const a = selectOutlineCapabilityContext(context, ['L1']), b = selectOutlineCapabilityContext(context, ['L2']);
    expect(a.pairs[0].id).toBe(b.pairs[0].id); expect(a.pairs[0].firstId).toBe('L1'); expect(a.pairs[0].secondId).toBe('L2');
  });

  it.each(['wording', 'original', 'nomination', 'pair-order', 'source-omission', 'protocol'] as const)('refuses changed context authority: %s', changed => {
    const original = plan(), context = clone(original);
    if (changed === 'wording') context.objectives[0].name += ' with an unreviewed extension';
    if (changed === 'original') context.sources[0].text += ' Changed bytes';
    if (changed === 'nomination') context.nominations[0].peerIds = [];
    if (changed === 'pair-order') [context.pairs[0].firstId, context.pairs[0].secondId] = [context.pairs[0].secondId, context.pairs[0].firstId];
    if (changed === 'source-omission') context.sources = [];
    if (changed === 'protocol') context.protocolHash = 'f'.repeat(64);
    expect(() => assertOutlineCapabilityContext(context, original)).toThrow();
  });

  it('binds changed original bytes even when a newly recomputed context is self-consistent', () => {
    const context = plan(), batch = simpleBatch(); batch.sources[0].text += ' Additional original condition.';
    const changed = plan([batch]); expect(changed.pairs[0].id).not.toBe(context.pairs[0].id);
    expect(() => assertOutlineCapabilityContext(changed, context)).toThrow('context-changed');
  });

  it('rejects duplicate/foreign originals, invalid point ownership and oversized objective supply explicitly', () => {
    const batch = simpleBatch();
    expect(() => plan([batch, batch])).toThrow('proposal-identity');
    expect(() => plan([batch, { ...batch, objectives: [], sources: [{ ...batch.sources[0], text: 'Different original bytes' }] }])).toThrow('original-identity');
    batch.objectives[0].learningPoints[0].materialId = 'foreign'; expect(() => plan([batch])).toThrow('proposal-identity');
    const tooMany = simpleBatch(); tooMany.objectives = Array.from({ length: 401 }, (_, index) => objective(`L${index + 1}`, `Distinct operation ${index + 1}`));
    expect(() => plan([tooMany])).toThrow('proposal-identity');
    expect(() => selectOutlineCapabilityContext(plan(), ['L1', 'L1'])).toThrow('selection-identity');
  });

  it('does not truncate one oversized exact original to make its context fit', () => {
    const batch = simpleBatch(); batch.sources[0].text = 'Taught original. '.repeat(20000);
    expect(() => plan([batch])).toThrow('original-identity');
  });

  it('returns the actual current helper source-byte protocol identity', () => {
    expect(outlineCapabilityDistinctnessProtocolHash()).toMatch(/^[a-f0-9]{64}$/);
    expect(plan().protocolHash).toBe(outlineCapabilityDistinctnessProtocolHash());
  });

  it('omits only an undefined optional locator before real BSON round-trip and retains exact original bytes', () => {
    const batch = simpleBatch(); batch.sources[0].localId = undefined;
    const context = plan([batch]); expect(Object.hasOwn(context.sources[0], 'localId')).toBe(false);
    const stored = BSON.deserialize(BSON.serialize(context, { ignoreUndefined: false })) as OutlineCapabilityContext;
    expect(stored.sources[0].text).toBe(batch.sources[0].text);
    expect(() => assertOutlineCapabilityContext(stored, context)).not.toThrow();
  });
});

describe('strict same-call capability comparisons', () => {
  it('preserves two different source-taught operations even when they use the same original', () => {
    const batch = simpleBatch(), actual = retainedBatches.flatMap(row => row.sources).find(row => row.alias === 'S406')!;
    batch.sources[0].text = actual.text;
    const context = plan([batch]), raw = response(context);
    for (const row of raw.capabilityComparisons) {
      const explanation = 'Dividends and stock buybacks\n     will reduce the value of equity.';
      const calculation = 'Expected Price appreciation = Cost of equity – Dividend Yield';
      row.candidateUniqueCapabilities[0].quotes[0].quote = row.objectiveId === 'L1' ? explanation : calculation;
      row.peerUniqueCapabilities[0].quotes[0].quote = row.peerId === 'L1' ? explanation : calculation;
    }
    const validation = validateOutlineCapabilityComparisons(raw, context);
    expect(validation.failures).toEqual([]); expect(validation.findings).toHaveLength(2);
    expect(assessOutlineCapabilityAdmission(context, supported(context, raw))).toMatchObject({ complete: true, eligibleIds: ['L1', 'L2'], held: [] });
  });

  it.each(['partial-overlap', 'equivalent', 'uncertain'] as const)('holds unchanged %s wording even with source support', relation => {
    const context = plan(), raw = response(context, relation);
    const checked = validateOutlineCapabilityComparisons(raw, context); expect(checked.failures).toEqual([]);
    const receipt = assessOutlineCapabilityAdmission(context, supported(context, raw));
    expect(receipt.complete).toBe(true); expect(receipt.eligibleIds).toEqual([]);
    expect(receipt.held.every(row => row.reasons.includes(relation))).toBe(true);
  });

  it('keeps the actual broad L128 held for separate narrowing rather than treating a unique subclaim as cleanup', () => {
    const context = plan(retainedBatches);
    const raw = response(context, 'partial-overlap');
    expect(raw.capabilityComparisons.filter(row => row.objectiveId === 'L128').map(row => row.peerId)).toEqual(['L105', 'L106']);
    expect(raw.capabilityComparisons.every(row => row.candidateUniqueCapabilities.length)).toBe(true);
    const receipt = assessOutlineCapabilityAdmission(context, supported(context, raw));
    expect(receipt).toMatchObject({ complete: true, eligibleIds: [] });
    expect(receipt.held).toContainEqual({ id: 'L128', reasons: ['partial-overlap'] });
  });

  it.each(['missing-array', 'null-array', 'unknown-envelope-key', 'missing-reviews'] as const)('rejects the malformed same-call envelope: %s', changed => {
    const context = plan(); const raw: Record<string, unknown> = response(context);
    if (changed === 'missing-array') delete raw.capabilityComparisons;
    if (changed === 'null-array') raw.capabilityComparisons = null;
    if (changed === 'unknown-envelope-key') raw.budget = { verdict: 'approved' };
    if (changed === 'missing-reviews') delete raw.reviews;
    expect(validateOutlineCapabilityComparisons(raw, context)).toMatchObject({ findings: [], failures: [{ id: 'L1' }, { id: 'L2' }] });
  });

  it.each(['missing', 'null', 'foreign-peer', 'foreign-source', 'nonliteral-quote', 'null-quote', 'empty-quotes', 'extra-row-key', 'duplicate', 'reversed-role', 'reversed-pair'] as const)(
    'withholds malformed target while retaining a valid sibling: %s', changed => {
      const context = plan(), raw = response(context); const row = raw.capabilityComparisons[0];
      if (changed === 'missing') raw.capabilityComparisons.shift();
      if (changed === 'null') raw.capabilityComparisons[0] = null as never;
      if (changed === 'foreign-peer') row.peerId = 'L999';
      if (changed === 'foreign-source') row.candidateUniqueCapabilities[0].quotes[0].sourceId = 'S999';
      if (changed === 'nonliteral-quote') row.candidateUniqueCapabilities[0].quotes[0].quote = 'A plausible but unprinted finance statement';
      if (changed === 'null-quote') row.candidateUniqueCapabilities[0].quotes[0].quote = null as never;
      if (changed === 'empty-quotes') row.candidateUniqueCapabilities[0].quotes = [];
      if (changed === 'extra-row-key') Object.assign(row, { sourceSupport: 'supported' });
      if (changed === 'duplicate') raw.capabilityComparisons.push(clone(row));
      if (changed === 'reversed-role') [row.objectiveId, row.peerId] = [row.peerId, row.objectiveId];
      if (changed === 'reversed-pair') row.pairId = `CP${context.pairs[0].bindingHash.slice(0, 32).split('').reverse().join('')}`;
      const checked = validateOutlineCapabilityComparisons(raw, context);
      expect(checked.findings.some(row => row.id === 'L1')).toBe(false);
      if (changed !== 'reversed-role') expect(checked.findings.map(row => row.id)).toEqual(['L2']);
      expect(checked.failures.length).toBeGreaterThan(0);
    });

  it('rejects candidate quote witnesses taken only from the peer original', () => {
    const batch = simpleBatch(); batch.sources.push({ ...batch.sources[0], alias: 'S2', id: 'other-section', text: 'Only peer-original information is printed here.' });
    batch.objectives[1].sourceIds = ['S2']; batch.objectives[1].learningPoints[0].sourceIds = ['S2'];
    const context = plan([batch]);
    // Different-source nomination can still arise from lexical similarity.
    if (!context.nominations[0].peerIds.length) {
      batch.objectives[1].name = `${batch.objectives[0].name} Calculate a different output.`;
    }
    const nominated = plan([batch]), raw = response(nominated);
    raw.capabilityComparisons[0].candidateUniqueCapabilities[0].quotes = [{ sourceId: 'S2', quote: 'Only peer-original information' }];
    expect(validateOutlineCapabilityComparisons(raw, nominated).failures.some(row => row.id === 'L1')).toBe(true);
  });

  it.each(['same-operation', 'distinct-with-shared', 'equivalent-with-unique', 'partial-without-shared'] as const)('rejects self-contradictory semantic fields: %s', changed => {
    const context = plan(), raw = response(context), row = raw.capabilityComparisons[0];
    if (changed === 'same-operation') row.peerOperation = `  ${row.candidateOperation.toUpperCase()}  `;
    if (changed === 'distinct-with-shared') row.sharedCapabilities = comparison(context, 'L1', 'L2', 'equivalent').sharedCapabilities;
    if (changed === 'equivalent-with-unique') row.relation = 'equivalent';
    if (changed === 'partial-without-shared') row.relation = 'partial-overlap';
    expect(validateOutlineCapabilityComparisons(raw, context).failures.some(row => row.id === 'L1')).toBe(true);
  });

  it('refuses source support alone, unsupported operations, changed bindings and malformed attached comparisons', () => {
    const context = plan(), rows = supported(context);
    expect(assessOutlineCapabilityAdmission(context, rows.map(({ capabilityComparisons: _ignored, ...row }) => row))).toMatchObject({ complete: false, eligibleIds: [] });
    rows[0].status = 'unsupported'; rows[0].coveredEvidenceIds = [];
    expect(assessOutlineCapabilityAdmission(context, rows).eligibleIds).toEqual(['L2']);
    rows[0].status = 'supported'; rows[0].name += ' Invent an untaught stochastic model';
    expect(() => assessOutlineCapabilityAdmission(context, rows)).toThrow('source-binding-changed');
    const corrupt = supported(context); corrupt[0].capabilityComparisons = null as never;
    expect(assessOutlineCapabilityAdmission(context, corrupt)).toMatchObject({ complete: false, eligibleIds: [] });
  });

  it('holds inconsistent reverse verdicts instead of treating either direction as independent authority', () => {
    const context = plan(), rows = supported(context);
    rows[1].capabilityComparisons = [comparison(context, 'L2', 'L1', 'equivalent')];
    const receipt = assessOutlineCapabilityAdmission(context, rows);
    expect(receipt.complete).toBe(false); expect(receipt.eligibleIds).toEqual([]);
    expect(receipt.held.every(row => row.reasons.includes('comparison-missing-or-invalid'))).toBe(true);
  });

  it('binds exact comparison witnesses and source findings in the final local receipt', () => {
    const context = plan(), rows = supported(context), first = assessOutlineCapabilityAdmission(context, rows);
    rows[0].capabilityComparisons[0].reason += ' Additional recorded comparison detail.';
    const changed = assessOutlineCapabilityAdmission(context, rows);
    expect(changed.bindingHash).not.toBe(first.bindingHash); expect(changed.eligibleIds).toEqual(first.eligibleIds);
    expect(() => assessOutlineCapabilityAdmission(context, [...rows, rows[0]])).toThrow('source-identity');
  });

  it('replays more than one bounded call without applying the 32-row response ceiling to the whole proposal', () => {
    const batch = simpleBatch(); batch.objectives = Array.from({ length: 20 }, (_, index) => objective(`L${index + 1}`, `Assess source-taught financing operation ${index + 1}`));
    const context = plan([batch]);
    const rows = context.candidateIds.flatMap(id => supported(selectOutlineCapabilityContext(context, [id])));
    expect(rows.flatMap(row => row.capabilityComparisons).length).toBe(40);
    expect(assessOutlineCapabilityAdmission(context, rows)).toMatchObject({ complete: true, eligibleIds: context.candidateIds, held: [] });
    expect(validateOutlineCapabilityComparisons(response(context), context).findings).toEqual([]);
  });

  it('requires an explicit new-contract empty comparison array even when no peer is nominated', () => {
    const batch = simpleBatch(); batch.objectives = [batch.objectives[0]];
    const context = plan([batch]), rows = supported(context);
    expect(context.nominations[0].peerIds).toEqual([]);
    expect(assessOutlineCapabilityAdmission(context, rows)).toMatchObject({ complete: true, eligibleIds: ['L1'] });
    const { capabilityComparisons, ...missing } = rows[0]; expect(capabilityComparisons).toEqual([]);
    expect(assessOutlineCapabilityAdmission(context, [missing])).toMatchObject({ complete: false, eligibleIds: [], held: [{ id: 'L1', reasons: ['comparison-missing-or-invalid'] }] });
  });
});

describe('resolved source-ineligible peers and complete global admission', () => {
  // All source and comparison labels in this group are scripted. These cases
  // isolate local admission policy, not real model errors or semantic accuracy.
  const sourceIneligible = (context: OutlineCapabilityContext, relation: OutlineCapabilityComparison['relation'], status: 'unsupported' | 'uncertain') => {
    const rows = supported(context, response(context, relation));
    const peer = rows.find(row => row.id === 'L2')!;
    peer.status = status; peer.reason = 'Scripted resolved peer source finding'; peer.coveredEvidenceIds = [];
    return rows;
  };

  it.each((['unsupported', 'uncertain'] as const).flatMap(status =>
    (['partial-overlap', 'equivalent', 'uncertain'] as const).map(relation => ({ status, relation }))))(
    'does not hold the only supported candidate for a validated $relation to a resolved $status peer', ({ status, relation }) => {
      const context = plan(), rows = sourceIneligible(context, relation, status);
      const receipt = assessOutlineCapabilityAdmission(context, rows);
      expect(receipt).toMatchObject({ complete: true, eligibleIds: ['L1'], held: [{ id: 'L2' }],
        nonBlockingSourceIneligiblePeers: { version: 'resolved-source-ineligible-peers-v1', comparisons: [{
          objectiveId: 'L1', peerId: 'L2', pairId: context.pairs[0].id, relation, peerSourceStatus: status,
          peerSourceFindingHash: expect.stringMatching(/^[a-f0-9]{64}$/), comparisonHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        }] } });
      expect(receipt.held[0].reasons).toContain('source-not-supported');
      expect(rows[0].capabilityComparisons[0].relation).toBe(relation);
      expect(assessOutlineCapabilityAdmission(context, BSON.deserialize(BSON.serialize({ rows })).rows)).toEqual(receipt);
    });

  it('replays and binds canonical ignored negative coverage without treating it as credited coverage', () => {
    const context = plan(), rows = sourceIneligible(context, 'equivalent', 'unsupported');
    rows[1].ignoredModelCoverage = { authoritative: false, reason: 'negative-source-verdict', evidenceIds: [...rows[1].evidenceIds] };
    const first = assessOutlineCapabilityAdmission(context, rows);
    expect(first).toMatchObject({ complete: true, eligibleIds: ['L1'] });
    expect(rows[1].coveredEvidenceIds).toEqual([]);
    const priorHash = first.nonBlockingSourceIneligiblePeers!.comparisons[0].peerSourceFindingHash;
    rows[1].reason += ' A changed exact retained reason.';
    const changed = assessOutlineCapabilityAdmission(context, rows);
    expect(changed.nonBlockingSourceIneligiblePeers!.comparisons[0].peerSourceFindingHash).not.toBe(priorHash);
    expect(changed.bindingHash).not.toBe(first.bindingHash);
    rows[1].capabilityComparisons[0].reason += ' Different comparison metadata.';
    expect(assessOutlineCapabilityAdmission(context, rows).nonBlockingSourceIneligiblePeers!.comparisons[0].peerSourceFindingHash)
      .toBe(changed.nonBlockingSourceIneligiblePeers!.comparisons[0].peerSourceFindingHash);
  });

  it.each(['missing-source', 'unknown-status', 'missing-topic', 'foreign-citation', 'negative-with-credit', 'malformed-ignored-coverage',
    'missing-comparison', 'null-comparison', 'invalid-negative-peer-quote'] as const)(
    'never retires a peer or returns eligible IDs for incomplete or invalid review authority: %s', changed => {
      const context = plan(), rows = sourceIneligible(context, 'equivalent', 'unsupported');
      if (changed === 'missing-source') rows.pop();
      if (changed === 'unknown-status') rows[1].status = 'unknown' as never;
      if (changed === 'missing-topic') delete rows[1].topicReason;
      if (changed === 'foreign-citation') rows[1].citedSourceIds = ['S999'];
      if (changed === 'negative-with-credit') rows[1].coveredEvidenceIds = ['E2'];
      if (changed === 'malformed-ignored-coverage') rows[1].ignoredModelCoverage = { authoritative: true } as never;
      if (changed === 'missing-comparison') delete (rows[1] as Partial<typeof rows[number]>).capabilityComparisons;
      if (changed === 'null-comparison') rows[1].capabilityComparisons = null as never;
      if (changed === 'invalid-negative-peer-quote') rows[1].capabilityComparisons[0].sharedCapabilities[0].candidateQuotes[0].quote = 'Not in any exact original';
      const receipt = assessOutlineCapabilityAdmission(context, rows);
      expect(receipt).toMatchObject({ complete: false, eligibleIds: [] });
      expect(Object.hasOwn(receipt, 'nonBlockingSourceIneligiblePeers')).toBe(false);
    });

  it('does not complete a scoped candidate receipt before peer source findings are available', () => {
    const context = selectOutlineCapabilityContext(plan(), ['L1']);
    const receipt = assessOutlineCapabilityAdmission(context, supported(context));
    expect(receipt).toMatchObject({ complete: false, eligibleIds: [], held: [{ id: 'L1', reasons: ['review-incomplete'] }] });
    expect(Object.hasOwn(receipt, 'nonBlockingSourceIneligiblePeers')).toBe(false);
  });

  it('ignores a valid reciprocal disagreement involving a resolved source-ineligible peer', () => {
    const context = plan(), rows = sourceIneligible(context, 'equivalent', 'unsupported');
    rows[1].capabilityComparisons = [comparison(context, 'L2', 'L1', 'distinct')];
    expect(assessOutlineCapabilityAdmission(context, rows)).toMatchObject({ complete: true, eligibleIds: ['L1'],
      nonBlockingSourceIneligiblePeers: { comparisons: [{ objectiveId: 'L1', peerId: 'L2', relation: 'equivalent' }] } });
    rows[1].status = 'supported'; rows[1].coveredEvidenceIds = [...rows[1].evidenceIds];
    expect(assessOutlineCapabilityAdmission(context, rows)).toMatchObject({ complete: false, eligibleIds: [] });
  });

  it('still blocks another supported duplicate rather than using an excluded peer to clear all relations', () => {
    const batch = simpleBatch(); batch.objectives.push(objective('L3', 'Explain the equity-value effect of dividends and share buybacks.'));
    const context = plan([batch]), rows = sourceIneligible(context, 'equivalent', 'unsupported');
    const receipt = assessOutlineCapabilityAdmission(context, rows);
    expect(context.nominations.find(row => row.objectiveId === 'L1')!.peerIds).toContain('L3');
    expect(receipt).toMatchObject({ complete: true, eligibleIds: [] });
    expect(receipt.held.find(row => row.id === 'L1')!.reasons).toContain('equivalent');
    expect(receipt.held.find(row => row.id === 'L3')!.reasons).toContain('equivalent');
    expect(receipt.nonBlockingSourceIneligiblePeers!.comparisons.map(row => row.peerId)).toEqual(['L2', 'L2']);
  });

  it('keeps all supported equivalents held and omits the optional receipt rather than choosing a survivor or losing old credits', () => {
    const context = plan(), rows = supported(context, response(context, 'equivalent'));
    const receipt = assessOutlineCapabilityAdmission(context, rows);
    expect(receipt).toMatchObject({ complete: true, eligibleIds: [] });
    expect(new Set(rows.flatMap(row => row.coveredEvidenceIds))).toEqual(new Set(['E1', 'E2']));
    expect(rows[0].coveredEvidenceIds).not.toContain('E2');
    expect(Object.hasOwn(receipt, 'nonBlockingSourceIneligiblePeers')).toBe(false);
    expect(BSON.deserialize(BSON.serialize(receipt))).toEqual(receipt);
  });

  it('binds negative peer findings to the exact immutable wording, originals and active protocol', () => {
    const context = plan(), rows = sourceIneligible(context, 'equivalent', 'unsupported');
    const renamed = clone(rows); renamed[1].name += ' An unreviewed capability.';
    expect(() => assessOutlineCapabilityAdmission(context, renamed)).toThrow('source-binding-changed');
    const stale = clone(context); stale.sources[0].text += ' A later exact original revision.';
    expect(() => assessOutlineCapabilityAdmission(stale, rows)).toThrow('context-changed');
    const staleProtocol = clone(context); staleProtocol.protocolHash = '0'.repeat(64);
    expect(() => assessOutlineCapabilityAdmission(staleProtocol, rows)).toThrow('context-changed');
    const newer = simpleBatch(); newer.sources[0].text += ' A later exact original revision.';
    expect(assessOutlineCapabilityAdmission(plan([newer]), rows)).toMatchObject({ complete: false, eligibleIds: [] });
  });
});

describe('candidate source catalog, complete peer wording and actual send reconstruction', () => {
  interface Packet {
    candidateIds: string[];
    objectives: Array<Pick<GroundingObjective, 'id' | 'topic' | 'name' | 'evidenceIds' | 'materialIds' | 'sourceIds'> & { learningPointIds?: string[]; peerOnly?: true }>;
    learningPoints: GroundingObjective['learningPoints'];
    requiredComparisons: Array<{ objectiveId: string; peerId: string; pairId: string }>;
    originalSections: Array<{ id: string; material: string; chunkIndex: number; text: string }>;
  }
  const packet = (prompt: string) => JSON.parse(prompt.split('\n\n').at(-1)!) as Packet;
  function expectSourceCatalogRoundTrip(context: OutlineCapabilityContext, prompt: string): Packet {
    const serverContextBefore = JSON.stringify(context);
    const payload = packet(prompt), points = new Map(payload.learningPoints.map(point => [point.id, point]));
    expect(payload.candidateIds).toEqual(context.candidateIds);
    expect(payload.objectives.map(row => row.id)).toEqual(context.objectives.map(row => row.id));
    expect(payload.objectives.every(row => !Object.hasOwn(row, 'learningPoints'))).toBe(true);
    for (const row of payload.objectives) {
      const { learningPointIds, peerOnly, ...metadata } = row;
      const original = context.objectives.find(original => original.id === row.id)!;
      const { learningPoints } = original;
      const expectedMetadata = { id: original.id, topic: original.topic, name: original.name,
        evidenceIds: original.evidenceIds, materialIds: original.materialIds, sourceIds: original.sourceIds };
      expect(JSON.stringify(metadata)).toBe(JSON.stringify(expectedMetadata));
      for (const privateKey of ['contentHash', 'themeIndex', 'loIndex']) {
        expect(Object.hasOwn(row, privateKey)).toBe(false); expect(Object.hasOwn(original, privateKey)).toBe(true);
      }
      if (context.candidateIds.includes(row.id)) {
        expect(peerOnly).toBeUndefined(); expect(learningPointIds).toEqual(learningPoints.map(point => point.id));
        expect(JSON.stringify(learningPointIds!.map(id => { expect(points.has(id)).toBe(true); return points.get(id)!; }))).toBe(JSON.stringify(learningPoints));
      } else {
        expect(peerOnly).toBe(true); expect(Object.hasOwn(row, 'learningPointIds')).toBe(false);
      }
    }
    const expectedPoints = new Map(context.objectives.filter(row => context.candidateIds.includes(row.id)).flatMap(row => row.learningPoints.map(point => [point.id, point] as const)));
    expect(payload.learningPoints.length).toBe(expectedPoints.size);
    expect(new Set(payload.learningPoints.map(row => row.id)).size).toBe(payload.learningPoints.length);
    for (const point of payload.learningPoints) expect(JSON.stringify(point)).toBe(JSON.stringify(expectedPoints.get(point.id)));
    const expectedPairs = context.nominations.flatMap(row => row.peerIds.map(peerId => ({ objectiveId: row.objectiveId, peerId,
      pairId: context.pairs.find(pair => [pair.firstId, pair.secondId].includes(row.objectiveId) && [pair.firstId, pair.secondId].includes(peerId))!.id })));
    expect(payload.requiredComparisons).toEqual(expectedPairs);
    expect(payload.originalSections).toEqual(context.sources.map(({ alias, materialName, chunkIndex, text }) => ({ id: alias, material: materialName, chunkIndex, text })));
    for (const source of context.sources) expect(Buffer.from(payload.originalSections.find(row => row.id === source.alias)!.text, 'utf8')).toEqual(Buffer.from(source.text, 'utf8'));
    expect(JSON.stringify(context)).toBe(serverContextBefore);
    return payload;
  }

  it('round-trips every retained candidate point and required LO business field while keeping private bindings on the server', () => {
    const context = plan(retainedBatches), payload = expectSourceCatalogRoundTrip(context, renderOutlineCapabilityDistinctness(context));
    expect(payload.learningPoints.length).toBeLessThan(context.objectives.reduce((count, row) => count + row.learningPoints.length, 0));
    for (const pair of [['L104', 'L127'], ['L105', 'L128'], ['L106', 'L128']]) {
      expect(payload.requiredComparisons.some(row => pair.includes(row.objectiveId) && pair.includes(row.peerId))).toBe(true);
    }
  });

  it('round-trips quotes, Unicode, CRLF, whitespace, formula text and JSON-looking source bytes across twelve variations', () => {
    for (let index = 0; index < 12; index++) {
      const batch = simpleBatch(), suffix = `\r\n  β_${index} = "r" − δ; \\frac{x}{y} 😀\t\n\n{"reviews": ["source data only"]}  `;
      batch.sources[0].text += suffix; batch.sources[0].materialName += ` "Chapter ${index}" – β`;
      batch.objectives[0].name += suffix;
      batch.objectives[0].learningPoints[0].objective += suffix;
      batch.objectives[1].evidenceIds = [...batch.objectives[0].evidenceIds];
      batch.objectives[1].learningPoints = clone(batch.objectives[0].learningPoints);
      const global = plan([batch]);
      for (const ids of [['L1'], ['L2'], ['L2', 'L1']]) {
        const context = selectOutlineCapabilityContext(global, ids), payload = expectSourceCatalogRoundTrip(context, renderOutlineCapabilityDistinctness(context));
        expect(payload.learningPoints).toHaveLength(1); expect(payload.objectives).toHaveLength(2);
      }
    }
  });

  it('refuses conflicting definitions for one point ID instead of using the last whole row', () => {
    const batch = simpleBatch(); batch.objectives[1].evidenceIds = [...batch.objectives[0].evidenceIds];
    batch.objectives[1].learningPoints[0].id = batch.objectives[0].learningPoints[0].id;
    const context = plan([batch]);
    expect(() => renderOutlineCapabilityDistinctness(context)).toThrow('learning-point-alias-conflict');
    expect(() => renderOutlineCapabilityDistinctness(selectOutlineCapabilityContext(context, ['L1']))).toThrow('learning-point-alias-conflict');
  });

  it('selects candidate summaries explicitly while retaining every peer business field, full originals and private server bindings', () => {
    const batch = simpleBatch(); batch.objectives[1].learningPoints[0].objective = 'Private peer extraction summary kept only in server authority';
    const context = selectOutlineCapabilityContext(plan([batch]), ['L1']), prompt = renderOutlineCapabilityDistinctness(context);
    const payload = expectSourceCatalogRoundTrip(context, prompt);
    expect(payload.learningPoints.map(row => row.id)).toEqual(['E1']);
    expect(payload.objectives.find(row => row.id === 'L2')).toMatchObject({ peerOnly: true, name: batch.objectives[1].name, evidenceIds: ['E2'], sourceIds: ['S1'] });
    expect(context.objectives.find(row => row.id === 'L2')).toMatchObject({ learningPoints: batch.objectives[1].learningPoints,
      contentHash: batch.objectives[1].contentHash, themeIndex: batch.objectives[1].themeIndex, loIndex: batch.objectives[1].loIndex });
    expect(prompt).not.toContain(batch.objectives[1].learningPoints[0].objective);
  });

  it('measures rebuilt initial and retry-subset prompts rather than the empty persisted prompt/source placeholders', () => {
    const text = 'Dividends reduce equity value. Expected price appreciation equals equity cost minus dividend yield. '.repeat(10);
    const sections = [{ id: 'section', materialId: 'material', materialName: 'Full teaching notes.pdf', chunkIndex: 0, text }];
    const evidence: StructureEvidence[] = Array.from({ length: 7 }, (_, index) => ({ id: `E${index + 1}`, objective: `Assess financing operation ${index + 1}`,
      materialId: 'material', materialName: sections[0].materialName, chunkIndex: 0, quote: text }));
    const themes = [{ name: 'Financing operations', los: evidence.map(point => ({ name: point.objective, evidenceIds: [point.id], materialIds: [point.materialId] })) }];
    const limit = 16000, batches = planCapabilityOutlineGrounding(themes, evidence, sections, limit, OUTLINE_CAPABILITY_DISTINCTNESS) as CapabilityOutlineGroundingBatch[];
    expect(batches.length).toBeGreaterThan(1);
    expect(batches.flatMap(batch => batch.objectives.map(row => row.id))).toEqual(['L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'L7']);
    for (const stored of batches) {
      expect(stored.prompt).toBe(''); expect(stored.sources).toEqual([]);
      expect(stored.objectives.length).toBeLessThanOrEqual(4);
      for (const ids of [stored.objectives.map(row => row.id), [stored.objectives[0].id]]) {
        const send = selectCapabilityOutlineGroundingBatch(stored, ids) as CapabilityOutlineGroundingBatch;
        expect(send.prompt.length).toBeGreaterThan(1000);
        expect(estimateAuthoringTokens(send.prompt)).toBeLessThanOrEqual(limit);
        expect(estimateAuthoringTokens(send.prompt)).toBeGreaterThan(estimateAuthoringTokens(stored.prompt));
        expect(send.capabilityContext.nominations).toEqual(stored.capabilityContext.nominations.filter(row => ids.includes(row.objectiveId)));
        const payload = expectSourceCatalogRoundTrip(send.capabilityContext, send.prompt);
        expect(payload.originalSections).toHaveLength(1); expect(payload.originalSections[0].text).toBe(text);
        expect(send.prompt.split(JSON.stringify(text))).toHaveLength(2);
      }
    }
  });
});
