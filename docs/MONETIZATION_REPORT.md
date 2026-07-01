# SaaS Monetization Report — Trading-Web

Opportunities to grow revenue and retention, ranked by **impact vs. effort**.
The current model is a manually-provisioned weekly ($9.99) / monthly ($29.99)
subscription with a trial tier, gating trading signals and a private Telegram
group.

## Quick Wins (high impact, low effort)

| # | Opportunity | Why it drives profit | Effort |
|---|-------------|----------------------|--------|
| 1 | **Expiry reminder + expired emails** (shipped) | Recovers churn from users who simply forget to renew; reminders at 14/7/3/1 days recover a meaningful % of lapses. | Low ✅ |
| 2 | **Annual plan with discount** (e.g. $299/yr vs $358) | Lifts LTV and cash upfront, reduces monthly churn touch-points. | Low |
| 3 | **Trial-to-paid nudge sequence** | Automated emails on trial day 1/3/last-day increase conversion. Reuses the mailer built here. | Low |
| 4 | **Failed/near-expiry "renew now" CTA** in emails (shipped link) | Direct path back to paying. | Low |
| 5 | **Self-service renewal request** | Removes admin bottleneck; faster reactivation = less involuntary churn. | Low–Med |

## Medium-Term Improvements

| # | Opportunity | Why it drives profit | Effort |
|---|-------------|----------------------|--------|
| 6 | **Payment provider integration** (Stripe/Paystack) | Enables auto-renewal, dunning, and instant reactivation after payment — the single biggest lever for recurring revenue. | Med |
| 7 | **Dunning / payment recovery workflow** | Retries + reminders on failed charges recover 20–40% of failed payments industry-wide. | Med |
| 8 | **Plan tiers / add-ons** (e.g. premium strategies, higher signal frequency, 1:1 sessions) | Upsell & cross-sell existing base. | Med |
| 9 | **Reactivation campaigns** for `inactive` users | Win-back emails to previously paying users are cheap, high-ROI. | Med |
| 10 | **Usage-based engagement triggers** | Email users who haven't logged in / linked Telegram to boost adoption and reduce churn. | Med |

## Strategic Revenue Features

| # | Opportunity | Why it drives profit | Effort |
|---|-------------|----------------------|--------|
| 11 | **Analytics: MRR / ARR / churn / LTV / cohort / funnel** | Data to prioritise everything else; requires a `subscriptions` + `payments` history model. | High |
| 12 | **Affiliate / referral program** | Turns members into a distribution channel. | High |
| 13 | **Tiered community + course upsell** (leveraging existing PDFs/strategies) | New product line beyond signals. | High |
| 14 | **Automated customer-success lifecycle** | Onboarding → adoption → renewal automations reduce support cost and churn. | High |

## Retention & churn reduction
- **Involuntary churn**: reminders (shipped) + dunning (item 7) + auto-reactivation on payment (item 6).
- **Voluntary churn**: annual discount (item 2), engagement triggers (item 10), reactivation (item 9).

## Analytics prerequisites
Accurate MRR/ARR/churn/LTV require moving subscription + payment events into
dedicated tables (see Architecture Review §5). Recommended minimum:
`subscriptions(user_id, plan, status, started_at, current_period_end, cancel_at)`
and `payments(user_id, amount, currency, status, provider_ref, created_at)`.

## Operational / admin productivity
- **Automations** shipped here (reminders, expiry, notifications) already reduce
  manual admin touch and support tickets ("why did I lose access?").
- Next: self-service renewal + a payments dashboard to eliminate manual
  provisioning entirely.

## Suggested prioritisation
1. Ship Quick Wins 2–5 (build on the email engine in this PR).
2. Integrate payments (item 6) — unlocks 7 and auto-reactivation.
3. Stand up the analytics data model (item 11) to steer the roadmap.
