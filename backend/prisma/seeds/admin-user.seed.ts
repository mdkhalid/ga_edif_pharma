import { randomBytes } from 'node:crypto';

import type { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';

import { SystemRole, UserStatus } from '@medichain/shared-types';

/**
 * Creates development accounts.
 *
 * ## Why this refuses to run in production
 *
 * A seed that creates a sign-in account is a seed that creates a credential. In
 * production that credential is a back door: it exists in a repository, it is
 * known to everyone who can read the seed file, and it is unlikely to be
 * rotated. The check below makes the safe behaviour the default and requires a
 * deliberate act to override.
 *
 * ## Why the password is generated rather than fixed
 *
 * A fixed password in a seed file ends up in screenshots, in chat messages and
 * in the git history. A random one printed once to the console cannot be
 * predicted, and a developer who needs it can read it from the run that created
 * their database.
 *
 * The consequence — losing the password if the console output is discarded — is
 * handled by re-running the seed: it is idempotent, and a `--reset-password`
 * flag regenerates it.
 *
 * Set `SEED_ADMIN_PASSWORD` to opt out of generation and use a known value.
 * That is for automation, not for humans: a CI job that must sign in as a
 * seeded account cannot read a password printed to a log, and scraping stdout
 * would put the credential in the CI log regardless. It is ignored in
 * production, where this seed refuses to run at all.
 */

const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

export async function seedAdminUsers(prisma: PrismaClient, tenantId: string): Promise<void> {
  if (process.env['NODE_ENV'] === 'production') {
    console.log(
      '  users         skipped — refusing to create sign-in accounts in production. ' +
        'Create the first platform administrator with the `create-admin` script instead.',
    );
    return;
  }

  const resetPassword = process.argv.includes('--reset-password');

  // ------------------------------------------------------------ super admin
  //
  // Global: `tenantId: null`. This is the only account that is not scoped to a
  // tenant, and the only one the capability guard admits to platform routes.
  const superAdminEmail = (process.env['SEED_SUPER_ADMIN_EMAIL'] ?? 'root@medichain.local').toLowerCase();

  await upsertDevUser(prisma, {
    email: superAdminEmail,
    fullName: 'Platform Administrator',
    tenantId: null,
    organisationId: null,
    roleCode: SystemRole.SUPER_ADMIN,
    resetPassword,
    label: 'super admin',
  });

  // ----------------------------------------------------------- tenant admin
  //
  // The account a developer uses for day-to-day work: it sees exactly what a
  // real pharma company's administrator sees, which makes it the right account
  // for exercising the tenant-scoped endpoints.
  const tenantAdminEmail = (process.env['SEED_TENANT_ADMIN_EMAIL'] ?? 'admin@sunrisepharma.local').toLowerCase();

  await upsertDevUser(prisma, {
    email: tenantAdminEmail,
    fullName: 'Tenant Administrator',
    tenantId,
    organisationId: null,
    roleCode: SystemRole.TENANT_ADMIN,
    resetPassword,
    label: 'tenant admin',
  });
}

async function upsertDevUser(
  prisma: PrismaClient,
  input: {
    email: string;
    fullName: string;
    tenantId: string | null;
    organisationId: string | null;
    roleCode: string;
    resetPassword: boolean;
    label: string;
  },
): Promise<void> {
  const existing = await prisma.user.findFirst({
    where: { email: input.email, deletedAt: null },
    select: { id: true },
  });

  const role = await prisma.role.findFirst({
    where: {
      code: input.roleCode,
      ...(input.tenantId === null ? { tenantId: null } : { tenantId: input.tenantId }),
    },
    select: { id: true },
  });

  if (role === null) {
    // A missing role means the role seed did not run, or ran for a different
    // tenant. Creating the user without it would produce an account that can
    // sign in and do nothing — a confusing state to debug later.
    console.warn(
      `  users         SKIPPED ${input.label}: role ${input.roleCode} is not seeded. Run the role seed first.`,
    );
    return;
  }

  if (existing !== null) {
    // An explicitly declared password is a statement of desired state, not a
    // one-off action, so it is applied even to an account that already exists.
    // The alternative — ignoring it because the row is present — would make the
    // seed behave differently on a fresh database than on a persistent CI one,
    // which is the hardest kind of difference to debug.
    const declared = isPasswordDeclared();

    if (!declared && !input.resetPassword) {
      console.log(`  users         ${input.label} already exists (${input.email}) — unchanged`);
      return;
    }

    const password = resolvePassword();
    await prisma.user.update({
      where: { id: existing.id },
      data: {
        passwordHash: await argon2.hash(password, ARGON2_OPTIONS),
        passwordChangedAt: new Date(),
        // A password reset must invalidate every existing session; otherwise a
        // developer who reset the password on one machine stays signed in on
        // another with the old one, and the reset appears not to have worked.
        sessions: {
          updateMany: {
            where: { revokedAt: null },
            data: { revokedAt: new Date(), revokedReason: 'PASSWORD_CHANGED' },
          },
        },
      },
    });

    if (declared) {
      // Never echo a caller-supplied password: the caller already has it, and
      // printing it would put it in a CI log for no benefit.
      console.log(
        `  users         ${input.label} password set from SEED_ADMIN_PASSWORD (${input.email})`,
      );
    } else {
      printCredentials(input.email, password, input.label, true);
    }

    return;
  }

  const declaredPassword = isPasswordDeclared();
  const password = resolvePassword();
  const passwordHash = await argon2.hash(password, ARGON2_OPTIONS);

  const user = await prisma.user.create({
    data: {
      tenantId: input.tenantId,
      email: input.email,
      fullName: input.fullName,
      passwordHash,
      // Seeded accounts skip verification: there is no mailbox behind
      // `*.local`, so requiring verification would make the seed unusable.
      status: UserStatus.ACTIVE,
      emailVerifiedAt: new Date(),
      organisationId: input.organisationId,
    },
    select: { id: true },
  });

  await prisma.userRole.create({ data: { userId: user.id, roleId: role.id } });

  if (declaredPassword) {
    console.log(
      `  users         created ${input.label} (${input.email}) with the password from SEED_ADMIN_PASSWORD`,
    );
  } else {
    printCredentials(input.email, password, input.label, false);
  }
}

/** True when the caller has declared the password rather than leaving it to chance. */
function isPasswordDeclared(): boolean {
  const supplied = process.env['SEED_ADMIN_PASSWORD'];
  return supplied !== undefined && supplied !== '';
}

/**
 * Generates a readable but strong password.
 *
 * Grouped in fours so it can be read off a console and typed elsewhere without
 * losing one's place. 24 bytes from the CSPRNG is far beyond what a password
 * policy needs — this is a development credential, and the point is that it is
 * unguessable rather than memorable.
 */
function generatePassword(): string {
  const raw = randomBytes(18).toString('base64url');
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 18)}`;
}

/**
 * Resolves the password to use for a seeded account.
 *
 * `SEED_ADMIN_PASSWORD` exists because a randomly generated password printed to
 * a log is unusable by automation. In CI nobody reads the console, so an
 * end-to-end test that has to sign in as a seeded account has no way to learn
 * the credential — it would have to scrape stdout, which is fragile and would
 * put the password in the CI log anyway. Supplying a known password makes the
 * seed usable by a test harness.
 *
 * It cannot weaken production: the caller returns before this is reached when
 * `NODE_ENV === 'production'`. The placeholder check mirrors the one in the env
 * schema — a `.env.example` value copied into CI should fail loudly rather than
 * silently become a working credential.
 */
function resolvePassword(): string {
  const supplied = process.env['SEED_ADMIN_PASSWORD'];

  if (supplied === undefined || supplied === '') {
    return generatePassword();
  }

  if (supplied.length < 12) {
    throw new Error(
      `SEED_ADMIN_PASSWORD must be at least 12 characters (got ${supplied.length}).`,
    );
  }

  if (/^replace-me/i.test(supplied)) {
    throw new Error(
      'SEED_ADMIN_PASSWORD still holds the placeholder value from .env.example. Set a real password or unset it to have one generated.',
    );
  }

  return supplied;
}

function printCredentials(
  email: string,
  password: string,
  label: string,
  regenerated: boolean,
): void {
  console.log(
    [
      '',
      `  users         ${regenerated ? 'password regenerated for' : 'created'} ${label}`,
      `                  email:    ${email}`,
      `                  password: ${password}`,
      '                  Shown once. Re-run with --reset-password to generate a new one.',
      '',
    ].join('\n'),
  );
}
