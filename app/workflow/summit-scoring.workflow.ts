/**
 * Future Action Summit scoring, as a Jev workflow-builder graph.
 *
 * Same decisions as the three scripts in the parent folder, expressed with
 * the node types in jev-workflow-builder (`input`, `jev`, `llm`, `output`).
 *
 * Long listing, from CANDIDATE SELECTION KEY.md:
 *   age (1–4) + profile (1–4) = longlist total (2–8).
 * The point-rating names (Minimally Relevant through Most Relevant) label
 * that total. They are not a second score.
 *
 * Fully funded ranking is separate and does not change the long-list total:
 * work done so far, impact quality, and motivation to amplify impact.
 * Age supports selection and does not override strong work and impact.
 *
 * Jev score levels are ordered lowest to highest. The level key is the
 * point value. All five questions sit on one Jev node. The scorecard is a
 * DeepSeek V4.1 Flash call after that.
 *
 * The builder rejects cycles, so the check-and-rewrite loop is unrolled
 * once. Verify reads the scorecard against the Jev scores and the
 * application. A pass publishes it. A fail rewrites it, checks once more,
 * and publishes that rewrite either way.
 *
 * Load this the same way the builder seeds its demo: `flow.addNodes(nodes)`
 * and `flow.addEdges(edges)` into Liveblocks storage under the `flow` key.
 * One run is one applicant. Put the application in `input.data.sample`, or
 * POST it as `{ "input": "..." }` to `/api/workflows/<id>/runs`.
 */

export const SUMMIT_SCORING_WORKFLOW_NAME =
  "Future Action Summit 2026 scoring";

/** Sections a run expects in `input`. One applicant per run. */
export const APPLICANT_INPUT_TEMPLATE = `Date of Birth: 14 March 2002
Field of Study/Profession: Community development, NGO
Motivation Letter:
I started a weekend reading circle in my town in 2023 after watching my younger sister drop out. Twelve girls came the first month. By 2025 we had 40, and two of them sat their exams. I want the summit because I need to see how other people keep a small program going after the first excitement fades.
What they hope to achieve:
Learn how to fund the circle without it depending on me.
Proof of Work / Initiatives:
Founded the reading circle in March 2023. 40 girls enrolled by 2025. Two sat secondary exams.`;

const COLUMN = 380;
const SCORECARD_MODEL = "deepseek-v4.1-flash";

const SCORECARD_LINES = `age_score:
profile_score:
longlist_total:
relevance:
work_done:
impact_quality:
amplify:
focus_reason:`;

const VERIFY_INSTRUCTIONS =
  "`input` contains the application followed by a scorecard. Answer yes only if every check passes. age_score equals `age_fit`. profile_score equals `profile_relevance`. longlist_total equals `age_fit` plus `profile_relevance`. relevance is the point-rating name for that total: 2 Minimally Relevant, 3 Slightly Relevant, 4 Moderately Relevant, 5 Fairly Relevant, 6 Relevant, 7 Highly Relevant, 8 Most Relevant. work_done equals `work_done`. impact_quality equals `impact_quality`. amplify equals `amplify`. focus_reason states only facts from the application, and it does not mark strong work down because of age.";

function verifyNode(id: string, questionId: string, position: { x: number; y: number }) {
  return {
    id,
    type: "jev" as const,
    position,
    data: {
      label: id === "verify" ? "Verify" : "Verify again",
      activation: "all" as const,
      questions: [
        {
          id: questionId,
          type: "noul" as const,
          instructions: VERIFY_INSTRUCTIONS,
          threshold: 0.7,
        },
      ],
    },
  };
}

function publishNode(id: string, position: { x: number; y: number }) {
  return {
    id,
    type: "llm" as const,
    position,
    data: {
      label: id === "publish" ? "Publish" : "Publish retry",
      model: SCORECARD_MODEL,
      activation: "any" as const,
      system:
        "You extract a scorecard. Return only the eight scorecard lines, unchanged. Plain text only.",
      prompt: `From the text below, return only these lines, exactly as written. Drop the application and any other text.

${SCORECARD_LINES}

Text:
{{input}}`,
    },
  };
}

export const summitScoringWorkflow = {
  name: SUMMIT_SCORING_WORKFLOW_NAME,
  nodes: [
    {
      id: "input",
      type: "input",
      position: { x: 0, y: 160 },
      deletable: false,
      data: {
        label: "Applicant",
        sample: APPLICANT_INPUT_TEMPLATE,
      },
    },
    {
      id: "screen",
      type: "jev",
      position: { x: COLUMN, y: 0 },
      data: {
        label: "Screen",
        activation: "any",
        questions: [
          {
            id: "age_fit",
            type: "score",
            instructions:
              "Using only the Date of Birth in `input`, compute the applicant's age in full years on 26 January 2026. Ignore every other field. The bands do not overlap. 18 through 32 is 4. 16 or 17, or 33 through 40, is 3. 41 through 45 is 2. 46 or older is 1. Under 16, or a missing, unparseable, negative, or over-100 age, is also 1.",
            levels: [
              {
                key: "1",
                description:
                  "Age on 26 January 2026 is 46 or older, or under 16. Also use this when the date of birth is missing, unparseable, negative, or over 100.",
              },
              {
                key: "2",
                description: "Age on 26 January 2026 is from 41 through 45.",
              },
              {
                key: "3",
                description:
                  "Age on 26 January 2026 is 16 or 17, or from 33 through 40.",
              },
              {
                key: "4",
                description: "Age on 26 January 2026 is from 18 through 32.",
              },
            ],
          },
          {
            id: "profile_relevance",
            type: "score",
            instructions:
              "Score the profile from occupation plus the interest shown in the motivation letter and what they hope to achieve, especially SDGs, social impact, volunteer activism, and extracurriculars. Choose the highest tier the text supports. Development, social impact, peacebuilding, education, climate, or public policy, or volunteer work on the SDGs, with strong motivation and alignment, is 4. IT, medical, management, or business, or some volunteer or SDG work, or high motivation to attend, is 3. Art, tourism, or construction, or limited volunteer or SDG work, or weak or unclear motivation, is 2. No relevant background and little motivation is 1.",
            levels: [
              {
                key: "1",
                description:
                  "No relevant background, and little motivation to attend or to the summit's purpose.",
              },
              {
                key: "2",
                description:
                  "Art, tourism, or construction, or only limited volunteer or SDG work, or weak or unclear motivation.",
              },
              {
                key: "3",
                description:
                  "IT, medical, management, or business, or some volunteer or SDG work, or high motivation to attend.",
              },
              {
                key: "4",
                description:
                  "Development, social impact, peacebuilding, education, climate, or public policy, or volunteer work on the SDGs, with strong motivation and alignment with the conference.",
              },
            ],
          },
          {
            id: "work_done",
            type: "score",
            instructions:
              "For fully funded ranking, not the long list. How much work has this person already done: projects, initiatives, or community work? Score finished work, not plans. Ignore age.",
            levels: [
              {
                key: "1",
                description: "No projects, initiatives, or community work.",
              },
              {
                key: "2",
                description:
                  "Mostly intentions, or only slight involvement in someone else's work.",
              },
              {
                key: "3",
                description:
                  "At least one real project, initiative, or stretch of community work.",
              },
              {
                key: "4",
                description:
                  "A clear record of projects, initiatives, or community work they have already carried out.",
              },
            ],
          },
          {
            id: "impact_quality",
            type: "score",
            instructions:
              "For fully funded ranking, not the long list. How strong is the impact of work already done: outcomes, who benefited, whether something actually changed, and whether it can last? Ignore age. Plans alone are not impact.",
            levels: [
              {
                key: "1",
                description: "No outcomes and no one who benefited.",
              },
              {
                key: "2",
                description: "Vague results, or a very small or unclear change.",
              },
              {
                key: "3",
                description:
                  "A noticeable result for a defined group of people.",
              },
              {
                key: "4",
                description:
                  "Real change for named beneficiaries, with some sign the work can last.",
              },
            ],
          },
          {
            id: "amplify",
            type: "score",
            instructions:
              "For fully funded ranking, not the long list. How strong is their motivation to amplify the impact: scale it, adapt it, learn, and carry it forward? Ignore age.",
            levels: [
              {
                key: "1",
                description: "No interest in growing or continuing the work.",
              },
              {
                key: "2",
                description: "A vague wish to learn, with no plan.",
              },
              {
                key: "3",
                description:
                  "A stated plan to learn, adapt, or keep the work going.",
              },
              {
                key: "4",
                description:
                  "A clear intention to scale, adapt, and take the work further.",
              },
            ],
          },
        ],
      },
    },
    {
      id: "scorecard",
      type: "llm",
      position: { x: COLUMN * 2, y: 0 },
      data: {
        label: "Scorecard",
        model: SCORECARD_MODEL,
        activation: "any",
        system:
          "You write a long-list scorecard for one Future Action Summit applicant. Copy the scores you are given. Age supports the long list and must not be used to mark down strong work or impact. Plain text only.",
        prompt: `Scores already decided by Jev. Copy them exactly.

age_score: {{answers.age_fit}}
profile_score: {{answers.profile_relevance}}
work_done: {{answers.work_done}}
impact_quality: {{answers.impact_quality}}
amplify: {{answers.amplify}}

longlist_total is age_score plus profile_score. Do not add work_done, impact_quality, or amplify into it.

relevance is the name for longlist_total: 2 Minimally Relevant, 3 Slightly Relevant, 4 Moderately Relevant, 5 Fairly Relevant, 6 Relevant, 7 Highly Relevant, 8 Most Relevant.

Applicant:
{{input}}

Reply in exactly this shape:

${SCORECARD_LINES}

focus_reason is one or two sentences on work already done, the change it made, and how they want to grow it. Use only facts from the application.`,
      },
    },
    verifyNode("verify", "scorecard_ok", { x: COLUMN * 3, y: 40 }),
    {
      id: "rewrite",
      type: "llm",
      position: { x: COLUMN * 4, y: 280 },
      data: {
        label: "Rewrite",
        model: SCORECARD_MODEL,
        activation: "any",
        system:
          "You correct a Future Action Summit long-list scorecard that failed verification. Copy the scores you are given. Do not invent projects. Age must not be used to mark down strong work or impact. Plain text only.",
        prompt: `The scorecard below failed verification. Write a corrected one. Copy these scores exactly.

age_score: {{answers.age_fit}}
profile_score: {{answers.profile_relevance}}
work_done: {{answers.work_done}}
impact_quality: {{answers.impact_quality}}
amplify: {{answers.amplify}}

longlist_total is age_score plus profile_score. Do not add the other three scores into it.

relevance is the name for longlist_total: 2 Minimally Relevant, 3 Slightly Relevant, 4 Moderately Relevant, 5 Fairly Relevant, 6 Relevant, 7 Highly Relevant, 8 Most Relevant.

Application and rejected scorecard:
{{input}}

Reply in exactly this shape:

${SCORECARD_LINES}

focus_reason is one or two sentences on work already done, the change it made, and how they want to grow it. Use only facts from the application.`,
      },
    },
    verifyNode("verify-again", "scorecard_ok_2", { x: COLUMN * 5, y: 280 }),
    publishNode("publish", { x: COLUMN * 4, y: 40 }),
    publishNode("publish-retry", { x: COLUMN * 6, y: 280 }),
    {
      id: "output",
      type: "output",
      position: { x: COLUMN * 7, y: 160 },
      deletable: false,
      data: {
        label: "Scorecard",
        activation: "any",
        properties: [{ id: "scorecard", name: "scorecard" }],
      },
    },
  ],
  edges: [
    edge("e-input-screen", "input", "out", "screen"),
    // Always handle. Carries every screen answer into the scorecard.
    edge("e-screen-scorecard", "screen", "any", "scorecard"),
    // Both texts: the application from Screen, the draft from Scorecard.
    edge("e-screen-verify", "screen", "any", "verify"),
    edge("e-scorecard-verify", "scorecard", "out", "verify"),
    edge("e-verify-publish", "verify", "q:scorecard_ok:yes", "publish"),
    edge("e-verify-rewrite", "verify", "q:scorecard_ok:no", "rewrite"),
    edge("e-screen-verify-again", "screen", "any", "verify-again"),
    edge("e-rewrite-verify-again", "rewrite", "out", "verify-again"),
    // Second check always publishes. The builder cannot send this edge back
    // to Rewrite, so the loop stops after one retry.
    edge("e-verify-again-publish", "verify-again", "any", "publish-retry"),
    edge("e-publish-output", "publish", "out", "output", "scorecard"),
    edge("e-publish-retry-output", "publish-retry", "out", "output", "scorecard"),
  ],
};

function edge(
  id: string,
  source: string,
  sourceHandle: string,
  target: string,
  targetHandle = "in"
) {
  return {
    id,
    type: "smoothstep" as const,
    source,
    sourceHandle,
    target,
    targetHandle,
    data: {},
  };
}
