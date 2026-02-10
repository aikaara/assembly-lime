import { eq, and } from "drizzle-orm";
import type { Db } from "@assembly-lime/shared/db";
import { connectors, k8sClusters, tenants } from "@assembly-lime/shared/db/schema";
import { encryptToken, decryptToken } from "../lib/encryption";
import { getClusterClient } from "./k8s-cluster.service";
import { tenantNamespace, deleteGitCredentialSecret } from "./namespace-provisioner.service";
import { childLogger } from "../lib/logger";

const log = childLogger({ module: "connector-service" });

type CreateConnectorInput = {
  provider: number;
  externalOrg?: string;
  authType: number;
  accessToken: string;
  scopes?: string[];
};

export async function createConnector(db: Db, tenantId: number, input: CreateConnectorInput) {
  const accessTokenEnc = encryptToken(input.accessToken);

  const [row] = await db
    .insert(connectors)
    .values({
      tenantId,
      provider: input.provider,
      externalOrg: input.externalOrg,
      authType: input.authType,
      accessTokenEnc,
      scopesJson: input.scopes ?? [],
      status: 1,
    })
    .returning();

  log.info({ connectorId: row!.id, tenantId }, "connector created");
  return row!;
}

export async function listConnectors(db: Db, tenantId: number) {
  return db
    .select({
      id: connectors.id,
      tenantId: connectors.tenantId,
      provider: connectors.provider,
      externalOrg: connectors.externalOrg,
      authType: connectors.authType,
      scopesJson: connectors.scopesJson,
      status: connectors.status,
      createdAt: connectors.createdAt,
      revokedAt: connectors.revokedAt,
    })
    .from(connectors)
    .where(and(eq(connectors.tenantId, tenantId), eq(connectors.status, 1)));
}

export async function getConnector(db: Db, tenantId: number, connectorId: number) {
  const [row] = await db
    .select()
    .from(connectors)
    .where(and(eq(connectors.id, connectorId), eq(connectors.tenantId, tenantId)));
  return row ?? null;
}

export function getConnectorToken(connector: { accessTokenEnc: Buffer }): string {
  return decryptToken(connector.accessTokenEnc);
}

export async function revokeConnector(db: Db, tenantId: number, connectorId: number) {
  const [row] = await db
    .update(connectors)
    .set({ status: 0, revokedAt: new Date() })
    .where(and(eq(connectors.id, connectorId), eq(connectors.tenantId, tenantId)))
    .returning();

  if (row) {
    log.info({ connectorId, tenantId }, "connector revoked");

    // Clean up git credential secrets from all tenant clusters
    try {
      const [tenant] = await db
        .select({ slug: tenants.slug })
        .from(tenants)
        .where(eq(tenants.id, tenantId));

      if (tenant) {
        const clusters = await db
          .select()
          .from(k8sClusters)
          .where(eq(k8sClusters.tenantId, tenantId));

        const ns = tenantNamespace(tenant.slug);
        const secretName = `git-cred-${connectorId}`;

        for (const cluster of clusters) {
          try {
            const kc = await getClusterClient(db, tenantId, cluster.id);
            await deleteGitCredentialSecret(kc, ns, secretName);
          } catch (err) {
            log.warn({ err, clusterId: cluster.id, secretName }, "failed to delete git credential secret from cluster");
          }
        }
      }
    } catch (err) {
      log.warn({ err, connectorId }, "failed to clean up K8s git credential secrets on revoke");
    }
  }

  return row ?? null;
}
