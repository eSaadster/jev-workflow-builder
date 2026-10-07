# X schedule score

Workflow `xP9wJo2bSP`, 10 posts, 2026-09-28.

**Score** = Σ weight × P(action), with production weights from xai-org/x-algorithm and assumed base rates scaled 0.5×–2× by the Jev judgment. 100 = a typical B2B post. A uniform out-of-network factor (0.75) applies to every post for non-followers, so it doesn't change the order.

| Rank | Wk | Day | Score | Verdict | reply | quote | share_dm | bookmark_link | follow | like_repost | dwell | negative | Top engagement lever |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 5 | Thu | 119 | rework | typ | HIGH | HIGH | low | typ | HIGH | typ | typ | bookmark_link (+17) |
| 2 | 2 | Tue | 117 | rework | HIGH | HIGH | HIGH | low | typ | HIGH | typ | typ | bookmark_link (+17) |
| 3 | 1 | Tue | 111 | rework | typ | HIGH | HIGH | low | typ | HIGH | typ | typ | bookmark_link (+18) |
| 4 | 2 | Thu | 107 | rework | low | HIGH | HIGH | typ | typ | HIGH | typ | typ | reply (+16) |
| 5 | 5 | Tue | 99 | rework | low | typ | HIGH | HIGH | HIGH | typ | typ | typ | reply (+17) |
| 6 | 3 | Tue | 98 | rework | typ | typ | HIGH | low | HIGH | typ | typ | typ | bookmark_link (+17) |
| 7 | 1 | Thu | 96 | rework | typ | HIGH | HIGH | low | typ | typ | typ | typ | bookmark_link (+17) |
| 8 | 3 | Thu | 95 | rework | typ | HIGH | typ | low | HIGH | HIGH | typ | typ | bookmark_link (+17) |
| 9 | 4 | Tue | 94 | rework | typ | HIGH | typ | low | HIGH | typ | typ | typ | bookmark_link (+16) |
| 10 | 4 | Thu | 92 | rework | low | HIGH | HIGH | typ | low | typ | typ | HIGH | reply (+17) |

`negative` is feedback risk: `low` is good.

## Schedule-level rules from the ranker

- **48-hour window.** The AgeFilter drops posts older than 48h, so each post gets about two days of For You distribution.
- **Tue → Thu overlap.** Those posts are about 48h apart, so at the edge of that window a viewer can be served both. Author diversity then multiplies the lower-scoring one by 0.625 (decay 0.5, floor 0.25). Posting Thu at least a few hours later in the day than Tue avoids it.
- **Original posts only.** OONRetweetReplyFilter drops replies and reposts from accounts the viewer doesn't follow, so a thread reply or a repost won't reach non-followers.
- **New-author boost.** Accounts under 1000 impressions get lifted toward a target position; this helps early posts but doesn't change their order.
- **Video.** video view quality weight is 0 and video open is 0.07. The talking-head and voice-memo formats earn ranking only through the text hook and the actions they drive.

## Notes per post

### 1. W5 Thu: If Your Best Salesperson Left Tomorrow, Would Your GTM Still Work? (119, rework)

1. Both checks failed. Reply is only typical, so reply pull is weak, and negative-feedback risk is only typical, not below_typical. The hook is a broad hypothetical (“best salesperson disappeared tomorrow”) and the CTA (“How much of your GTM lives in people’s heads?”) sounds like a diagnostic pitch, so it’s easy to skim or feel sold to instead of answering.

2. Hook: “What’s one GTM step only your top AE knows?”
CTA: “Reply with it in 3 words. Phi builds repeatable revenue systems.”

3. What’s one GTM step only your top AE knows? Reply with it in 3 words. Phi builds repeatable revenue systems.

### 2. W2 Tue: Your CRM Isn't Your Source of Truth Anymore. (117, rework)

Check failed: negative-feedback risk. Reply is above_typical, but negative-feedback risk is only typical, not below_typical. The hook “isn’t even visible in your CRM?” frames the CRM as a blind failure, which can trigger defensive mutes/blocks; the vague CTA invites broad complaints instead of a tight reply.

Rewritten hook: Which buying signal do you track outside your CRM: hiring spike, funding round, or pricing change?
Rewritten CTA: Reply with one. Phi Datasets turns those signals into intelligence.

Ready-to-post opening line:
Which buying signal do you track outside your CRM: hiring spike, funding round, or pricing change?
Reply with one. Phi Datasets turns those signals into intelligence.

### 3. W1 Tue: Why Does Your AI Know Everything About Your Business But Still Not Generate Pipeline? (111, rework)

Check that failed: Both.
Reply is only typical, so the hook/CTA are not pulling an easy answer; “Where is AI still disconnected from your GTM?” is broad and jargon-heavy. Negative feedback risk is also only typical, not below_typical, because the hook reads like a gotcha/blame line (“why is your sales team still researching accounts manually?”).

Rewritten hook: What’s one account-research step your team still does by hand even though AI is in the stack?
Rewritten CTA: Reply with the step—list building, call prep, or something else. (We build datasets + AI GTM workflows, so I’m mapping the gaps.)

Ready-to-post opening line for X, under 280 characters:
Even with AI in your stack, what’s one account-research step your team still does by hand: list building, call prep, or something else? Reply with the step. (We build datasets + AI GTM workflows, so I’m mapping the gaps.)

### 4. W2 Thu: Why Most AI Sales Agents Fail After the Demo (107, rework)

Check failed: both.

Reply pull is only typical because “Would your AI survive Monday morning?” is a rhetorical yes/no, not a specific low-effort answer. Negative-feedback risk is only typical because the hook sets up a generic “most AI agents fail” takedown, so it reads more like vendor critique than a conversation starter.

Rewritten hook: When your AI sales agent hit a real pipeline, what broke first: data, QA, routing, or monitoring?

Rewritten CTA: Reply with the first thing that broke. Phi builds this into the OS, not the demo.

Opening line for X:
Your AI sales agent looked great in the demo. Then Monday hit. What broke first: data, QA, routing, monitoring, or escalation?

### 5. W5 Tue: Your GTM Should Learn From Every Customer Interaction. (99, rework)

1. Check failed: both.
Reply is below_typical because the hook/CTA are abstract and rhetorical — “What if every call…” and “Does your GTM actually learn?” don’t ask for a concrete, one-line answer. Negative-feedback risk is only typical, not below_typical, because the post still reads like branded thought leadership and the CTA can feel like a pitch.

2. Rewritten hook: “What’s one thing a lost deal changed in your GTM this quarter?”
Rewritten CTA: “Reply with one field, question, or workflow you now use after a lost deal — that’s the learning half of signal → system → execution → learning.”

3. Ready-to-post opening line:
What’s one thing a lost deal changed in your GTM this quarter? Reply with one field, question, or workflow you now use after a lost deal — that’s the learning half of signal → system → execution → learning.

### 6. W3 Tue: AI Doesn't Replace the Sales Rep. It Changes What the Sales Rep Does. (98, rework)

1. Failed check: both. Reply is only typical, so reply pull is weak; negative feedback risk is only typical, not low. The hook is an abstract debate (“what should salespeople actually spend their time doing?”) and the CTA (“What would you automate first?”) is generic, so it doesn’t earn a fast specific reply and still reads slightly pitchy/defensive around AI replacing reps.

2. Rewritten hook: AI gives you back an hour on research and follow-ups. What’s the one sales task you’d spend it on?
Rewritten CTA: Reply with the task—one phrase. (Phi’s model: human judgment, AI execution.)

3. Ready-to-post opening line:
AI gives you back an hour on research and follow-ups. What’s the one sales task you’d spend it on instead? Reply with the task—one phrase. (Phi’s model: human judgment, AI execution.)

### 7. W1 Thu: Your GTM Team Doesn't Need More AI Tools. It Needs Fewer Manual Steps. (96, rework)

1. Failed: both. Reply is only typical, not above_typical; negative-feedback risk is only typical, not below_typical. The hook asks “How many AI tools…”—a vague inventory question—so replies take effort, and the CTA “Count how many tools…” turns it into homework plus a vendor pitch, which keeps negative-feedback risk from being low.

2. Hook: “What’s one manual GTM step you still do every week even after adding AI tools?”  
CTA: “Reply with just the step. Phi connects AI workers to GTM execution.”

3. Opening line for X:  
What’s one manual GTM step you still do every week even after adding AI tools? Reply with just the step—no explanation. I’ll go first: copying call notes into the CRM. Phi connects AI workers to GTM execution.

### 8. W3 Thu: The 2027 GTM Stack Won't Look Like the 2023 GTM Stack. (95, rework)

Check failed: both. Reply pull is only typical, and negative-feedback risk is only typical, not low. The hook is a hypothetical “would you buy the same tools?” and the CTA “What part of GTM will change most?” is abstract, high-effort, and invites hot takes or pitch-fatigue.

Rewritten hook: Which 2023 GTM tool are you replacing with an AI worker first?

Rewritten CTA: Name one: sequencer, enrichment, or reporting. (Phi Stack/go2market)

Ready-to-post opening line: Your 2027 GTM stack probably won't be 40 SaaS tabs. It'll be AI workers + a data layer + a few systems of record. Which 2023 tool are you cutting first: sequencer, enrichment, or reporting? (Phi Stack/go2market)

### 9. W4 Tue: AI Is Becoming Infrastructure — Not Software. (94, rework)

1. Failed check: both. Reply is only typical, so it is not above_typical; negative feedback risk is only typical, so it is not below_typical. The abstract hook (“What happens when…”) and binary CTA (“tool or infrastructure?”) invite positioning takes and a mild Phi pitch, not a specific personal answer.

2. Rewritten hook: “If AI went down for an hour, which revenue workflow breaks first?”
Rewritten CTA: “Reply with just the workflow name; Phi treats AI as machinery inside it.”

3. If AI went down for an hour, which revenue workflow breaks first: prospecting, routing, forecasting, or follow-up? Reply with just the one that stalls. Phi treats AI as machinery, not an app.

### 10. W4 Thu: Everyone Can Buy the Same AI Model. They Can't Buy Your Workflows. (92, rework)

Check failed: both. Reply is below_typical, so reply pull is weak; Negative feedback risk is only typical, not below_typical. The hook is a broad strategy question and the CTA asks people to reveal their “proprietary advantage,” so it’s easy to scroll past and not worth the risk to answer.

Rewritten hook: What’s one workflow your team runs that a competitor can’t copy by buying the same AI model?

Rewritten CTA: Reply with the workflow name. That’s where Phi’s systems fit.

Ready-to-post opening line:
Your AI model isn’t the moat. Your workflow is. What’s one workflow your team runs that a competitor can’t copy by buying the same model? Reply with the workflow name. That’s where Phi’s systems fit.

---

Level → multiplier: 0 → 0.5×, 1 → 1×, 2 → 2×. Base rates are in `.pi/scripts/lib/x-algorithm.mjs` and are assumptions, not values from X.