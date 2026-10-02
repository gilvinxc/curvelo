import { z } from "zod";
import { SELF_SIGNUP_ROLES } from "../constants.js";

const email = z.string().email().max(255);
const password = z.string().min(10).max(128);
// 10+ chars: real minimum bar for a production auth system.

export const registerSchema = z.object({
  email,
  password,
  displayName: z.string().min(1).max(80),
  role: z.enum(SELF_SIGNUP_ROLES),
  dateOfBirth: z.string().date().optional(),
  // ISO date string; used for age-aware permissions. Optional in MVP,
  // required later for minor accounts.
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email,
  password: z.string().min(1).max(128),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});
export type RefreshInput = z.infer<typeof refreshSchema>;
