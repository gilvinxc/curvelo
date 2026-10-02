import { nanoid } from "nanoid";
import type {
  CreateInvitationInput,
  InvitationDTO,
  InvitationPreviewDTO,
} from "@curvelo/shared";
import { INVITABLE_ROLES } from "@curvelo/shared";
import { db } from "../../db.js";
import { config } from "../../config.js";
import { audit } from "../../lib/audit.js";
import { AppError, conflict, forbidden, notFound } from "../../lib/errors.js";
import { activeMembership, requireManager } from "../../lib/permissions.js";
import { createSystemPost } from "../feed/service.js";

function toDTO(
  inv: {
    id: string;
    teamId: string;
    email: string;
    role: string;
    status: string;
    expiresAt: Date;
    token: string;
    team: { name: string };
  },
  includeToken: boolean,
): InvitationDTO {
  return {
    id: inv.id,
    teamId: inv.teamId,
    teamName: inv.team.name,
    email: inv.email,
    role: inv.role,
    status: inv.status,
    expiresAt: inv.expiresAt.toISOString(),
    ...(includeToken ? { token: inv.token } : {}),
  };
}

async function getValidInvitation(token: string) {
  const invitation = await db.invitation.findUnique({
    where: { token },
    include: { team: { select: { name: true, slug: true } } },
  });
  if (!invitation) throw notFound("Invitation not found");

  if (
    invitation.status === "PENDING" &&
    invitation.expiresAt < new Date()
  ) {
    await db.invitation.update({
      where: { id: invitation.id },
      data: { status: "EXPIRED" },
    });
    invitation.status = "EXPIRED";
  }

  if (invitation.status !== "PENDING") {
    const code =
      invitation.status === "EXPIRED" ? "INVITATION_EXPIRED" : "INVITATION_INVALID";
    const message =
      invitation.status === "EXPIRED"
        ? "This invitation has expired"
        : "This invitation is no longer valid";
    throw new AppError(410, code, message);
  }
  return invitation;
}

export async function createInvitation(
  actorId: string,
  teamId: string,
  input: CreateInvitationInput,
  ipAddress?: string,
): Promise<InvitationDTO> {
  const membership = await activeMembership(actorId, teamId);
  requireManager(membership);

  if (!INVITABLE_ROLES.includes(input.role)) {
    throw forbidden("That role cannot be granted by invitation");
  }

  const email = input.email.toLowerCase().trim();

  // Already on the team? Point the coach at the roster instead.
  const existingUser = await db.user.findUnique({ where: { email } });
  if (existingUser) {
    const existingMembership = await db.teamMembership.findUnique({
      where: { teamId_userId: { teamId, userId: existingUser.id } },
    });
    if (existingMembership?.status === "ACTIVE") {
      throw conflict("ALREADY_MEMBER", "This person is already on the team");
    }
  }

  // One live invitation per email+team: revoke the old, issue the new.
  await db.invitation.updateMany({
    where: { teamId, email, status: "PENDING" },
    data: { status: "REVOKED" },
  });

  const invitation = await db.invitation.create({
    data: {
      teamId,
      email,
      role: input.role,
      token: nanoid(32),
      invitedById: actorId,
      expiresAt: new Date(Date.now() + config.invitationTtlHours * 3600 * 1000),
    },
    include: { team: { select: { name: true } } },
  });

  await audit({
    actorId,
    action: "INVITATION_CREATED",
    entityType: "Invitation",
    entityId: invitation.id,
    metadata: { teamId, email, role: input.role },
    ipAddress,
  });

  // MVP: no email provider wired yet. The token is returned to the coach,
  // who shares it (or we log it in dev). Phase 2 sends the email.
  if (!config.isProd) {
    console.log(`[invitations] invite for ${email}: token=${invitation.token}`);
  }

  return toDTO(invitation, true);
}

export async function previewInvitation(
  token: string,
): Promise<InvitationPreviewDTO> {
  const invitation = await getValidInvitation(token);
  return {
    teamName: invitation.team.name,
    teamSlug: invitation.team.slug,
    role: invitation.role,
    expiresAt: invitation.expiresAt.toISOString(),
    invitedEmail: invitation.email,
    status: invitation.status,
  };
}

export async function acceptInvitation(
  userId: string,
  token: string,
  ipAddress?: string,
): Promise<{ teamId: string; role: string }> {
  const invitation = await getValidInvitation(token);

  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) throw notFound("User not found");

  // Invitations are bound to the invited email — no invite stealing.
  if (user.email.toLowerCase() !== invitation.email.toLowerCase()) {
    throw forbidden("This invitation was sent to a different email address");
  }

  const result = await db.$transaction(async (tx) => {
    const existing = await tx.teamMembership.findUnique({
      where: {
        teamId_userId: { teamId: invitation.teamId, userId },
      },
    });
    if (existing?.status === "ACTIVE") {
      throw conflict("ALREADY_MEMBER", "You are already on this team");
    }

    if (existing) {
      await tx.teamMembership.update({
        where: { id: existing.id },
        data: { status: "ACTIVE", role: invitation.role, joinedAt: new Date() },
      });
    } else {
      await tx.teamMembership.create({
        data: {
          teamId: invitation.teamId,
          userId,
          role: invitation.role,
          status: "ACTIVE",
        },
      });
    }

    await tx.invitation.update({
      where: { id: invitation.id },
      data: { status: "ACCEPTED", acceptedAt: new Date() },
    });

    return { teamId: invitation.teamId, role: invitation.role };
  });

  await audit({
    actorId: userId,
    action: "INVITATION_ACCEPTED",
    entityType: "Invitation",
    entityId: invitation.id,
    metadata: { teamId: invitation.teamId, role: invitation.role },
    ipAddress,
  });

  // Welcome the new member on the team feed (best-effort).
  try {
    const newcomer = await db.user.findUnique({
      where: { id: userId },
      select: { displayName: true },
    });
    await createSystemPost({
      teamId: result.teamId,
      authorId: userId,
      kind: "WELCOME",
      body: `👋 Welcome ${newcomer?.displayName ?? "our newest member"} to the team! Say hi!`,
    });
  } catch {
    // Welcome failed; membership stands.
  }

  return result;
}
