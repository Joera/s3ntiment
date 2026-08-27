# s3ntiment — source dossier

**Purpose:** raw material for writing the whitepaper (and any other public document) later. This
is *not* a document to publish. It preserves rather than synthesises: claims with their sources,
phrasings with the versions that were rejected and why, arguments in note form, and explicit
markers where thinking has been superseded or where retrieval failed.

**Provenance convention:** each item is tagged with the chat it came from and the date. Where a
position is the user's own stated decision rather than a suggestion, it's marked **[user decision]**.
Where something was proposed but never confirmed, it's marked **[unconfirmed proposal]**.

**Companion documents:**
- `brain/specs/` — the code as it is, with 25 embedded decision records (DR-*).
- `brain/whitepaper/s3ntiment-whitepaper.md` — a first draft written from a partial sweep;
  supersede it using this dossier rather than editing it.
- Existing reference skills mentioned in history: a WaaP skill doc and `NILLION_SKILL.md`
  (Apr 2026, "WAAP wallet documentation guide") — worth locating, they contain integration detail
  not reproduced here.

---

## 1. The core argument

### 1.1 The one-sentence thesis

Several formulations, in order of how well they landed:

- **"Een organisatie die alleen een belofte doet, meet wat mensen zeggen. S3ntiment meet wat
  mensen denken."** — the version the user pushed for and kept. *("Sentiment positioning and
  behavioral research insights", Apr 2026)*
- "Wat je meet is wat mensen denken. Niet wat ze veilig vinden om te zeggen."
- English: "Know what people think. Without compromising who they are." *(one of four hero options,
  "Finding website copy with Dutch header", Apr 2026)*

### 1.2 The problem statement, long form

Organisations make decisions based on what people say they want, not what they actually want.

The worked example that recurs: an organisation considers a course change. The manager asks the
team — in a meeting, or via a survey called anonymous where everyone privately doubts it. Everyone
says "good plan." Privately eight of ten think it will fail. The decision is made on nine yeses and
one critical note; reality was the inverse. The organisation stalls and nobody understands why,
because the data showed support.

### 1.3 A distinction the user drew that sharpens the claim

**[user decision]** *("Sentiment positioning...", Apr 2026)* — the user pointed out these are two
different mechanisms and should not be conflated:

- **Criticism that isn't heard — the information problem.** Someone has a view, expresses it, and
  the organisation filters it out. Hierarchy, messenger effect, groupthink. The information exists
  but doesn't reach the decision-maker. This is a *communication* problem.
- **Consensus that is misread — the measurement problem.** Nobody expresses their real view. The
  decision-maker sees assent and reads it as support. But the assent wasn't an opinion — it was
  silence read as yes. **The data itself is corrupt.** This is a *data quality* problem.

**s3ntiment only solves the second — and that's the stronger claim**, because the first can be
attacked with better meeting culture, psychological safety, better managers (soft interventions).
The second is structural: as long as anonymity isn't *provably* trusted, every instrument produces
skewed data regardless of culture. You don't fix that with training. You fix it with architecture.

### 1.4 A correction the user made, worth remembering

Draft copy said surveys "measure how safe people feel to be honest." User objected: *"dit is niet
waar — want tov wat?"* The implication was that other survey tools know this and choose it anyway.
They don't know it. **They think they're measuring opinions while actually measuring perceived
safety.** That's the problem. Revised line: *"Een organisatie die alleen een belofte doet, denkt
meningen te meten."*

Also: the user rejected "veiligheidsperceptie" as jargon in customer-facing copy — "zeggen vs
denken" is the real contrast and everyone gets it immediately. Keep the concept, drop the word.

---

## 2. Evidence base

All from *"Sentiment positioning and behavioral research insights"* (Apr 2026) and *"Finding
website copy with Dutch header"* (Apr 2026), unless noted.

### 2.1 Named sources

| Source | Year | Finding | Use |
|---|---|---|---|
| **Stanley Warner — Randomized Response Technique** | 1965 | Respondent flips a coin, answers a sensitive or neutral question; researcher sees the answer but not which question, yet can compute correct aggregates. Reported rates of stigmatised behaviour (drug use, tax evasion, sexual behaviour) came out **2–3× higher** than under standard anonymous surveys. | **The core number.** Not "people shade the truth a bit" — people misreport *structurally and substantially* as soon as there's any chance of traceability. |
| **Ulrich Kohler; Ben Jann** | modern | Extended RRT, confirmed in organisational contexts. Jann shows that even in surveys *presented* as fully anonymous, respondents answer significantly differently once given instructions that **prove** anonymity, versus merely promising it. | The promised-vs-proven distinction has measurable effect on data quality. This is the empirical core of the whole pitch. |
| **Morrison & Milliken — "Organizational Silence: A Barrier to Change and Development in a Pluralistic World"** | 2000 | Employees systematically withhold information — not from laziness but from rational risk assessment. Term: **collective silence** — everyone stays quiet, and nobody knows the others are also staying quiet. | The organisational counterpart. Direct line: organisational surveys measure perceived safety, not opinion. |
| **Timur Kuran — preference falsification** | 1990s | People publicly state preferences that differ from their private ones, out of self-protection. | The macro frame. Noted as "particularly rich for the mediation/DAO use case." |
| **Marlowe–Crowne — social desirability bias** | 1960s+ | Respondents skew toward what they think the asker wants or what makes them look good. | Standard citation. |
| **Argyris & Schön — espoused theory vs theory-in-use** | — | People report what they believe they *should* believe, not what they act on. | |
| **Goffman — dramaturgical analysis** | — | People perform a version of themselves calibrated to the audience. | |

### 2.2 Quantitative claims to reuse

- **15–30% differences** in reported rates between face-to-face and anonymous survey modes, on
  sensitive topics (sexual behaviour, drug use, income, voting).
- **2–3×** increase under RRT vs standard anonymous surveys.
- Effect is **strongest in high-trust, high-accountability environments** — exactly where
  organisational surveys are run.
- Quality improves **across the board**, not only on sensitive items, because respondents relax
  general vigilance. *(This is the finding worth leading with.)*

### 2.3 Organizational silence — worked examples

From smallest to largest *(user asked specifically for these; they're good and reusable)*:

1. **The meeting where everyone nods.** A team discusses a timeline nobody thinks is realistic.
   PM asks "can we make the deadline?" Three people think no. Nobody says it; one says cautiously
   "it'll be tight." Manager records: team agrees. Six weeks later the deadline is missed. In the
   postmortem everyone knew. *The silence wasn't agreement — it was risk avoidance.*
2. **NASA Challenger, 1986.** Morton Thiokol engineers knew the O-rings failed at low temperature
   and had objected internally. In the decision meeting — NASA managers on the line, time pressure,
   hierarchy — the objection wasn't repeated forcefully enough. Managers read the absence of loud
   protest as technical approval. *They'd already been pushed back once; objecting again felt like
   a career risk.*
3. **Financial sector pre-2008.** Post-crisis investigations (incl. the Financial Crisis Inquiry
   Commission) documented that staff at banks and ratings agencies had internal doubts about
   mortgage-backed securities. Those doubts didn't reach management, or were filtered en route —
   not because the information didn't exist, but because the culture rewarded signals confirming
   the existing story.
4. **Employee satisfaction surveys — the most everyday case, and the one closest to the target
   customer.** HR promises anonymity, but: the system belongs to an external vendor and respondents
   don't know what it stores; small teams get broken out and with three people on a department
   everyone knows who the critic is; managers see per-team results. Result: people give a 7 where
   they mean a 4. The organisation thinks things are fine. Turnover rises unexplained.

### 2.4 The exit-interview paradox — a set piece worth keeping

**[user singled this out as strong]** Full paragraph as written:

> The most honest data arrives at the moment someone has nothing left to lose.
>
> Organisations run exit interviews as standard procedure. Strikingly, those conversations —
> held with people who are leaving — consistently yield more honest and more usable information
> than years of employee satisfaction surveys. People name what was actually going on: the manager,
> the culture, the decisions nobody agreed with and nobody spoke about. Not because they didn't
> know it before. Because the risk is gone.
>
> That's the paradox. The data an organisation most needs in order to improve only becomes
> available at the moment improvement is no longer relevant to that person. Every survey before
> that measured not opinion but perceived safety.

Note: "veiligheidsperceptie" in the last line is the jargon the user later rejected for web copy.
For a whitepaper it may be acceptable; for marketing, rephrase.

---

## 3. Positioning — the four pillars

Source: *"Veilige enquêtes zonder gatekeeper"* (Mar 2026), which is itself a summary thread of a
longer positioning conversation.

### 3.1 How they were arrived at

The user came in with six value-proposition bullets developed with another Claude instance, then
produced the better structure themselves: group the six under four pillars — two "values" pillars
and two "UX" pillars. This was described in-thread as **the real structural breakthrough**.

Key insight that followed: **use recognised regulatory/policy concepts as pillar headings**, so
DPOs, CISOs and compliance officers immediately recognise the language — then show that the
architecture actually delivers them, rather than promising them.

### 3.2 Final structure

**Pillar 1 — Privacy by design** (GDPR Art. 25)
- Layer 1: Your identity is yours alone.
- Layer 2: Access is enforced by math, not people.
- Layer 3: Your data is never whole in one place. → *"Not data minimisation as policy — data
  minimisation as architecture."*

**Pillar 2 — Data sovereignty** (EU digital sovereignty agenda)
- Infrastructure, not a platform.
- Built to be replaceable.
- We can't see your data.
- Plus the one honest caveat (§3.4).

**Pillar 3 — One invitation, one unique participation.**

**Pillar 4 — Continuous feedback.**

Ordering rationale: **lead with privacy — that's the compliance reader's pain point.**

### 3.3 The walk-away test

The operative check for pillar 2: *can a pool take its keys and data, stop using s3ntiment
entirely, and keep operating?*

Note on framing: an earlier version framed this around **s3ntiment's failure scenario** ("if we
disappear..."). It was reframed around **sovereignty** instead — the organiser's capability, not
the vendor's mortality. Better frame, same mechanism.

### 3.4 The honest caveat

The walk-away test passes on code (open source, organiser owns data) but **not cleanly on
infrastructure**: frontends need re-hosting, the Nillion backend needs redeploying, and **Nillion
is a company that issues API keys and could decide to stop.**

Framing: transparency as a trust-building move (DHH style — tell people where the weak spots are).
**[user check]** The user agreed with the principle but pushed back when Claude called it "the
strongest point on the page" — that was overreach. Keep the caveat; don't oversell it as a virtue.

### 3.5 Running themes identified in that thread

- **Architecture over policy** — enforce structurally what others promise contractually.
- **Transparency as trust** — honesty about Nillion beats a clean pitch.
- **DHH / 37signals tone** — opinionated and direct. *(Suggested by a friend of the user.)* Noted
  that Claude got checked when pushing this too far.
- **Regulatory grounding without legal jargon.**
- **Dutch–English fluidity**; the DHH tone works in both.

### 3.6 Precision corrections to keep

- **"wiskundig onmogelijk" → "cryptografisch gegarandeerd"** — more precise. *(Mar 2026.)*
  ⚠ Note this sits in tension with later copy that uses "wiskundig bewijs" and "niet als belofte,
  maar als wiskunde" freely. Unresolved: which register wins. See §11.
- GDPR language should **not** be sprinkled through copy — it adds formality without strength. One
  exception: the "data minimisation as architecture" line, because it makes exactly the contrast
  that is the core argument.

---

## 4. Audiences and phrasing bank

### 4.1 Two audiences, two stories

*("S3ntiment gebruikersgericht herontwerp", Apr 2026)* — **[user decision]** to split the page.

- **Respondent** wants to know: *why can I trust this, and how much effort will it cost me?* Must
  be convinced in 30 seconds; they were invited, they didn't seek this out. Keep it maximally
  low-threshold.
- **Organiser** wants to know: *what can I do with it, and how does it work?* May be somewhat more
  technical — they're making a deliberate purchase decision.

Structure landed on: single-page app — intro, then a respondent section, then an organiser section,
with two CTA buttons in the hero jumping to the right block.

### 4.2 Target segment

**[user decision]** *("Finding website copy with Dutch header", Apr 2026)* — the target is
**HR professionals**; the use-case label is **medewerkersonderzoek** / "onderzoek onder
medewerkers". Not "employees" as the buyer — HR/People teams are.

### 4.3 The seven respondent promises (the user's own original text)

Verbatim source material, Apr 2026. These are the substrate the whole public-facing story is
derived from:

1. Respondents remain owners of their own data. Answers can be adjusted or deleted. Answers are
   shared with the survey organiser.
2. You keep access to your data via your email address, without that email address being stored or
   registered. Your data is linked to an account mathematically derived from your email address.
   That anonymous account cannot be traced back to your email address.
3. Respondents are invited to a pool via a unique QR code — mathematical access to the questions
   with an unused, unique QR code issued by the organiser. Once you're in the pool, the organiser
   can invite you to other surveys without a unique code.
4. The organiser has access only to aggregated results. Nobody except you sees your answers in the
   context of the survey. Not the organiser, not s3ntiment.
5. s3ntiment is open source software running on neutral platforms. If we stop, results remain
   available to organisers and individual data to respondents.
6. Surveys can run continuously. The respondent adjusts answers, sentiment or status when their
   mind, opinion or feeling changes. The organiser can view a current result at any moment —
   a **barometer**.
7. Respondents can be rewarded for participation on their anonymous account in tokens, NFTs, or
   with a proof of participation.
8. Organisers of a pool can manage it collectively — decide who has access to results, who can set
   up new surveys, etc. **"Er is niet één persoon onder de organisatoren die meer rechten of macht
   heeft dan de anderen."** *(Flagged as a strong sentence — keep it.)*

*(Note: the user's original numbering had two 3s; there are eight items. Promise 7 — rewards — is
the one with no implementation and no decision record. See §11.)*

### 4.4 Organiser framing the user added, which flipped the story

**[user decision]** *("gebruikersgericht herontwerp", Apr 2026):*

> "voor organisatoren ... geen risico dat data van je respondenten lekt .. geen risico dat je zelf
> per ongeluk de privacy van je respondenten schendt .. automatisch GDPR compliant. niet juridisch
> maar wiskundig"

This turns the organiser story from *"we respect privacy"* into **"we protect *you* from risk"** —
noted as a much stronger frame. Three distinct organiser fears: data leak, accidentally violating
respondents' privacy yourself, and compliance exposure.

### 4.5 Copy blocks that survived iteration

**"Geen risico op datalekken"**
> Er is geen centrale database met respondentgegevens — dus ook niks om te hacken. Individuele
> antwoorden zijn versleuteld en alleen toegankelijk voor de respondent zelf. De organisator ziet
> alleen geaggregeerde resultaten.

**"Privacy by design"**
> Alle data wordt verwerkt zonder dat individuele antwoorden of profielen zichtbaar worden — niet
> voor de organisator, niet voor S3ntiment, niet voor derden. Dat maakt GDPR-compliance geen
> kwestie van beleid, maar van architectuur.

**"Eerlijke data, niet veilige antwoorden"** *(final version after two rejected drafts)*
> Traditionele enquêtes gaan ervan uit dat anonimiteitsbeloftes volstaan. Maar onderzoek toont aan
> dat respondenten structureel anders antwoorden naarmate anonimiteit bewezen is — niet beloofd.
> Het verschil is meetbaar. Een organisatie die alleen een belofte doet, meet wat mensen zeggen.
> S3ntiment meet wat mensen denken.

**Hero (Dutch), the direction the user picked and asked to double in length:**
> **Eerlijke antwoorden beginnen met privacy**
> Medewerkers vullen eerlijker in als ze weten dat hun antwoorden echt anoniem zijn — niet als
> belofte, maar als wiskunde. S3ntiment is een enquêteplatform waar niemand, ook wij niet, bij
> individuele antwoorden kan. Geen uitzonderingen. Geen achterdeurtjes. Alleen eerlijke antwoorden
> en de inzichten die je nodig hebt.

**Longer "why this works" block** *(built on the behavioural science):*
> Medewerkerstevredenheidsonderzoeken, klantfeedback, strategische consultaties — organisaties
> nemen dagelijks beslissingen op basis van enquêtedata. Maar die data meet zelden wat mensen
> werkelijk denken. [...] Er is een naam voor wat er dan gebeurt: organizational silence. Iedereen
> knikt in de vergadering. De enquête geeft groene cijfers. En pas in het exit-interview — als
> iemand niets meer te verliezen heeft — hoor je wat er echt speelde.

**Section tags:** "Secure · Private · Powerful" **[user decision]**.

### 4.6 Rejected phrasings and why

| Rejected | Why | Replacement |
|---|---|---|
| "veiligheidsperceptie" | jargon; the real contrast is simpler | "meet wat mensen zeggen / wat mensen denken" |
| "Ze meten hoe veilig mensen zich voelen om eerlijk te zijn" | falsely implies other tools know this and choose it | "denkt meningen te meten" — they don't know |
| "wiskundig onmogelijk" | imprecise | "cryptografisch gegarandeerd" (but see §11) |
| "uitschrijven" (of surveys) | formal/bureaucratic Dutch | "aanmaken" / "opzetten" |
| Crypto/Web3 vocabulary throughout — tokens, NFTs, wallets, smart contracts | scares off the non-crypto reader | "wiskundige bewerking die niet terug te draaien is" is the most technical phrase allowed |
| "Custom OPRF integration" as a pricing tier feature | Claude invented it; OPRF isn't per-survey customisable, it's just how the thing works | — |
| Calling the honest caveat "the strongest point on the page" | overreach | keep the caveat, drop the boast |

---

## 5. Competitive landscape

### 5.1 BlockSurvey — the closest comparable

*("Privacy-preserving continuous feedback platform", Oct 2025)*

| Axis | BlockSurvey | s3ntiment |
|---|---|---|
| Privacy | Client-side encryption; **the survey creator holds the decryption keys** and can decrypt all responses | No individual response readable by anyone; only aggregates |
| Trust model | **Trust the survey creator** | Trust no one |
| Sybil resistance | Token gating, address verification | Invitation + on-chain nullifier burn |
| Identity | Decentralised ID via Stacks | Anonymous account derived from email |
| Storage | Gaia decentralised storage | nilDB |
| Scope | General-purpose survey platform: AI features, templates, enterprise collaboration | Specialised: authentic sentiment with strong sybil resistance |

One-liner: **BlockSurvey is "private SurveyMonkey."** s3ntiment is for cases where *even the survey
creator* shouldn't see individual responses.

The capability BlockSurvey structurally cannot offer: **"prove you're in group X without revealing
your identity."**

**Revenue estimate (speculative, flagged as such at the time):** private company, no disclosed
figures. Freemium, ~$19–49/month plans, small team (<10). Guess: ~500–2,000 paying customers at
$25–35/month ≈ **$150K–840K ARR**. Compare: Typeform $100M+ ARR, SurveyMonkey $400M+ revenue.
⚠ These are Claude's estimates from Dec 2025, not researched figures — re-verify before use.

### 5.2 Mainstream survey tools — the breach record

*("Privacy-focused survey strategies", Sep 2025)* — useful as an argument that the promise-based
model fails in practice, not just in theory:

- **Typeform, 2018** — the most notable breach; thousands of organisations affected, unencrypted
  personal data exposed including Social Security Numbers.
- **Qualtrics, 2024** — health data breach; compromised credentials gave unauthorised access to
  Blue Cross Blue Shield NC customer accounts within Qualtrics' system.
- **SurveyMonkey, 2020** — not a breach of their systems, but attackers used the legitimate
  SurveyMonkey domain to bypass phishing filters, affecting 15,000–50,000 mailboxes.

**Systemic issues beyond breaches:**
- SurveyMonkey lets creators store respondent IP addresses; the privacy policy states device and
  browser data are collected. Their ToS: servers log details every time a device accesses them.
- SurveyMonkey's stated reason for collecting IPs is **to prevent duplicate submissions** — which
  makes explicit that neither creator nor respondent can be truly anonymous. **This is a gift of an
  argument**: the mainstream tools' own sybil resistance *requires* deanonymisation. s3ntiment's
  doesn't.
- Third-party supplier risk: companies can't fully vet vendors and take their word on security.

### 5.3 Mediation landscape

*("Private vs confidential", Dec 2025)*

- **Traditional AI mediation** — TheMediator.AI (~$5/session), NexLaw.ai. AI-assisted conflict
  resolution, but trust-based confidentiality, no cryptographic guarantees, can't handle
  pseudonymous participants.
- **Blockchain arbitration** — Kleros (1,500+ disputes resolved since 2019), Aragon Court.
  Decentralised but **fundamentally adversarial**: winners and losers by jury vote. No privacy
  (evidence is public on-chain/IPFS), no AI synthesis toward common ground.
- **The line:** *"Kleros = decentralised court. S3ntiment = decentralised therapy/facilitation."*
  Different markets, different problems.

### 5.4 Zupass — considered and dismissed

*("Privacy-preserving continuous feedback platform", Oct 2025)* — **[user decision]**, and the
reasoning is worth keeping because it shaped the positioning.

The user's own instinct: *"i see little point in proving i was at a conference, do you"* — correct.
Proving conference attendance is low-stakes, has easy alternatives (attendee lists, badges), matters
only briefly, and organisers have the records anyway.

The positioning move that followed:
- ❌ "Anonymous event attendance" / "Prove you were at DevCon"
- ✅ "Privacy-preserving market research with verified participants" / "Authentic citizen feedback
  without surveillance"

Zupass ZK primitives could in principle be a foundation, but would need significant extension for
persistent identity, multi-modal auth and continuous surveys.

### 5.5 Not a CRM

s3ntiment is not a CRM replacement — no individual customer tracking, no relationship management.
It's a privacy-first customer intelligence layer. Worth stating explicitly if selling to
organisations that will try to slot it into an existing category.

---

## 6. Use cases

### 6.1 Named and developed

- **Employee research / medewerkersonderzoek** — the primary target *(Apr 2026, user decision)*.
  Ties directly to organizational silence and the exit-interview paradox.
- **Event and conference feedback** — cards handed out create a time-and-place bound cohort;
  feedback can be updated as the event progresses.
- **Product development** — real user voices, evolving satisfaction over time, criticism without
  personal consequence.
- **Market research / longitudinal panels** — physical distribution guarantees real participants;
  track sentiment evolution; no bot manipulation.
- **Government / policy** — verified citizen input, urban planning input from actual residents.
  Anti-manipulation angle: prevents foreign interference, stops bot farms skewing results.
- **DAO governance and mediation** — see §9.

### 6.2 Two cohort types (the framing that generalises)

*("Private vs confidential", Dec 2025)*

- **Physical card** → *time-and-place bound cohort*: "people who were at this exhibition." Physical
  distribution *is* the quality control; exclusivity is tangible.
- **Email invitation** → *criteria-bound cohort*: "members", "past attendees", "contributors."
  Lower friction, targeted, supports reminders and re-invitation, scales without logistics.

Both preserve the property competitors can't offer: **cohort membership provable but anonymous.**

### 6.3 The category name

**"Verifiable anonymous cohort research"** — and separately, **"verified-honest data"** as distinct
from self-reported data. The latter is described as a *new category*: the distinction isn't about
who's lying, it's about the cognitive and social conditions under which honest expression is
possible at all.

---

## 6A. The panel protocol framing

**Added Aug 2026.** Sources: *"Web3 survey companies"* (Oct 2025), *"Crypto native opinion panels"*
(Oct 2025), and the Aug 2026 session in which the user re-raised it. **[user reframe]** — this is
the user's own framing, recovered after being dormant for roughly ten months.

### 6A.1 The reframe

s3ntiment is not (only) a survey tool sold to HR departments. It is **a protocol for running
respondent pools/panels** — infrastructure for a group of people to start their own YouGov or
Ipsos. First target: a crypto-native panel.

The user's original phrasing, Oct 2025: *"can we make a decentralized YouGov that scales if we
create the infrastructure?"*

### 6A.2 Why this matters structurally: the architecture already is this

A **pool is a panel**. The pool model (specs DR-C4, Mar 2026) says a standalone survey is a
degenerate case — a pool with exactly one survey, no special casing. Respondents join once, answer
many surveys over time, edit their answers as views change, and the pool is governed collectively
by a Safe rather than owned by a company.

That is the definition of a panel. **The positioning lagged the architecture by about a year.**

**Consequence — a caveat becomes a feature.** The whitepaper draft (§6.6) lists "cross-survey
correlation within a pool is possible and intended" as an honest caveat requiring disclosure. Under
the panel framing this is *the core capability*: longitudinal tracking of the same respondents is
precisely what distinguishes a panel from a series of one-off surveys. Cross-pool correlation
remaining impossible is the safeguard that makes it acceptable. Reframe accordingly — it is a
design property to explain, not a limitation to apologise for.

### 6A.3 The market gap (the Oct 2025 finding)

Searches in Oct 2025 concluded that **true crypto-native panel providers are very limited or
non-existent** — not "early stage", but absent. There is no "Respondent.io for crypto": no provider
maintains a verified database of crypto/NFT/DeFi users that researchers can recruit from.

What exists instead:
- **General research panels** (Respondent, User Interviews) where you screen for crypto users with
  custom questions — targeting by claimed behaviour, not verified holdings.
- **Crypto targeting tools** (e.g. Addressable) that match wallet holders to social profiles — built
  for advertising, not research.
- **Community recruitment** — token-gated surveys (BlockSurvey), Discord and Twitter. Low quality,
  unrepresentative, unverifiable.

⚠ These findings are from Oct 2025 and are ~10 months stale. Re-verify before making a
"nobody does this" claim publicly.

### 6A.4 How YouGov actually works (the model being decentralised)

From the Oct 2025 methodology search. Useful because each step is a design requirement s3ntiment
must either meet or deliberately reject.

- **Recruitment** — advertising, partnerships with a broad range of websites, social media ads using
  hot-topic/fun/lifestyle questions as the hook. Anyone adult can sign up. Panel of **29M+
  registered members across 55+ markets** *(figure as of Oct 2025)*.
- **Demographics on joining** — new panelists supply background information.
- **Active sampling** — for each survey, YouGov invites a *representative sub-sample* matched to the
  target population on age, gender, race, education, voting behaviour. Only the selected sub-sample
  can access the questionnaire; each respondent answers once.
- **Incentives** — points redeemable for small amounts of money or vendor equivalents. Notably,
  YouGov reports many panelists are motivated by wanting to contribute to research and be heard,
  not only by payment.
- **Weighting** — results statistically weighted post-hoc to correct differences between sample and
  target population on age, gender, social class, region, education.

A relevant detail from the same thread: Consensys' "State of Web3" surveys ran through YouGov on
**general population** samples (18,652 people, 18 countries, weighted) — because measuring adoption
requires surveying people who *aren't* users. Their Web3 Workforce survey (498 people) was the
opposite: industry-only. The distinction matters for what s3ntiment can and can't serve.

Claude's observation at the time, still true: *"That panel recruitment and maintenance is extremely
valuable — arguably more valuable than the survey infrastructure itself."* Consensys pays YouGov
because YouGov solved recruitment, not because it built better survey software.

### 6A.5 The moat inversion — who the customers actually are

The naive objection: the panel industry's defensibility is recruitment, not technology; a protocol
supplies none of it; so who does the expensive, unglamorous work of building a panel, and what does
s3ntiment capture if they do?

The answer is that this compares against the wrong customer. The target is **organisations that
already have a cohort and no way to run a panel on it**:

- A trade association with member firms
- A union with members
- A city with residents
- A DAO with contributors
- A media outlet with readers/subscribers
- A professional body with certified practitioners
- A cooperative of researchers wanting a shared sample frame
- An employer with employees *(the HR case — an employer running a continuous barometer is
  operating a panel; they just don't call it that)*

These groups don't need to buy panelists. They already have the cohort. What they lack is
infrastructure their members would actually trust with individual answers — a union surveying its
members on SurveyMonkey has a credibility problem no privacy policy solves.

**This also converts pillar 2 (collective governance, no privileged organiser) from an abstract
value into a product requirement.** A panel run by a member organisation *needs* collective
governance, because the members are the panel.

### 6A.6 Panel fraud — the strongest commercial argument in this framing

Panel fraud is an active crisis in market research: professional respondents, survey farms, VPN
users, duplicate accounts, and now AI-generated open-ended answers. The industry's answer is
screening and detection heuristics, which is a losing arms race.

s3ntiment's answer is structurally different: invitation scarcity plus one-time on-chain nullifier
burn. Crucially it is **provable to the buyer** — a research client can verify the sybil resistance
property rather than trusting the panel provider's QA claims.

Pair this with the SurveyMonkey argument from §5.2: mainstream tools prevent duplicate submissions
by storing respondent IP addresses, i.e. their sybil resistance *requires* deanonymisation.
s3ntiment's doesn't. Same property, opposite privacy cost. That contrast is the cleanest commercial
pitch in the archive.

⚠ No hard fraud statistics were retrieved. Find real figures before quoting any.

### 6A.7 The hard problem: sampling and representativeness — OPEN

**This is the genuine unsolved item, and it is a research-methods problem, not only an engineering
one.**

YouGov's apparatus — demographics on joining, active sampling to a matched sub-sample, post-hoc
weighting — requires knowing who your panelists are. s3ntiment deliberately stores nothing.

A plausible route, **[unconfirmed proposal, Aug 2026]**:
- Demographics collected as **encrypted survey answers within the pool**, not as registration
  metadata.
- Weighting computed **in aggregate** — "of respondents who reported age 25–34, X% said Y" is
  computable without identifying anyone.
- **Targeted invitation via a Lit Action** gating survey access on `isPoolMember AND matches
  criteria`, so a respondent proves eligibility without the operator learning who they are. This is
  architecturally consistent with the in-action condition checks that already exist (specs INV-5,
  DR-L4).

What remains unresolved even if that works:
- Quota sampling on an anonymous panel is not a solved method. You can't chase a quota you can't
  observe filling.
- Non-response bias is invisible: if a demographic systematically doesn't answer, you can't tell.
- Weighting requires knowing the *target population* distribution and the *achieved sample*
  distribution. The second is computable in aggregate; whether that's sufficient for defensible
  weighting needs an actual methodologist's view.
- Self-reported demographics can't be validated against anything.

**Honest framing option:** s3ntiment may not serve *general population representative research* at
all, and may not need to. Panels of *known cohorts* (members, employees, contributors, residents)
have a defined universe where representativeness is a different and easier problem — you know the
membership list size and composition even if you don't know who answered.

### 6A.8 What this framing makes harder

Two existing gaps get worse, not better:

- **Promise 7 (respondent rewards) becomes load-bearing.** Panels run on incentives — YouGov pays in
  points. Currently promise 7 has no implementation and no decision record (§11.2). Under the panel
  framing it is not optional. Paying anonymous accounts is one place crypto is straightforwardly
  better than the incumbent (gift cards, PayPal), so this is an advantage waiting to be built rather
  than a liability — but it must be built.
- **DR-N2 and GAP-10 move from shortfall to contradiction.** If the pitch is "panelists aren't the
  product, they own their data," then builder-owned collections with builder-written records
  contradict the *sales claim*, not merely an ideal. In the HR-tool framing this was a gap between
  architecture and aspiration; in the panel framing it undercuts the differentiator.

### 6A.9 Why crypto-native first

- The cohort is already wallet-native, so the identity layer is not friction.
- Ideologically aligned with the privacy claim — they'll actually check the cryptography, which is
  useful.
- A real unserved need (§6A.3), with no incumbent to displace.
- Crypto panels are notoriously sybil-prone and airdrop-farmer-infested, which makes them the
  **ideal proving ground** for the sybil-resistance claim. If it works there, the HR pitch writes
  itself.
- Small enough to bootstrap; DAOs need governance sentiment and current tooling (Snapshot-style
  voting) measures token weight, not opinion.

Risks to note: small market, low willingness to pay in a downturn, and possible reputational
mismatch if the eventual buyer is a Dutch HR department.

### 6A.10 Open questions specific to this framing

1. Does s3ntiment attempt general-population representative research at all, or explicitly scope to
   known-cohort panels? (§6A.7)
2. Who is the paying customer in the protocol model — the pool operator (subscription/licence), the
   research client buying access to a pool, or both?
3. Does a pool operator get to *sell* access to their panel to third-party researchers? If so, that
   is where respondent rewards and the "pool token" idea (§7.2) converge — and it needs consent
   mechanics.
4. Is "panel" or "pool" the public word? "Pool" is the code term; "panel" is the industry term the
   buyer already understands.
5. Does the HR/medewerkersonderzoek go-to-market survive as the beachhead, with panels as the
   narrative — or is it the reverse?


---

## 7. Business model

⚠ **Health warning on this whole section:** most of the numbers below are Claude-generated
projections from Oct–Dec 2025, produced in brainstorming mode. Only two items are marked as user
decisions. Treat the rest as *options that were discussed*, not commitments — and do not put any of
these projections in a public document without rebuilding them.

### 7.1 Firm user decisions

- **[user decision]** *"No token in first 3 years."* (Dec 2025) Tokens add complexity not needed
  early. Implication: pay-per-survey in stablecoins (DAI/USDC).
- **[user decision]** s3ntiment credentials are **non-transferable by design** — closer to
  soulbound tokens than to NFTs. The invite is issued to you; respondent status is yours; write
  access is yours. None should transfer — that's the point of verified human respondents.
  *(May 2026, "Nillion tokenomics explained")*

### 7.2 The structural insight about on-chain rights

*(May 2026, developed jointly with the user pushing back twice)*

- ERC-721/NFT/RWA = one object, one owner; the token *is* the unit; ownership is a property of the
  token.
- s3ntiment respondent registry = a list of addresses holding a right; the right is a property of
  the contract, not of a transferable object.
- Therefore **s3ntiment doesn't issue tokens at all in the current implementation. It issues
  membership** — your address is in the array or it isn't.
- The reframe: *"You don't need a token to implement a right on-chain. A smart contract can record,
  enforce and verify rights directly. A token is just one way to do that — chosen when you need
  the right to be transferable."*
- **Transferability is the axis** that determines whether something behaves as a financial
  instrument or as an identity/credential.
- A future **pool token** is noted as the deliberate exception — it *needs* transferability because
  it represents value flowing between data buyers and respondents. ⚠ This is the only reference to
  a pool token in the retrieved material; status unclear.

### 7.3 The respondent-compensation framing (strongest of the pricing angles)

The economic inversion, and the sharpest line in the pricing material:

> Traditional survey tools let anyone spam out surveys for free, then charge respondents' attention
> as the product. **S3ntiment inverts this: creators pay, respondents' privacy is sacred.**

Worked structure *(illustrative, not committed)*:
```
Survey creation fee: 1000 DAI
  600 DAI → protocol treasury (development, infra)
  400 DAI → respondent reward pool, split equally
            50 responses  = 8 DAI each
            100 responses = 4 DAI each
```
Pitch: *"When you pay to create a survey, 40% goes directly to the people giving you their time
and insight. The rest funds the cryptographic infrastructure. No VC extraction, no data mining, no
surveillance capitalism."*

Supporting arguments:
- **"Pay for outcomes, not software rent."** Traditional: $50/month whether you use it or not.
- **"Direct protocol payment"** — to a treasury multisig, transparent on-chain, not a company
  account.
- **Paying is a quality signal** — it means the survey matters enough to commit capital, and the
  creator is accountable for not wasting respondents' time.

### 7.4 Other revenue streams discussed (Web3-market framing, Oct 2025)

⚠ All Claude-generated, from a broader "Web3 survey companies" exploration — the framing is
crypto-native and may be off-target for the HR segment now identified.

1. **Survey creation fees** — Basic $500–2,000, Pro $5,000–15,000, Enterprise $25,000–100,000+.
2. **Data access subscriptions** — researcher $200–500/mo, analyst $2,000–5,000/mo, institution
   $10,000–50,000/mo. "Bloomberg Terminal for sentiment."
3. **Take rate on incentive tokens** — 10–20% on respondent payouts.
4. **Premium targeting & analytics** upsells.
5. **White-label** — $50,000–500,000/year.
6. **Sponsored research reports** — "State of X", title sponsor $50,000–200,000.
7. **Consulting / custom research** — $25,000–250,000 per project.

Revenue projections (Y1 ~$750K, Y2 ~$7.8M, Y3 ~$46M) were sketched. **Do not reuse these** — they
were illustrative and are not grounded.

Comparables cited: YouGov ~$200M revenue; Qualtrics sold for $8B; SurveyMonkey ~$500M; Messari
~$20M ARR; Nansen ~$20M ARR; Dune $150M valuation.

Anchoring arguments worth keeping: universities pay $500–5K+ per study for participant recruitment;
market research firms charge $10K–100K+ for cohort studies. So the value framing is *"this enables
research that literally couldn't be done otherwise"*, not *"cheaper survey software."*

### 7.5 The infrastructure-revenue problem (from the S2S parallel)

A structural point raised in a Soul2Soul thread that applies identically here: Netlify became
profitable by *owning* infrastructure and charging for usage. s3ntiment deliberately uses
rented/shared decentralised infrastructure it doesn't own or operate. That avoids the trap Gatsby
fell into, **but makes revenue structurally harder**. The open options are the same four: build a
hosting layer, offer managed protocol services, sell tooling, or stay pure protocol and fund via
ecosystem/grants. Unresolved for s3ntiment.

---

## 8. Infrastructure notes

### 8.1 Nillion — architecture vocabulary

*("Nillion tokenomics explained", May 2026 — the user corrected Claude twice here, so this version
is the accurate one)*

- **Petnet** — the blind compute and storage network (MPC, TEE, nilDB, nilAI). Nodes don't validate
  public transactions; each stores/processes a separate encrypted fragment. Marketing/umbrella term.
- **Coordination Layer** — formerly nilChain, now Nillion L2 on Ethereum. Staking, governance,
  payments, rewards.
- **Blacklight** — verification layer with its own node set, stakes NIL on the L2, verifies Petnet
  did its job. **Not** the L2 validator set.
- **In the developer docs only three components appear**: nilDB (encrypted storage), nilAI (private
  AI inference in a TEE), nilCC (private compute). **[user decision]** — use this vocabulary, it's
  more precise and more useful to anyone actually building.
- ~~nilVM~~ — deprecated, do not reference.

**Ethereum analogy** (user asked for it, and where it breaks): Petnet ≈ execution layer, Blacklight
≈ consensus/validation layer. But in Ethereum the layers are tightly coupled and validation is
mandatory and synchronous; Blacklight is separate and **asynchronous** — compute happens regardless,
verification is called when you need a proof. More audit mechanism than consensus requirement. Also
Ethereum secures both layers with one validator set and one stake; Nillion's Petnet and Blacklight
nodes are distinct operators with distinct stake requirements.

### 8.2 Nillion's two security layers

*("Nillion security layers overview", Oct 2025 — the user arrived at this framing independently and
asked for confirmation, which is a good sign it's the right mental model)*

- **Layer 1 — Access control (ACL).** Who can read, write, execute on a record. Parties identified
  by DID. Enforced at the API layer. Time-based permissions possible (tokens expire).
- **Layer 2 — Encryption / blind computation.** Even parties *with* access can't see plaintext.
  Secret sharing (Shamir/additive) splits data across nodes so no single operator can reconstruct;
  the `%allot` tag marks fields for client-side encryption before upload.

### 8.3 Compute platform comparison

*("Nillion security layers overview", Oct 2025)* — nilCC vs Fluence vs Akash:

- **nilCC** — Docker workloads in TEEs with hardware attestation. Max privacy; trust the
  cryptography + hardware. Early stage, privacy niche. Needs specialised TEE hardware.
- **Fluence** — enterprise-grade decentralised compute marketplace from professional data centres,
  up to 85% cheaper than AWS. Standard cloud security model. Production-ready.
- **Akash** — reverse-auction marketplace, up to 80% cheaper than AWS, AI/GPU focus. Standard
  container security. Mature, large community. 58M+ GB-hours leased, 428% YoY growth.

**Suggestion at the time:** if Nillion pricing is too high, Fluence or Akash could host the
frontend/API layer while nilDB handles the sensitive data. ⚠ Never followed up — status unknown.

**Important later correction** *(recorded in specs as DR-S1)*: putting the scoring answer key
decryption in a nilCC TEE was considered and judged **not sufficient** — the TEE stops s3ntiment
reading plaintext during computation, but s3ntiment still chooses which program runs and still
controls the builder DID. Platform risk moves, doesn't reduce. **[user pushed back on the nilCC
suggestion; this correction is theirs.]**

---

## 9. Mediation — the second product

*("Private vs confidential", Dec 2025)*

### 9.1 Sequencing

Surveys years 1–2 → mediation years 2–3+. The survey product proves the cryptographic privacy
works, builds trust in the community, and establishes reputation before launching the higher-value
offering.

### 9.2 Four types of mediation outcome

1. **Win-win expansion (1+1=3)** — both want different things; find a creative solution giving both
   more. AI role: generate novel options. Classic "expanding the pie."
2. **Latent consensus discovery (finding the 2 we already agreed on)** — arguing about the surface
   while aligned on fundamentals. AI role: strip posturing, reveal hidden common ground.
   **← this is what s3ntiment uniquely enables.** **[user's own distinction]** — they raised it:
   *"Mediation is also not always the same as 1+1=3, finding that latent consensus that moves
   forward."*
3. **Fair compromise** — genuine disagreement, split the difference. What most mediation does.
4. **Process clarification** — no actual conflict, just miscommunication (e.g. two teams building
   duplicate features because nobody knew). Often overlooked, very valuable.

### 9.3 Why privacy matters most for type 2

Without privacy: people posture publicly, reputation games prevent honesty, you can't admit
"actually I'd be fine with Y," surface positions entrench. With blind synthesis: submit real
position privately → AI finds "70% of you agree on core direction" → **reveal consensus without
exposing who said what** → people can update positions without losing face.

### 9.4 The worked example (reusable)

Public DAO forum: Contributor A "we need aggressive growth!", B "we need sustainable building!",
C "we need community focus!" — looks irreconcilable.

Private submissions, each qualified: growth *but only if we don't sacrifice quality*; sustainability
*but we need enough traction to survive*; community *but we need resources to support them*.

Synthesis: **"You all want measured growth that strengthens community."**

> Not 1+1=3, but revealing the 2 that was always there, hidden under different framings.

### 9.5 When there is no consensus

Sometimes there genuinely isn't latent agreement — half want to sell the protocol, half want to
build forever; token-holder faction vs builder faction; fundamental values conflict.

Value even then: you know there's no hidden consensus; the fault lines can be mapped clearly;
it distinguishes "we need to fork/split" from "we need more discussion" from "we disagree on
strategy but agree on values → separate workstreams."

### 9.6 The positioning rule

- **Don't sell as:** "We'll always find consensus!" (sometimes it doesn't exist)
- **Sell as:** *"We reveal what people actually think, stripped of posturing and reputation games.
  Sometimes that's hidden consensus. Sometimes that's irreconcilable differences. Either way,
  you'll know the truth."*

Longer version worth keeping close to verbatim:
> Most DAO conflicts happen in public forums where reputation is on the line. People defend
> positions they don't fully believe in. Compromise looks like weakness. S3ntiment uses
> cryptographic privacy to let people share their real thinking. Our AI finds patterns across
> submissions: common ground you didn't see, concerns everyone shares but nobody voiced, or
> confirmation that you genuinely disagree. **You can't resolve what you don't understand.** We
> show you what's actually happening beneath the surface.

---

## 10. Superseded thinking — the graveyard

Full technical decision records live in `brain/specs/`. This section covers what's *not* in the
specs, plus early-era material worth not re-walking.

### 10.1 The original October 2025 architecture

*("Privacy-preserving continuous feedback platform", Oct 2025; "Comparing human and lit networks",
Sep 2025)* — largely superseded, but the shape is worth knowing:

- **Human Network VOPRF** deriving a deterministic seed from low-entropy personal inputs.
- **Cards with Card ID + a 4–6 digit PIN + QR code**, optionally with a tear-off verification
  section.
- **POAP as the second sybil-resistance factor** — "sybil resistance is card + POAP" was an explicit
  user position at the time. Now fully replaced by card nullifier + on-chain burn.
- **Safe multisig as the respondent's own wallet**, starting single-signer with recovery signers
  addable later ("progressive enhancement of security"). Now: WaaP-minted fresh EOA + SMC.
- Framing throughout: **"business cards as crypto onboarding mechanism"**, "physical-digital
  bridge."

### 10.2 The account-creation shootout — three options, all rejected as-posed

**[user framed the question]** *(Oct 2025)*. Worth preserving because the conclusion was that none
of them worked, which is what eventually led to WaaP:

1. **WebAuthn → Human Network → signer.** Verdict: overengineered. WebAuthn credentials are
   disposable (clearable and regenerable), so it adds steps without adding security. Cross-device is
   painful. **Decided against.**
2. **Name + password → Human Network → signer.** Verdict: nothing prevents one person using 20
   different name+password combinations. "A username/password system with extra steps."
3. **Random seed + password encryption (MetaMask-style).** Verdict: "weak but honest" — doesn't
   pretend to sybil resistance it doesn't have.

**The key realisation:** *none of these solve sybil resistance* — they only vary how annoying you
make the process. Sybil resistance has to come from elsewhere (then: card + POAP; now: card
nullifier + on-chain burn).

**Security questions as OPRF input** ("favourite holiday destination", "first pet's name") were
explored as an entropy improvement — the user's insight was that Human Network *likes* low-entropy
input, so offering users a choice of 2–3 from a longer list improves both entropy and memorability.
A security-questions web component was built. Superseded by WaaP.

Also noted: including the card secret in the Human Network input was recommended as defence-in-depth
against password attacks, stored encrypted in localStorage.

### 10.3 NFT-as-invitation

Explored Dec 2025 as an alternative or complement to physical cards: mint invitation NFTs to known
addresses (DAO members, token holders, people who completed survey A), or a hybrid where a physical
card at a museum says "scan to claim your digital invitation." The NFT would hold the invitation
secret used for OPRF, and optionally store encrypted results back after completion.

Status: never adopted. The card nullifier model does the same job without requiring respondents to
have a wallet first. But note the "chain surveys together" idea (invite people who completed survey
A to survey B) — that capability now exists via the pool model, differently implemented.

### 10.4 Naming

**[user decision]** The name came from a **typo** — the user mistyped "Santiment" and thought it
could work as a project name. *(Sep 2025.)* The "3" reads web3-native while the word stays clear.

---

## 11. Open tensions and unresolved items

Things where the material contradicts itself or simply stops. These are the questions to settle
*before* writing, not during.

1. **"Cryptografisch gegarandeerd" vs "wiskundig bewijs."** Mar 2026 corrected "wiskundig
   onmogelijk" to the more precise "cryptografisch gegarandeerd." But all the Apr 2026 copy uses
   "wiskunde"/"wiskundig bewijs" freely and it reads far better. Which register governs the
   whitepaper vs the website?
2. **Promise 7 (rewards) has no implementation and no decision record.** "Tokens, NFT's of een
   bewijs van deelname" appears in the user's own promises and in the pricing material as the
   respondent reward pool — but nothing in the code, specs or DRs covers it. Is it roadmap,
   aspiration, or dropped?
3. **The pool token.** One passing reference (May 2026) to a future transferable pool token
   representing value flowing between data buyers and respondents. Contradicts nothing, but sits
   oddly with "no token in first 3 years." Status unknown.
4. **Segment conflict — LARGELY RESOLVED (Aug 2026), see §6A.** Oct–Dec 2025 material is Web3-native
   (DAOs, protocols, token holders, DAI pricing). Apr 2026 material is Dutch HR professionals doing
   medewerkersonderzoek. These looked like two different products.
   **The panel-protocol framing dissolves the conflict:** the product is infrastructure for running
   respondent pools/panels; a crypto-native panel is the first instance, and an employer running a
   continuous employee barometer is *also* operating a panel. Both are pool operators. What remains
   open is sequencing and go-to-market (§6A.10 items 2 and 5), not product identity.
5. **The three implementation gaps vs the public promises.** Specs GAP-10 + DR-N2 + DR-S1 mean
   respondents don't cryptographically own their data, the builder owns the collection, and
   s3ntiment holds scoring keys. Promise 1 and 4 are stated publicly in stronger terms than the
   code currently supports. How much of that belongs in a whitepaper (my draft says: all of it)
   versus a technical appendix?
6. **Nillion dependency vs the "neutral platforms" claim.** Promise 5 says open source on neutral
   platforms; the honest caveat says Nillion is a company that could revoke API access. Both true;
   they need to appear in the same document without one quietly undoing the other.
7. **Revenue model is genuinely undecided.** §7 has one firm decision (no token, 3 years) and a
   pile of options. The infrastructure-revenue problem (§7.5) is unresolved.

---

## 12. Narrative devices and anecdotes

Material that isn't argument but is useful for making the argument land.

### 12.1 The HR manager sketch

**[user's idea]** *(Oct 2025)* — a comedy sketch to dramatise the trust problem. The user's brief:
an HR manager comes in with a "traditional" Web3 privacy solution, and a sceptical dev keeps asking
*someone must be counting the votes* — and it turns out **it's her**.

That's the actual insight worth building on: **every "private" survey tool has a moment where
someone decrypts**, and the pitch is that s3ntiment has no such moment. The dev's question — *"to
see the results, someone has to decrypt the answers, right? Who does that?"* — is the single best
plain-language framing of the whole value proposition in the archive.

A version was drafted; the user then asked for a variant with sexual-dominance undertones in a
workplace-authority setting, which was declined. The core comedic premise stands on its own without
that layer.

### 12.2 Other lines worth keeping

- "Er is geen centrale database — dus ook niks om te hacken."
- "Niet juridisch, maar wiskundig." (on GDPR compliance)
- "You can't resolve what you don't understand."
- "Not data minimisation as policy — data minimisation as architecture."
- "Most companies solve data sovereignty with 'we host in the EU.' We solve it with 'there is no
  central host.'"
- "De eerlijkste data krijg je op het moment dat iemand niets meer te verliezen heeft."

---

## 13. Retrieval gaps

What I know exists but could not fully reach in this sweep. Listed so the gaps are visible rather
than silently absent.

- **The 25-page comprehensive technical summary** (Sep 2025, "Comparing human and lit networks")
  and the "Comprehensive Technical Summary" (Oct 2025). Both largely superseded, but they contain
  the original reasoning in full, plus sections I only saw fragments of: technical challenges &
  solutions, success metrics, long-term vision, market opportunity ($7.5B market research industry
  figure appears there).
- **The Human Network vs Lit Network comparison** (Sep 2025) — I saw the chat title and fragments
  only. Several early architecture choices were made there.
- **The full Dutch website copy threads** — I retrieved the seven promises, the key blocks and the
  rejected phrasings, but the iteration is longer than what surfaced, and the final HTML landing
  page (`s3ntiment-landing.html`) was built in-thread and not retrieved.
- **`NILLION_SKILL.md` and the WaaP skill doc** (Apr 2026) — referenced as created; not retrieved.
  Likely the densest technical integration references that exist.
- **Nillion tokenomics thread** (May 2026) — retrieved the architecture vocabulary and the
  transferability discussion; the tokenomics proper (NIL utility, staking) only in outline.
- **Colour/brand work** (May 2026) — deliberately excluded per instruction, but note it exists and
  contains a `#2D5A3D` forest-green decision and a swan S-logo concept, in case it's wanted later.
- **Anything after May 2026** — my reliable knowledge of this project's chat history thins out
  toward the present. If there are recent threads, they're not represented here.

---

## 14. Suggested whitepaper outline (from this material)

Not written yet — this is the shape the material supports.

1. **The problem** — preference falsification, the nine-yeses example, §1.
2. **The evidence** — §2, with the two findings that drive design.
3. **What we're claiming, precisely** — the measurement problem, not the communication problem
   (§1.3). This is the credibility move: a narrower claim, better defended.
4. **The four pillars** — §3, with the walk-away test as the operative check.
5. **The protocol, by function** — six areas: admission, identity, access, respondent data,
   aggregation, governance. Requirements → mechanism → rejected alternatives → current status.
   *(This part is already drafted in the existing whitepaper file and is the strongest section of
   it; reuse rather than rewrite.)*
6. **Honest caveats** — §11 items 5, 6 plus the Nillion dependency.
7. **Reference implementation** — the stack table; requirements are stack-independent.
8. **What this is for** — the panel protocol, §6A. Nearer-term than mediation and it explains the
   pool architecture; belongs *before* the mediation chapter, not folded into use cases.
9. **Where this goes** — mediation, §9.
10. **Appendix: what we tried and abandoned** — §10 plus the specs' DR index. This is unusual in a
   whitepaper and would be a differentiator: it demonstrates the seriousness the rest of the
   document claims.