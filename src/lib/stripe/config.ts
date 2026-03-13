import { env } from "@/lib/utils/env";

export const STRIPE_CONFIG = {
  get prices() {
    return {
      monthly: env.STRIPE_PRICE_ID_MONTHLY,
      annual: env.STRIPE_PRICE_ID_ANNUAL,
    };
  },
  monthlyPrice: 999, // $9.99 in cents
  annualPrice: 9999, // $99.99 in cents
  trialDays: 14,
  features: [
    "Unlimited chores & assignments",
    "Auto-rotation scheduling",
    "Photo proof & AI verification",
    "Fairness scoring & analytics",
    "Gamification & rewards (Family)",
    "Goals & competitions",
    "Shared shopping lists",
    "Real-time activity feed",
    "Push & email notifications",
    "Multi-household support",
    "Data export (CSV/PDF/JSON)",
    "Priority support",
  ],
} as const;
