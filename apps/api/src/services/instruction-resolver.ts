import { eq, and, asc } from "drizzle-orm";
import type { Db } from "@assembly-lime/shared/db";
import {
  defaultAgentInstructions,
  customInstructions,
} from "@assembly-lime/shared/db/schema";
import type { InstructionLayer } from "@assembly-lime/shared/prompts";
import type { AgentProviderId, AgentMode } from "@assembly-lime/shared";

type ResolverContext = {
  tenantId: number;
  provider: AgentProviderId;
  mode: AgentMode;
  projectId?: number;
  repositoryId?: number;
  ticketId?: number;
};

/**
 * Queries the DB instruction chain and returns ordered InstructionLayers.
 *
 * Resolution order per CLAUDE.md:
 *  1. default_agent_instructions (tenant + provider)
 *  2. custom_instructions — tenant scope
 *  3. custom_instructions — project scope
 *  4. custom_instructions — repository scope
 *  5. custom_instructions — ticket scope
 */
export async function resolveInstructionLayers(
  db: Db,
  ctx: ResolverContext
): Promise<InstructionLayer[]> {
  const layers: InstructionLayer[] = [];

  // 1. Default agent instructions for this tenant + provider
  const defaults = await db
    .select()
    .from(defaultAgentInstructions)
    .where(
      and(
        eq(defaultAgentInstructions.tenantId, ctx.tenantId),
        eq(defaultAgentInstructions.provider, ctx.provider),
        eq(defaultAgentInstructions.enabled, true)
      )
    );

  for (const row of defaults) {
    layers.push({
      scope: `default:${ctx.provider}`,
      content: row.contentMd,
      priority: 0,
    });
  }

  // 2-5. Custom instructions by scope, ordered by priority
  const scopeFilters: { scopeType: string; scopeId: number }[] = [
    { scopeType: "tenant", scopeId: ctx.tenantId },
  ];
  if (ctx.projectId) {
    scopeFilters.push({ scopeType: "project", scopeId: ctx.projectId });
  }
  if (ctx.repositoryId) {
    scopeFilters.push({ scopeType: "repository", scopeId: ctx.repositoryId });
  }
  if (ctx.ticketId) {
    scopeFilters.push({ scopeType: "ticket", scopeId: ctx.ticketId });
  }

  for (const { scopeType, scopeId } of scopeFilters) {
    const rows = await db
      .select()
      .from(customInstructions)
      .where(
        and(
          eq(customInstructions.tenantId, ctx.tenantId),
          eq(customInstructions.scopeType, scopeType),
          eq(customInstructions.scopeId, scopeId),
          eq(customInstructions.mode, ctx.mode),
          eq(customInstructions.enabled, true)
        )
      )
      .orderBy(asc(customInstructions.priority));

    for (const row of rows) {
      layers.push({
        scope: scopeType,
        content: row.contentMd,
        priority: row.priority,
      });
    }
  }

  return layers;
}
