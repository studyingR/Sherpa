# 06 — Mobile UX

The clickable prototype (Today → Call → Review → Saved → Recap) is the reference for look and feel. Match its layout, tone and component style; extend it to every feature below.

## 1. Design tokens (`apps/mobile/src/theme/tokens.ts`)

These come from the prototype. If TD Brand supplies an official palette later, replace the token values without touching components.

```ts
export const color = {
  ground: '#F5F4EF',       // app background
  surface: '#FFFFFF',      // cards
  surfaceMuted: '#EDEBE4', // chips, secondary buttons
  border: '#D9D6CC',
  ink: '#16202A',          // primary text
  inkMuted: '#4A545E',     // secondary text (≥ 4.5:1 on ground)
  inkSubtle: '#5B6570',    // section labels
  primary: '#0F6E63',      // primary actions (white text)
  primaryPressed: '#0A4F47',
  primarySoft: '#DDF1EC',
  callBg: '#101820',       // voice call screen
  callSurface: '#1E2A34',
  callAccent: '#3FB8A4',
  callInk: '#EEF1F3',
  warnBg: '#FBEBD2', warnInk: '#7A4A00',
  dangerBg: '#FDF0EE', dangerBorder: '#F2C9C3', dangerInk: '#7E1D14', danger: '#A8261B',
  accentGold: '#F2C57C',
};
export const font = {
  display: 'Newsreader_600SemiBold',   // headings (expo-google-fonts)
  body: 'Figtree_400Regular',
  bodyMedium: 'Figtree_500Medium',
  bodySemibold: 'Figtree_600SemiBold',
  bodyBold: 'Figtree_700Bold',
};
export const size = { xs: 11, sm: 13, md: 15, lg: 16, xl: 22, xxl: 32 };
export const radius = { sm: 12, md: 14, lg: 16, xl: 20, pill: 999 };
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 28 };
```

Support system dark mode in M8 by mapping tokens; the call screen is already dark.

## 2. Navigation

Bottom tabs (expo-router): **Today** · **Accounts** · **Ask** (large center mic button) · **Alerts** · **Me**.

- Ask button: tap = voice session in ASK mode; long-press = chat input.
- Global header on Today shows date and greeting.
- Deep links: `sherpa://debrief/new?meetingId=`, `sherpa://brief/:meetingId`, `sherpa://alerts/:id` (used by pushes).

## 3. Components (`apps/mobile/src/components`)

`Screen`, `Header`, `SectionLabel`, `Card`, `ListRow`, `Chip` (toggle), `Badge` (Brief ready / Due today / 3 days late / Needs your OK / Client commitment), `PrimaryButton`, `SecondaryButton`, `IconButton` (with required `accessibilityLabel`), `CheckRow` (toggle include), `ApprovalToggle` (dashed → filled), `FlagBanner` (danger, optional `locked`), `SourceTag` ("nCino · as of Oct 17"), `FactGrid`, `TranscriptBubble` (agent/RM), `MicButton` (states: idle, listening, thinking, speaking), `EmptyState`, `ErrorState`, `Skeleton`, `Toast`.

Icons: `lucide-react-native` stroke icons. No emoji.

## 4. Screens by feature

### Today (F04 + F06 + F08 + F10 + F13)
Order: pending debrief card (dark card with "Call to debrief"), commitments due (top), today's meetings with brief badges, alerts (warn/critical), documents due, coverage suggestions (max 3, "See plan"), at-risk relationships (if F13 active). Pull to refresh. "Play my agenda" button speaks the agenda.

### Debrief capture (F01) — `debrief/[sessionId]`
Dark call screen as in prototype: header (Sherpa dot, timer, account title, "Transcribing · audio is not stored" pill), transcript bubbles, bottom: big mic state button, "Done talking", "Type instead", "End call · draft is kept". Flag events show an inline red bubble ("Logged as a complaint, per policy").

### Debrief review (F01) — `debrief/review/[draftId]`
As prototype: Summary card (editable), Next steps → Tasks (CheckRow list, owner/date editable via sheet), New opportunity card with ApprovalToggle and "Needs your OK" badge, FlagBanner(s) (complaint locked with lock icon), Specialist interest chips, Contact updates (approval toggles). Sticky footer: "Confirm & save to Salesforce" + "Nothing is written until you confirm."

### Saved (F01) — `debrief/saved/[debriefId]`
Check icon, "Saved to Salesforce", confirmed by + time, list of written/held items with status colors, buttons: "Draft recap email to {first contact}", "Refer to specialist" (if interest), "Back to today".

### Follow-up drafts (F03) — `drafts/[debriefId]`
Tabs: Client recap | Internal handoffs. Editable To/Cc (pickers from contacts only), subject, body. Guard banner (green pass / amber "We removed 2 phrases that could read as commitments" with diff). Button: "Save to Outlook drafts". After save: "In your Outlook drafts · not sent".

### Brief (F02) — `brief/[meetingId]`
Header: account, meeting time, attendees. "Play brief" button (spoken), privacy toggle. Sections as collapsible cards with FactGrid + SourceTag. Missing sources banner. Talking points (F09) section with thumbs up/down. Alerts, documents and health (if active) sections. "Ask a question" input at bottom.

### Accounts — list and detail
List: search, segment filter, rows with name, city, last touch, badges (alert count, docs due). Detail tabs: Overview · Activity (debriefs, tasks) · Credit · Deposits · Referrals · Documents · Insights (talking points, health). Actions: Brief, Debrief, New deal, Refer.

### Alerts (F06)
Grouped by severity; each card shows title, evidence facts, suggested action, actions row (Acknowledge · Snooze · Create task · Dismiss). Filters: open / snoozed / all.

### Referral (F05) — `referral/new`
Prefilled from debrief: specialty chips, contact picker, need summary (editable), urgency segmented control, consent checkbox, "Route to {queue}" preview, confirm. Referrals list on account with status pills.

### Deal intake (F07) — `deal/new`
Voice-first like debrief; review screen with field form (product, amount, term, amortization, collateral, purpose, timing, guarantors), existing exposure facts, missing fields highlighted, read-back required badge, "Create draft in nCino" (label clarifies "Draft for your review — not submitted to credit").

### Documents (F08) — `documents/[accountId]`
List of outstanding items (type, period, due, days overdue), select items → "Draft request email", reminder schedule chips (7/14 days), mark received.

### Coverage (F10) — `coverage/index`
Weekly plan list with reasons ("92 days since last touch · line matures in 74 days"), actions Accept / Skip / Schedule. Coverage meter for the book. Leader variant: team table (coverage % per RM), no client details beyond names.

### Live listening (F11, gated) — `live/[meetingId]`
Pre-start consent sheet (jurisdiction picker, all-party consent checkbox with statement text), then a minimal screen: large persistent "Listening" indicator, elapsed time, pause/stop, captured items list. Stop → review.

### Pricing guidance (F12, gated) — `pricing/[dealId]`
Screen-only card: indicative spread range bar, drivers list, disclaimer banner, "Requires pricing approval" state. No share/copy buttons.

### Health (F13, gated)
Score ring with band color, top 3 drivers with SourceTags, 12-week trend sparkline, disclaimer "Internal early-warning indicator. Not used for credit or pricing decisions."

### Me / Settings
Profile, nudge preferences, quiet hours, privacy mode default, voice speed, phone channel PIN setup, sign out. Compliance role sees "Review queue".

## 5. States and copy

- Every list has empty, loading (skeleton) and error states with retry.
- Writes show a confirm step; success toasts state what was written ("3 tasks created").
- Errors never blame the user; name the system ("Salesforce isn't responding. Your draft is saved.").

## 6. Accessibility

- VoiceOver/TalkBack labels on all controls; announce state changes in voice screens (listening / thinking / speaking).
- Dynamic type support up to 130% without clipping (cards grow).
- Touch targets ≥ 44pt; contrast ≥ 4.5:1 for text.
- Captions: every spoken agent reply is also shown as text.
