import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import Fastify from "fastify";
import { config } from "./config.js";
import { authPlugin } from "./plugins/auth.js";
import { errorPlugin } from "./plugins/errors.js";
import { authRoutes } from "./modules/auth/routes.js";
import { invitationRoutes } from "./modules/invitations/routes.js";
import { joinLinkRoutes } from "./modules/join-links/routes.js";
import { teamRoutes } from "./modules/teams/routes.js";
import { userRoutes } from "./modules/users/routes.js";
import { workoutRoutes } from "./modules/workouts/routes.js";
import { groupRoutes } from "./modules/groups/routes.js";
import { assignmentRoutes } from "./modules/assignments/routes.js";
import { trainingPlanRoutes } from "./modules/training-plans/routes.js";
import { personalPlanRoutes } from "./modules/personal-plans/routes.js";
import { teamEventRoutes } from "./modules/team-events/routes.js";
import { injuryRoutes } from "./modules/injuries/routes.js";
import { feedbackRoutes } from "./modules/feedback/routes.js";
import { activityRoutes } from "./modules/activities/routes.js";
import { feedRoutes } from "./modules/feed/routes.js";
import { placeRoutes } from "./modules/places/routes.js";
import { trackerRoutes } from "./modules/trackers/routes.js";
import { guardianRoutes } from "./modules/guardians/routes.js";
import { messageRoutes } from "./modules/messages/routes.js";
import { aiRoutes } from "./modules/ai/routes.js";
import { goalRoutes } from "./modules/goals/routes.js";
import { recordRoutes } from "./modules/records/routes.js";
import { importRoutes } from "./modules/imports/routes.js";
import { documentRoutes } from "./modules/documents/routes.js";
import { adminRoutes } from "./modules/admin/routes.js";
import { notificationRoutes } from "./modules/notifications/routes.js";
import { photoRoutes } from "./modules/photos/routes.js";

export async function buildApp() {
  const app = Fastify({
    logger: process.env.NODE_ENV === "test" ? false : true,
  });

  await app.register(cookie);
  await app.register(cors, {
    origin: config.corsOrigin,
    credentials: true,
  });
  // Gentle global limit; auth routes set stricter per-route limits.
  // Disabled in tests so the suite isn't throttled by its own setup.
  if (process.env.NODE_ENV !== "test") {
    await app.register(rateLimit, { max: 300, timeWindow: "1 minute" });
  }

  await app.register(errorPlugin);
  await app.register(authPlugin);

  app.get("/health", async () => ({ ok: true, service: "curvelo-api" }));

  await app.register(authRoutes, { prefix: "/api/v1/auth" });
  await app.register(userRoutes, { prefix: "/api/v1/users" });
  await app.register(teamRoutes, { prefix: "/api/v1/teams" });
  // Invitation routes include /teams/:id/invitations + /invitations/:token/*
  await app.register(invitationRoutes, { prefix: "/api/v1" });
  // Join-link routes include /teams/:id/join-links + /join/:token/*
  await app.register(joinLinkRoutes, { prefix: "/api/v1" });
  // Workout, group, and assignment routes (team-scoped + individual resources)
  await app.register(workoutRoutes, { prefix: "/api/v1" });
  await app.register(groupRoutes, { prefix: "/api/v1" });
  await app.register(assignmentRoutes, { prefix: "/api/v1" });
  await app.register(trainingPlanRoutes, { prefix: "/api/v1" });
  await app.register(personalPlanRoutes, { prefix: "/api/v1" });
  await app.register(teamEventRoutes, { prefix: "/api/v1" });
  await app.register(injuryRoutes, { prefix: "/api/v1" });
  await app.register(feedbackRoutes, { prefix: "/api/v1" });
  await app.register(activityRoutes, { prefix: "/api/v1" });
  await app.register(feedRoutes, { prefix: "/api/v1" });
  await app.register(guardianRoutes, { prefix: "/api/v1" });
  await app.register(messageRoutes, { prefix: "/api/v1" });
  await app.register(aiRoutes, { prefix: "/api/v1" });
  await app.register(goalRoutes, { prefix: "/api/v1" });
  await app.register(recordRoutes, { prefix: "/api/v1" });
  await app.register(importRoutes, { prefix: "/api/v1" });
  await app.register(documentRoutes, { prefix: "/api/v1" });
  await app.register(adminRoutes, { prefix: "/api/v1" });
  await app.register(notificationRoutes, { prefix: "/api/v1" });
  await app.register(photoRoutes, { prefix: "/api/v1" });
  await app.register(placeRoutes, { prefix: "/api/v1" });
  await app.register(trackerRoutes, { prefix: "/api/v1" });

  return app;
}
