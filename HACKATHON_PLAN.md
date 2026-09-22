# AyeOps — Hackathon Win Plan

**Competition:** AssemblyAI Voice Agent Hackathon (lablab.ai)
**Deadline:** Sep 30, 2026
**Current date:** Sep 22, 2026
**Days remaining:** 8

---

## Executive Summary

AyeOps is the most original and technically deep project in this hackathon. The competition has 101 submissions, but only 5–8 are real threats. We win on originality and security model. We lose on deployment, submission packaging, and business framing. This plan fixes those gaps.

**Win condition:** Deploy → Submit → Polish UI → Record video → Create slides → Collect votes.

---

## Competitive Landscape

### Who We're Against

| Threat Level | Project | Why They're Dangerous | Why We Beat Them |
|---|---|---|---|
| HIGH | **Voice Action Gate** | Same philosophy (safety gates), 152 tests, live demo | Their agent is a regex, not real LLM. End-to-end path not run. Read-back not implemented. We have all of this. |
| HIGH | **WalkAround** | Deepest AssemblyAI integration (progressive tools, state machine) | No public repo, no accessible demo, claims unverified. We have real Docker infra. |
| MEDIUM | **ClaimVoice** | 168 commits, enterprise-grade codebase | No live demo URL. Over-engineered — judges can't grok it in 30 seconds. |
| MEDIUM | **SAUTI AI** | 11 community votes (current leader), deployed on Vercel | Thin technical depth. Basic AssemblyAI integration. 0 GitHub stars. |
| MEDIUM | **Siberia** | Multi-tenant SaaS story, multilingual | No public GitHub. Demo unverified. We have stronger security model. |
| LOW | All others | Various | Not real threats — thin demos, basic chatbots, half-finished ideas |

### Dimension Scorecard (Current → After Plan Execution)

| Dimension | Current | Target | Key Move |
|---|---|---|---|
| Originality | TIE (Voice Action Gate) | **WIN** | Show we implemented what they only specified |
| AssemblyAI depth | LOSING (WalkAround) | **WIN** | Add keyterms, showcase session.update |
| Working product | TIE (Voice Action Gate) | **WIN** | Deploy to Vercel + Railway |
| Business story | LOSING (ClaimVoice, Siberia) | **WIN** | Frame TAM, revenue, target user |
| Tests / rigor | LOSING (152 vs our ~50) | **TIE/WIN** | Add 20–30 focused tests |
| Security model | **WINNING** | **WIN** | Maintain — showcase in video |

---

## Phase 1: Deploy (Sep 22–23)

**Goal:** Get a live URL that judges can visit.

### 1.1 Deploy Frontend to Vercel

```bash
cd web
npm ci && npm run build
# Push to GitHub, connect to Vercel
# Or: npx vercel --prod
```

- The static export is already configured (`output: "export"` in next.config.ts)
- Vercel serves from `web/out/`
- Expected URL: `https://ayeops.vercel.app` or similar

### 1.2 Deploy Backend to Railway

```bash
# Install Railway CLI
curl -fsSL https://railway.app/install.sh | sh

# Initialize and deploy
cd backend
railway init
railway up

# Set environment variables
railway variables set ASSEMBLYAI_API_KEY=your-key
railway variables set INFRA=sim
railway variables set ALLOWED_ORIGINS=https://ayeops.vercel.app
```

- Backend serves the static frontend from `web/out/`
- WebSocket endpoint: `wss://your-app.up.railway.app/ws`
- Alternative: Fly.io or Render if Railway doesn't work

### 1.3 Verify End-to-End

- [ ] Frontend loads at the Vercel URL
- [ ] WebSocket connects to the Railway backend
- [ ] "Start session" triggers AssemblyAI connection
- [ ] Autopilot mode works (no mic needed)
- [ ] LIMA CHARLIE flow completes
- [ ] Postmortem generates

### 1.4 Update README

Add deployed URL to README.md:
```markdown
**Live demo:** https://ayeops.vercel.app
```

---

## Phase 2: AssemblyAI Depth (Sep 23)

**Goal:** Showcase more AssemblyAI features than WalkAround.

### 2.1 Add Keyterms

In `relay.py`, when building the AssemblyAI session config, add keyterms:

```python
session_config = {
    # ... existing config ...
    "keyterms_prompt": [
        "auth-service", "api-gateway", "billing-worker",
        "rollback", "restart", "scale up", "crash-loop",
        "JWKS", "signing key", "502", "queue depth"
    ]
}
```

This boosts transcription accuracy for domain-specific terms. 10 lines of code.

### 2.2 Showcase Session.update

You already have phase-scoped tools. Make sure the video shows:
- `propose_remediation` tool doesn't exist outside an open incident window
- Tools are added/removed via `session.update` as phases change
- This is "progressive tool reveal" — the same pattern WalkAround claims

### 2.3 Document AssemblyAI Features Used

Create a section in the README or slides listing every AssemblyAI feature:
- Voice Agent API (full pipeline: STT + LLM + TTS)
- Streaming audio (real-time mic → relay → AssemblyAI)
- Tool calls (propose_remediation, execute_rollback, etc.)
- Session management (resume, reconnect after connection drop)
- Semantic turn-taking
- Keyterms prompting (added in this phase)
- Phase-scoped tool schemas via session.update

---

## Phase 3: Business Story (Sep 23–24)

**Goal:** Frame AyeOps as a business, not just a demo.

### 3.1 The Pitch (30-second version)

> "Incident management is a $4.4B market growing to $8.7B by 2030. SRE teams spend $500–2000/mo on tools that still require a human to click 'approve' at 3am — impaired, alone, and unaccountable. AyeOps replaces the entire on-call workflow: AI diagnoses autonomously, human authorizes by voice, relay executes. MTTR drops from 101 minutes to 29 seconds. Every change ships with a recording and postmortem. This is the first voice-authorized incident command system."

### 3.2 Key Numbers

| Metric | Value | Source |
|---|---|---|
| Incident management market | $4.4B (2024) → $8.7B (2030) | MarketsandMarkets |
| Median MTTR | 101 minutes | StackGen 2026 SRE report |
| AyeOps MTTR | 29 seconds | Measured in demo |
| Cost of downtime | $5,600/min (ITIC 2024) | Shown in dashboard |
| PagerDuty pricing | $21/user/mo | PagerDuty.com |

### 3.3 Target User

**SRE teams at mid-market SaaS companies (50–500 engineers).**
- They're on-call rotation
- They bypass approval during Sev-1s
- They need a second pair of eyes at 3am
- They already budget for incident management tools

### 3.4 Revenue Model

**SaaS: $500–2000/mo per team.**
- Replaces PagerDuty + incident.io + postmortem tooling
- Per-seat pricing for on-call engineers
- Enterprise tier for multi-team deployments

### 3.5 Why This Couldn't Exist Without AI

- LLM diagnoses from health endpoints (autonomous triage)
- Voice recognition for authorization (can't be forged by text)
- Real-time streaming for low-latency conversation
- Tool calling for infrastructure execution

---

## Phase 4: Tests (Sep 24–25)

**Goal:** Match or exceed competitor test counts with focused, meaningful tests.

### 4.1 Test Strategy

Don't chase 152 tests. Chase the RIGHT tests that tell a story.

### 4.2 Tests to Add

**Security gate tests (10):**
- `test_code_never_reaches_model_context` — verify the code is only in relay, never sent to AssemblyAI
- `test_readback_must_match_proposal` — operator must say the action AND service
- `test_veto_detection` — "no"/"cancel"/"stop" aborts execution
- `test_expired_code_rejected` — code past TTL is denied
- `test_double_authorization_blocked` — can't approve the same code twice
- `test_poisoned_log_ignored` — log injection doesn't trigger execution
- `test_model_cannot_self_approve` — model voice echoing through mic doesn't count
- `test_relay_only_execution` — only relay can trigger infrastructure changes
- `test_one_time_code_fresh` — each incident gets a unique code
- `test_code_not_in_transcript` — code words don't appear in AssemblyAI transcript

**End-to-end integration tests (10):**
- `test_full_incident_lifecycle` — deploy → diagnose → propose → authorize → execute → recover
- `test_connection_drop_recovery` — AssemblyAI disconnects, relay resumes with context
- `test_autopilot_full_run` — autopilot completes entire flow without human
- `test_multiple_services_affected` — cascading failure across services
- `test_refusal_on_bad_fix` — agent refuses restart on crash-looping service
- `test_postmortem_generation` — incident record created with all fields
- `test_cost_tracking` — cost-at-risk updates during incident
- `test_phase_transitions` — triage → mitigation → resolved flow
- `test_tool_schema_changes` — tools added/removed per phase
- `test_metrics_collection` — latency, recovery time, audio levels logged

**UI smoke tests (5):**
- `test_dashboard_renders` — page loads without errors
- `test_service_strips_visible` — all 3 services shown
- `test_clearance_code_display` — code words appear during authorization
- `test_waveform_active` — canvas shows voice activity
- `test_postmortem_panel` — report drawer opens with timeline

### 4.3 Test Command

```bash
cd backend
uv run pytest tests/ -v
```

Or add to `test_relay.py` and run:
```bash
uv run test_relay.py
```

---

## Phase 5: UI Polish (Sep 24–25)

**Goal:** Make the demo look like a real product, not a hackathon prototype.

### 5.1 Welcome Page

**Current:** Static preview card with headline.
**Target:** Auto-playing animation showing the clearance flow.

- Add a subtle animation where code words appear one by one (LIMA... CHARLIE...)
- Countdown timer ticks in the preview
- Services flash green in the background
- The hero tells the story without interaction

### 5.2 Dashboard Idle State

**Current:** Pulsing dot + "Watching production."
**Target:** Ambient life even when idle.

- Tiny sparklines on service strips (heartbeat-style)
- Faint waveform animation on the audio panel
- "Monitoring 3 services" counter that subtly ticks
- Cost-at-risk shows $0 but pulses when incident starts

### 5.3 Cost-at-Risk Counter

**Current:** Small monospace text in incident bar.
**Target:** Visually prominent during demo.

- Pulse or glow effect when cost ticks up
- Red gradient border around incident bar when cost > threshold
- Make it the first thing judges notice during an incident

### 5.4 Brand Identity

**Current:** Gradient radials (invisible on dark background).
**Target:** Faint ops-control-room texture.

- Very subtle grid or circuit-board pattern in background
- Not busy — just enough to feel intentional
- Reinforces the "control room" aesthetic

### 5.5 The LIMA CHARLIE Moment

This is the star of the demo. Make it visually distinctive:

- Code words appear large, centered, with a glow effect
- Countdown bar fills with color as time ticks
- Waveform shows operator speaking the code
- A checkmark appears when relay verifies
- This should be the most memorable visual in the entire hackathon

---

## Phase 6: Video (Sep 25–27)

**Goal:** 5-minute video that follows the exact judging rubric structure.

### 6.1 Video Structure

| Timestamp | Content | What Judges See |
|---|---|---|
| 0:00–0:30 | Problem statement | "At 3am, production breaks. The on-call engineer is impaired, alone, and unaccountable." |
| 0:30–2:30 | Live demo | Full LIMA CHARLIE flow: bad deploy → agent speaks → code → readback → rollback → green |
| 2:30–4:00 | Business case | Market size, revenue model, competitive comparison |
| 4:00–4:30 | Security model | "The approval code never reaches the model. The operator must say what they're approving." |
| 4:30–5:00 | Team + roadmap | Speaker verification, multi-tenant, public deployment |

### 6.2 Demo Recording Tips

- **Pre-fill everything.** No live typing. Have the demo state ready.
- **Use autopilot mode.** Shows the full flow without mic issues.
- **Record the screen at 1080p.** Judges view on laptops.
- **Narrate clearly.** Explain what's happening as it happens.
- **Show the code moment 3 times.** It's the most memorable part.
- **Cut any dead time.** If there's a 5-second pause, edit it out.

### 6.3 Tools

- OBS Studio (free) for screen recording
- DaVinci Resolve (free) for editing
- Or: Loom for quick recording

---

## Phase 7: Pitch Deck (Sep 27–28)

**Goal:** 8-slide PDF that tells the story in 3 minutes.

### 7.1 Slide Structure

| Slide | Title | Content |
|---|---|---|
| 1 | AyeOps | "Voice-Authorized Incident Command" + tagline |
| 2 | The Problem | "3am incident response is broken. Impaired, alone, unaccountable." |
| 3 | The Solution | "AI diagnoses. Human authorizes by voice. Relay executes." |
| 4 | Demo | Screenshot of LIMA CHARLIE moment |
| 5 | AssemblyAI Integration | List of features used (Voice Agent API, streaming, tools, keyterms) |
| 6 | Market | "$4.4B market, $5,600/min downtime, 101-min median MTTR" |
| 7 | Competition | Table vs PagerDuty, Cleric, incident.io — "They gate with clicks. We gate with voices." |
| 8 | Roadmap | Speaker verification, multi-tenant, public deployment |

### 7.2 Design Guidelines

- Dark theme (matches the dashboard aesthetic)
- One idea per slide, max 3 bullet points
- Use screenshots from the actual dashboard
- Include the AssemblyAI logo (sponsor integration signal)
- PDF format, 16:9 aspect ratio

### 7.3 Tools

- Figma (free) for design
- Canva (free) for quick slides
- Google Slides → export as PDF

---

## Phase 8: Submission (Sep 28)

**Goal:** Complete lablab.ai submission with all required materials.

### 8.1 Submission Form

Go to: https://lablab.ai/ai-hackathons/assemblyai-voice-agent-hackathon

**Required fields:**
- **Project Title:** AyeOps — Voice-Authorized Incident Command
- **Short Description (255 chars):** "AI diagnoses production failures, human authorizes fixes by voice reading a code the model never sees, relay executes. MTTR drops from 101 minutes to 29 seconds."
- **Long Description (100+ words):** Full problem/solution/market/story
- **Technology Tags:** AssemblyAI, Voice Agent API, FastAPI, Next.js, WebSockets, Python, TypeScript
- **Category Tags:** Security, Developer Tools, Voice Assistant
- **Cover Image:** PNG/JPG, 16:9 — use a screenshot of the LIMA CHARLIE moment
- **Video:** MP4, 5 minutes max
- **Slides:** PDF
- **GitHub Repo:** Public URL
- **Demo URL:** Your deployed Vercel/Railway URL
- **Application URL:** Same as demo URL

### 8.2 Submission Checklist

- [ ] GitHub repo is public
- [ ] README has deployed URL
- [ ] Demo URL works end-to-end
- [ ] Video is uploaded (MP4, <5 min)
- [ ] Slides are uploaded (PDF)
- [ ] Cover image is uploaded (16:9)
- [ ] All form fields completed
- [ ] Technology tags selected correctly
- [ ] Category tags selected correctly

---

## Phase 9: Votes (Sep 28–30)

**Goal:** Get community votes to match or exceed SAUTI AI (11 votes).

### 9.1 Where to Post

| Platform | What to Post | When |
|---|---|---|
| **lablab.ai Discord** | Demo video + "Built a voice-authorized incident command system" | Sep 28 |
| **LinkedIn** | Post with video clip of LIMA CHARLIE flow | Sep 28 |
| **X/Twitter** | Thread: "We built something no AI can fake" + video | Sep 28 |
| **r/SRE** | "We built a voice-authorized incident command system" | Sep 29 |
| **r/devops** | Cross-post | Sep 29 |
| **Hacker News** | "Show HN: Voice-Authorized Incident Command" | Sep 29 |
| **AssemblyAI community** | Tag @assemblyai | Sep 28 |

### 9.2 Vote Strategy

- Ask friends and colleagues to upvote on lablab.ai
- Each vote on the submission page counts
- Post in relevant communities where SRE/DevOps people hang out
- The LIMA CHARLIE video clip is viral-worthy — use it

### 9.3 Timeline

| Date | Action |
|---|---|
| Sep 28 | Submit on lablab.ai |
| Sep 28 | Post on Discord + LinkedIn + X |
| Sep 29 | Post on Reddit + HN |
| Sep 30 | Final push — share everywhere again |

---

## Master Timeline

| Date | Phase | Tasks | Hours |
|---|---|---|---|
| **Sep 22** | Deploy | Frontend to Vercel, backend to Railway | 3h |
| **Sep 23** | Deploy + Depth | Verify deployment, add keyterms, showcase session.update | 4h |
| **Sep 24** | Business + Tests | Write business story, start adding tests | 6h |
| **Sep 25** | Tests + UI | Finish tests, polish UI (welcome hero, idle state, LIMA CHARLIE moment) | 8h |
| **Sep 26** | Video | Record 5-min video, edit, export | 6h |
| **Sep 27** | Slides + Polish | Create 8-slide PDF, final UI tweaks | 4h |
| **Sep 28** | Submit + Promote | Submit on lablab.ai, post everywhere | 3h |
| **Sep 29** | Promote | Reddit, HN, community posts | 2h |
| **Sep 30** | Final | Last-minute polish, final vote push | 2h |

**Total: ~38 hours over 8 days.**

---

## Risk Mitigation

| Risk | Mitigation |
|---|---|
| AssemblyAI API down during demo | Have offline self-check (`test_relay.py`) as backup. Record video when API is working. |
| Deployment fails | Try multiple platforms (Railway → Fly.io → Render). Have local demo as fallback. |
| Video has bugs | Record early (Sep 26), re-record if needed. Have autopilot mode for reliable demo. |
| Low votes | Focus on quality over quantity. A strong demo video shared in right communities beats mass voting. |
| Judge can't access demo | Test the URL on multiple devices. Have a backup URL. |

---

## Success Metrics

| Metric | Target | How to Measure |
|---|---|---|
| Lablab.ai submission | Complete | Form submitted with all fields |
| Deployed demo URL | Live | Judges can visit and interact |
| Video | <5 min, follows rubric | Watch through once without skipping |
| Slides | 8 slides, PDF | Each slide has one clear idea |
| Tests | 30+ focused tests | `uv run test_relay.py` passes all |
| Community votes | 15+ | lablab.ai submission page |
| Dimension scores | Win 5/6 | See scorecard above |

---

## The One Sentence That Wins

Every piece of communication — video, slides, Discord post, LinkedIn — should land this:

> **"No AI touches production without a human's informed voice."**

This is the most original idea in the hackathon. Every other project says "the AI does the thing." You say "the AI proposes, the human authorizes, the relay executes, the model never holds the trigger." That's not a feature. That's a security model. That's what wins.
